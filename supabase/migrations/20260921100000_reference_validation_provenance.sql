-- מי אימת את מראה המקום, בנפרד ממי חילץ אותו
--
-- עד כאן סקריפט האימות מול ספריא כתב source='sefaria-verified', ובכך מחק
-- את המידע מי חילץ את ההפניה מלכתחילה (regex / ai / site-index). אימות אינו
-- מקור חילוץ, ולכן הוא נשמר בעמודות משלו ו-source חוזר לשמש לייחוס בלבד.

ALTER TABLE public.talmud_references
  ADD COLUMN IF NOT EXISTS validated_by text,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz;

COMMENT ON COLUMN public.talmud_references.validated_by IS
  'מי אימת את ההפניה: sefaria (מנוע הזיהוי של ספריא), user (תיקון ידני), או ריק';
COMMENT ON COLUMN public.talmud_references.validated_at IS 'מועד האימות האחרון';
COMMENT ON COLUMN public.talmud_references.source IS
  'מי חילץ את ההפניה: regex / ai / site-index / extracted (לא ידוע)';

CREATE INDEX IF NOT EXISTS talmud_references_validated_by_idx
  ON public.talmud_references (validated_by)
  WHERE validated_by IS NOT NULL;
