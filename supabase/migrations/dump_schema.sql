-- שליפת הסכימה האמיתית מן השרת
-- ─────────────────────────────────────────────────────────────
-- אינה מיגרציה. היא קוראת את `information_schema` ואת `pg_catalog` וכותבת
-- תמונה מלאה של הסכימה לטבלה, כדי שאפשר יהיה לייצר ממנה DDL ולהקים את
-- אותו מסד בפרויקט סופהבייס אחר.
--
-- למה לא להסתמך על קובצי המיגרציה: הם נצברו לאורך הזמן, חלקם הורצו ידנית
-- וחלק מן השינויים נעשו מחוץ להם. **מה שבשרת הוא האמת**, וקובצי המיגרציה
-- הם רק ההיסטוריה שהובילה אליו.
--
-- הכול חוזר כערך JSON אחד, כי `run-migration` נופלת על כמה מערכי שורות.
--
-- הרצה:  node scripts/direct-run.mjs file "supabase/migrations/dump_schema.sql"

CREATE TABLE IF NOT EXISTS public.schema_snapshots (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at  timestamptz NOT NULL DEFAULT now(),
  snapshot  jsonb NOT NULL
);
ALTER TABLE public.schema_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "schema_read" ON public.schema_snapshots;
CREATE POLICY "schema_read" ON public.schema_snapshots FOR SELECT USING (true);
DROP POLICY IF EXISTS "schema_write" ON public.schema_snapshots;
CREATE POLICY "schema_write" ON public.schema_snapshots FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

INSERT INTO public.schema_snapshots (snapshot)
SELECT jsonb_build_object(

  -- העמודות: שם, טיפוס, ברירת מחדל, והאם מותר ריק
  'columns', (SELECT jsonb_agg(c ORDER BY c->>'table_name', (c->>'ordinal_position')::int)
    FROM (SELECT jsonb_build_object(
        'table_name',       table_name,
        'column_name',      column_name,
        'ordinal_position', ordinal_position,
        'data_type',        data_type,
        'udt_name',         udt_name,
        'max_length',       character_maximum_length,
        'numeric_precision',numeric_precision,
        'numeric_scale',    numeric_scale,
        'is_nullable',      is_nullable,
        'column_default',   column_default) AS c
      FROM information_schema.columns
      WHERE table_schema = 'public') x),

  -- אילוצים: מפתח ראשי, ייחודיות, מפתחות זרים ובדיקות
  'constraints', (SELECT jsonb_agg(jsonb_build_object(
      'table_name', rel.relname,
      'name',       con.conname,
      'type',       CASE con.contype
                      WHEN 'p' THEN 'PRIMARY KEY' WHEN 'u' THEN 'UNIQUE'
                      WHEN 'f' THEN 'FOREIGN KEY' WHEN 'c' THEN 'CHECK' ELSE con.contype::text END,
      'definition', pg_get_constraintdef(con.oid)))
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'),

  -- אינדקסים. המפתח הראשוני והייחודיות כבר למעלה, ולכן רק השאר
  'indexes', (SELECT jsonb_agg(jsonb_build_object(
      'table_name', tablename,
      'name',       indexname,
      'definition', indexdef))
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname NOT IN (SELECT conname FROM pg_constraint)),

  -- מדיניות RLS: בלעדיה המסד החדש ייראה ריק לכל מי שאינו service_role
  'policies', (SELECT jsonb_agg(jsonb_build_object(
      'table_name', tablename,
      'name',       policyname,
      'permissive', permissive,
      'roles',      roles,
      'command',    cmd,
      'using',      qual,
      'with_check', with_check))
    FROM pg_policies WHERE schemaname = 'public'),

  -- אילו טבלאות בכלל עם RLS פעיל
  'rls', (SELECT jsonb_agg(jsonb_build_object(
      'table_name', c.relname, 'enabled', c.relrowsecurity))
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'),

  -- פונקציות שהאפליקציה קוראת להן
  'functions', (SELECT jsonb_agg(jsonb_build_object(
      'name',       p.proname,
      'definition', pg_get_functiondef(p.oid)))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'),

  -- טיפוסים מותאמים (enum וכדומה)
  'enums', (SELECT jsonb_agg(jsonb_build_object(
      'name',   t.typname,
      'values', (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
                 FROM pg_enum e WHERE e.enumtypid = t.oid)))
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'),

  -- טריגרים
  'triggers', (SELECT jsonb_agg(jsonb_build_object(
      'table_name', c.relname,
      'name',       tg.tgname,
      'definition', pg_get_triggerdef(tg.oid)))
    FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT tg.tgisinternal),

  -- ספירת שורות לכל טבלה, לאימות אחרי השחזור
  'row_counts', (SELECT jsonb_object_agg(relname, n_live_tup)
    FROM pg_stat_user_tables)
);
