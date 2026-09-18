-- ============================================================================
-- Data backup & restore system
-- ----------------------------------------------------------------------------
-- The only backup the project had was for CODE (scripts/backup-full.ps1 ->
-- git bundle). This adds backup/restore for DATA: every table in the public
-- schema, discovered dynamically so tables added later are covered too.
--
--   data_backups      history of backups (cloud copies + downloads)
--   data_restores     history of restores
--   system-backups    private bucket holding cloud copies (gzipped JSON chunks)
--   backup_catalog()           tables (rows/bytes/pk/deps) + buckets
--   backup_export_rows()       one keyset-paginated batch of rows as JSON
--   backup_restore_rows()      insert / upsert a batch from a backup
--   backup_delete_missing()    drop rows absent from the backup (replace mode)
--   backup_storage_manifest()  list the files in a bucket
--
-- Every function is SECURITY DEFINER and refuses callers without the 'admin'
-- role. Idempotent: safe to run again.
-- ============================================================================

-- ── History tables ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.data_backups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label         text NOT NULL,
  notes         text,
  kind          text NOT NULL DEFAULT 'cloud',
  status        text NOT NULL DEFAULT 'running',
  topics        text[] NOT NULL DEFAULT '{}',
  tables        jsonb NOT NULL DEFAULT '{}'::jsonb,
  buckets       jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_rows    integer NOT NULL DEFAULT 0,
  total_bytes   bigint NOT NULL DEFAULT 0,
  storage_path  text,
  error_message text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

ALTER TABLE public.data_backups DROP CONSTRAINT IF EXISTS data_backups_kind_check;
ALTER TABLE public.data_backups ADD CONSTRAINT data_backups_kind_check
  CHECK (kind IN ('cloud', 'download', 'both', 'safety'));
ALTER TABLE public.data_backups DROP CONSTRAINT IF EXISTS data_backups_status_check;
ALTER TABLE public.data_backups ADD CONSTRAINT data_backups_status_check
  CHECK (status IN ('running', 'completed', 'partial', 'failed', 'cancelled'));

CREATE TABLE IF NOT EXISTS public.data_restores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_id     uuid REFERENCES public.data_backups(id) ON DELETE SET NULL,
  source        text NOT NULL DEFAULT 'cloud',
  source_name   text,
  mode          text NOT NULL,
  status        text NOT NULL DEFAULT 'running',
  tables        jsonb NOT NULL DEFAULT '{}'::jsonb,
  buckets       jsonb NOT NULL DEFAULT '{}'::jsonb,
  safety_backup_id uuid REFERENCES public.data_backups(id) ON DELETE SET NULL,
  error_message text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

ALTER TABLE public.data_restores DROP CONSTRAINT IF EXISTS data_restores_mode_check;
ALTER TABLE public.data_restores ADD CONSTRAINT data_restores_mode_check
  CHECK (mode IN ('missing', 'upsert', 'replace'));
ALTER TABLE public.data_restores DROP CONSTRAINT IF EXISTS data_restores_status_check;
ALTER TABLE public.data_restores ADD CONSTRAINT data_restores_status_check
  CHECK (status IN ('running', 'completed', 'partial', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_data_backups_created_at ON public.data_backups (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_restores_created_at ON public.data_restores (created_at DESC);

ALTER TABLE public.data_backups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_restores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage data_backups" ON public.data_backups;
CREATE POLICY "Admins manage data_backups" ON public.data_backups
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage data_restores" ON public.data_restores;
CREATE POLICY "Admins manage data_restores" ON public.data_restores
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── Private bucket for cloud copies ─────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('system-backups', 'system-backups', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Admins read system-backups" ON storage.objects;
CREATE POLICY "Admins read system-backups" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'system-backups' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins write system-backups" ON storage.objects;
CREATE POLICY "Admins write system-backups" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'system-backups' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update system-backups" ON storage.objects;
CREATE POLICY "Admins update system-backups" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'system-backups' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins delete system-backups" ON storage.objects;
CREATE POLICY "Admins delete system-backups" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'system-backups' AND public.has_role(auth.uid(), 'admin'));

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- Tables that are never part of a backup (the backup history itself).
CREATE OR REPLACE FUNCTION public.backup_excluded_tables()
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$ SELECT ARRAY['data_backups', 'data_restores']::text[] $$;

CREATE OR REPLACE FUNCTION public.backup_assert_admin()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Validates a table name and returns its single-column primary key.
CREATE OR REPLACE FUNCTION public.backup_table_pk(p_table text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_oid oid;
  v_pk  text[];
BEGIN
  SELECT c.oid INTO v_oid
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = p_table;

  IF v_oid IS NULL OR p_table = ANY (public.backup_excluded_tables()) THEN
    RAISE EXCEPTION 'Unknown or excluded table: %', p_table;
  END IF;

  SELECT array_agg(a.attname::text ORDER BY k.ord) INTO v_pk
  FROM pg_index i
  CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE i.indrelid = v_oid AND i.indisprimary;

  IF v_pk IS NULL OR array_length(v_pk, 1) <> 1 THEN
    RAISE EXCEPTION 'Table % needs a single-column primary key to be backed up', p_table;
  END IF;
  RETURN v_pk[1];
END;
$$;

-- ── Catalog ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.backup_catalog()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        record;
  v_rows   bigint;
  v_tables json[] := '{}';
  v_buckets json;
BEGIN
  PERFORM public.backup_assert_admin();

  FOR r IN
    SELECT c.oid, c.relname::text AS name,
           pg_total_relation_size(c.oid) AS bytes,
           (SELECT array_agg(a.attname::text ORDER BY a.attnum)
              FROM pg_index i
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
             WHERE i.indrelid = c.oid AND i.indisprimary) AS pk,
           (SELECT array_agg(a.attname::text ORDER BY a.attnum)
              FROM pg_attribute a
             WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS columns,
           (SELECT coalesce(array_agg(DISTINCT pc.relname::text), '{}')
              FROM pg_constraint f
              JOIN pg_class pc ON pc.oid = f.confrelid
              JOIN pg_namespace pn ON pn.oid = pc.relnamespace
             WHERE f.conrelid = c.oid AND f.contype = 'f'
               AND pn.nspname = 'public' AND pc.oid <> c.oid) AS depends_on
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND NOT (c.relname::text = ANY (public.backup_excluded_tables()))
    ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.name) INTO v_rows;
    v_tables := array_append(v_tables, json_build_object(
      'name', r.name,
      'rows', v_rows,
      'bytes', r.bytes,
      'pk', r.pk,
      'columns', r.columns,
      'depends_on', r.depends_on
    ));
  END LOOP;

  SELECT coalesce(json_agg(json_build_object(
           'id', b.id, 'public', b.public,
           'files', coalesce(s.files, 0), 'bytes', coalesce(s.bytes, 0)
         ) ORDER BY b.id), '[]'::json)
    INTO v_buckets
  FROM storage.buckets b
  LEFT JOIN (
    SELECT bucket_id, count(*) AS files, sum((metadata->>'size')::bigint) AS bytes
    FROM storage.objects GROUP BY bucket_id
  ) s ON s.bucket_id = b.id
  WHERE b.id <> 'system-backups';

  RETURN json_build_object(
    'generated_at', now(),
    'tables', array_to_json(v_tables),
    'buckets', v_buckets
  );
END;
$$;

-- ── Export one batch ────────────────────────────────────────────────────────
-- Keyset pagination on the primary key: pass the "last" value returned by the
-- previous call as p_after (NULL for the first batch).
CREATE OR REPLACE FUNCTION public.backup_export_rows(p_table text, p_after text DEFAULT NULL, p_limit integer DEFAULT 500)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pk     text;
  v_type   text;
  v_result json;
BEGIN
  PERFORM public.backup_assert_admin();
  v_pk := public.backup_table_pk(p_table);

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_type
  FROM pg_attribute a
  WHERE a.attrelid = format('public.%I', p_table)::regclass AND a.attname = v_pk;

  EXECUTE format(
    'WITH b AS (
       SELECT * FROM public.%1$I
        WHERE ($1::text IS NULL OR %2$I > $1::%3$s)
        ORDER BY %2$I
        LIMIT $2
     )
     SELECT json_build_object(
       ''rows'', coalesce((SELECT json_agg(b ORDER BY %2$I) FROM b), ''[]''::json),
       ''last'', (SELECT %2$I::text FROM b ORDER BY %2$I DESC LIMIT 1)
     )', p_table, v_pk, v_type)
  INTO v_result
  USING p_after, greatest(1, least(coalesce(p_limit, 500), 5000));

  RETURN v_result;
END;
$$;

-- ── Restore one batch ───────────────────────────────────────────────────────
-- p_mode: 'missing' -> insert rows whose key is absent, leave existing rows
--         'upsert'  -> insert absent rows and overwrite existing ones
-- ("replace" in the UI = 'upsert' for every batch, then backup_delete_missing.)
--
-- User triggers (updated_at stampers, validators) are disabled for the batch
-- only, inside this transaction, so restored rows keep their original values.
-- If the batch hits a foreign-key violation (parent row missing), it falls back
-- to row-by-row so the good rows still land and the bad ones are reported.
CREATE OR REPLACE FUNCTION public.backup_restore_rows(p_table text, p_rows jsonb, p_mode text DEFAULT 'missing')
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pk       text;
  v_cols     text;
  v_set      text;
  v_sql      text;
  v_total    integer;
  v_inserted integer := 0;
  v_updated  integer := 0;
  v_failed   integer := 0;
  v_errors   jsonb := '[]'::jsonb;
  v_row      jsonb;
  v_new      boolean;
  v_has_trg  boolean;
BEGIN
  PERFORM public.backup_assert_admin();
  v_pk := public.backup_table_pk(p_table);

  IF p_mode NOT IN ('missing', 'upsert') THEN
    RAISE EXCEPTION 'Unknown restore mode: %', p_mode;
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;
  v_total := jsonb_array_length(p_rows);
  IF v_total = 0 THEN
    RETURN json_build_object('inserted', 0, 'updated', 0, 'skipped', 0, 'failed', 0, 'errors', '[]'::json);
  END IF;

  -- Writable columns only (skip generated columns such as shas_pdf_pages.pdf_url).
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum),
         string_agg(format('%1$I = EXCLUDED.%1$I', a.attname), ', ' ORDER BY a.attnum)
           FILTER (WHERE a.attname <> v_pk)
    INTO v_cols, v_set
  FROM pg_attribute a
  WHERE a.attrelid = format('public.%I', p_table)::regclass
    AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '';

  v_sql := format(
    'INSERT INTO public.%1$I (%2$s) SELECT %2$s FROM jsonb_populate_recordset(NULL::public.%1$I, $1) ',
    p_table, v_cols);
  IF p_mode = 'upsert' AND v_set IS NOT NULL THEN
    v_sql := v_sql || format('ON CONFLICT (%I) DO UPDATE SET %s RETURNING (xmax = 0)', v_pk, v_set);
  ELSE
    v_sql := v_sql || format('ON CONFLICT (%I) DO NOTHING RETURNING true', v_pk);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = format('public.%I', p_table)::regclass AND NOT tgisinternal
  ) INTO v_has_trg;
  IF v_has_trg THEN
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', p_table);
  END IF;

  BEGIN
    EXECUTE format('WITH ins AS (%s) SELECT count(*) FILTER (WHERE r), count(*) FILTER (WHERE NOT r) FROM ins AS t(r)', v_sql)
      INTO v_inserted, v_updated
      USING p_rows;
  EXCEPTION WHEN foreign_key_violation OR check_violation OR not_null_violation
                 OR unique_violation OR invalid_text_representation THEN
    v_inserted := 0; v_updated := 0;
    FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
      BEGIN
        v_new := NULL;
        EXECUTE v_sql INTO v_new USING jsonb_build_array(v_row);
        IF v_new IS TRUE THEN v_inserted := v_inserted + 1;
        ELSIF v_new IS FALSE THEN v_updated := v_updated + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_failed := v_failed + 1;
        IF jsonb_array_length(v_errors) < 5 THEN
          v_errors := v_errors || jsonb_build_object('id', v_row->>v_pk, 'error', SQLERRM);
        END IF;
      END;
    END LOOP;
  END;

  IF v_has_trg THEN
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', p_table);
  END IF;

  RETURN json_build_object(
    'inserted', v_inserted,
    'updated',  v_updated,
    'skipped',  v_total - v_inserted - v_updated - v_failed,
    'failed',   v_failed,
    'errors',   v_errors
  );
END;
$$;

-- ── Replace mode: remove rows that are not in the backup ────────────────────
-- Called once per table after all of its batches were upserted. Deleting only
-- rows the backup does not have means ON DELETE CASCADE can only reach child
-- rows of parents that are gone anyway; nothing present in the backup is lost.
CREATE OR REPLACE FUNCTION public.backup_delete_missing(p_table text, p_keep text[])
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pk      text;
  v_type    text;
  v_deleted integer;
BEGIN
  PERFORM public.backup_assert_admin();
  v_pk := public.backup_table_pk(p_table);

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_type
  FROM pg_attribute a
  WHERE a.attrelid = format('public.%I', p_table)::regclass AND a.attname = v_pk;

  EXECUTE format('DELETE FROM public.%1$I WHERE NOT (%2$I = ANY ($1::%3$s[]))', p_table, v_pk, v_type)
    USING coalesce(p_keep, '{}');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN json_build_object('deleted', v_deleted);
END;
$$;

DROP FUNCTION IF EXISTS public.backup_clear_tables(text[]);

-- ── Storage manifest ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.backup_storage_manifest(p_bucket text, p_after text DEFAULT NULL, p_limit integer DEFAULT 1000)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  PERFORM public.backup_assert_admin();
  IF p_bucket = 'system-backups' THEN
    RAISE EXCEPTION 'system-backups is not part of a backup';
  END IF;

  WITH b AS (
    SELECT o.name, (o.metadata->>'size')::bigint AS size,
           o.metadata->>'mimetype' AS mimetype, o.updated_at
    FROM storage.objects o
    WHERE o.bucket_id = p_bucket
      AND (p_after IS NULL OR o.name > p_after)
    ORDER BY o.name COLLATE "C"
    LIMIT greatest(1, least(coalesce(p_limit, 1000), 5000))
  )
  SELECT json_build_object(
    'files', coalesce((SELECT json_agg(b ORDER BY b.name COLLATE "C") FROM b), '[]'::json),
    'last', (SELECT b.name FROM b ORDER BY b.name COLLATE "C" DESC LIMIT 1)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ── Permissions ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.backup_assert_admin()                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.backup_table_pk(text)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.backup_catalog()                             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.backup_export_rows(text, text, integer)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.backup_restore_rows(text, jsonb, text)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.backup_delete_missing(text, text[])           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.backup_storage_manifest(text, text, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.backup_catalog()                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.backup_export_rows(text, text, integer)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.backup_restore_rows(text, jsonb, text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.backup_delete_missing(text, text[])           TO authenticated;
GRANT EXECUTE ON FUNCTION public.backup_storage_manifest(text, text, integer) TO authenticated;
