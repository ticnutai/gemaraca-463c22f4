-- אבחון מצב השרת
-- ─────────────────────────────────────────────────────────────
-- אינה מיגרציה: אינה משנה דבר, רק מדווחת. השם בלי חותמת זמן בכוונה,
-- כדי שמריץ המיגרציות לא יראה בה מיגרציה שממתינה.
--
-- הכול מוחזר כערך JSON **אחד**, ולא כמה טבלאות תוצאה. פונקציית
-- `run-migration` בנויה לשינויים ולא לשאילתות, והיא נופלת על
-- "The result fields returned by the database don't match the defined
-- structure" כשמחזירים לה כמה מערכי שורות.
--
-- הסדר הוא סדר החשד: קודם מה שחוסם, אחר כך מי רץ זמן רב, ורק בסוף
-- התמונה הכללית.
--
-- הרצה:  node scripts/direct-run.mjs file "supabase/migrations/diagnose_server.sql"

-- הפונקציה מאשרת הצלחה אך אינה מחזירה תוצאות, ולכן האבחון
-- נכתב לטבלה ונקרא ממנה בלקוח הרגיל.
CREATE TABLE IF NOT EXISTS public.server_diagnostics (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at   timestamptz NOT NULL DEFAULT now(),
  report     jsonb NOT NULL
);
ALTER TABLE public.server_diagnostics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "diag_read" ON public.server_diagnostics;
CREATE POLICY "diag_read" ON public.server_diagnostics FOR SELECT USING (true);
DROP POLICY IF EXISTS "diag_write" ON public.server_diagnostics;
CREATE POLICY "diag_write" ON public.server_diagnostics FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

INSERT INTO public.server_diagnostics (report)
SELECT (jsonb_build_object(

  -- מצב כללי: מתי המסד עלה. זמן קצר אחרי תקלה = הופעל מחדש
  'כללי', (SELECT jsonb_build_object(
      'עלה_בזמן',    pg_postmaster_start_time(),
      'פעיל_כבר',    (now() - pg_postmaster_start_time())::text,
      'במצב_שחזור',  pg_is_in_recovery(),
      'גודל_המסד',   pg_size_pretty(pg_database_size(current_database())),
      'גרסה',        current_setting('server_version'))),

  -- תקרת החיבורים מול הניצול. מסד שנגמרו לו החיבורים נתקע בדיוק כפי שראינו
  'חיבורים', (SELECT jsonb_build_object(
      'מותר',               current_setting('max_connections'),
      'בשימוש',             (SELECT count(*) FROM pg_stat_activity),
      'פעילים',             (SELECT count(*) FROM pg_stat_activity WHERE state = 'active'),
      'סרק',                (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle'),
      'עסקה_תלויה',         (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction'),
      'פסק_זמן_שאילתה',     current_setting('statement_timeout'),
      'פסק_זמן_עסקה_תלויה', current_setting('idle_in_transaction_session_timeout'))),

  -- החשוד הראשון: מי מחזיק נעילה ואינו משחרר
  'חסימות', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'ממתין',   blocked.pid,
      'חוסם',    blocking.pid,
      'סוג',     blocked.wait_event_type,
      'משך',     (now() - blocking.query_start)::text,
      'שאילתה',  left(blocking.query, 100)))
    FROM pg_stat_activity blocked
    JOIN pg_stat_activity blocking ON blocking.pid = ANY(pg_blocking_pids(blocked.pid))
    WHERE cardinality(pg_blocking_pids(blocked.pid)) > 0), '[]'::jsonb),

  -- שאילתות שרצות יותר מדקה
  'ארוכות', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'משתמש',  usename,
      'יישום',  application_name,
      'מצב',    state,
      'משך',    (now() - query_start)::text,
      'שאילתה', left(query, 110)))
    FROM pg_stat_activity
    WHERE state <> 'idle' AND query_start < now() - interval '1 minute'
      AND pid <> pg_backend_pid()), '[]'::jsonb),

  -- עסקאות שנותרו תלויות: מחזיקות נעילות ואינן עושות דבר
  'תלויות', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'משתמש',  usename,
      'תלויה',  (now() - state_change)::text,
      'אחרונה', left(query, 90)))
    FROM pg_stat_activity WHERE state = 'idle in transaction'), '[]'::jsonb),

  -- שמונה הטבלאות הגדולות, ושורות מתות שממתינות לניקוי
  'טבלאות', COALESCE((SELECT jsonb_agg(t) FROM (
      SELECT relname AS טבלה,
             pg_size_pretty(pg_total_relation_size(relid)) AS נפח,
             n_live_tup AS חיות,
             n_dead_tup AS מתות,
             last_autovacuum AS ניקוי_אחרון
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC LIMIT 8) t), '[]'::jsonb)

));
