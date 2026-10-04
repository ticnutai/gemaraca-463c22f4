-- עין משפט נר מצוה: מן הדף אל ההלכה
-- ─────────────────────────────────────────────────────────────
-- כל מה שבנינו עד כה הולך בכיוון אחד — מפסק דין אל דף הגמרא. עין משפט
-- הולך בכיוון ההפוך: מן הדף אל ההלכה שנפסקה ממנו ברמב"ם, בסמ"ג, בטור
-- ובשולחן ערוך. זהו מפתח מסורתי בן מאות שנים, מתויג ביד.
--
--   קידושין ב ע"א → רמב"ם אישות א,ב · סמ"ג עשין מח ·
--                   טור אה"ע כו · שולחן ערוך אה"ע כו,ד
--
-- המקור: ספריא, קישורים מסוג `ein mishpat / ner mitsvah`. הטקסטים שאליהם
-- מפנים הם נחלת הכלל.
--
-- הטבלה אינה תלויה ב-psakei_din: היא מתארת את הש"ס עצמו, לא פסק מסוים.
-- לכן המפתח הוא מסכת+דף+עמוד, והיא נשאלת מדף הסוגיה ומן העץ המאוחד.

CREATE TABLE IF NOT EXISTS public.ein_mishpat (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tractate    text    NOT NULL,           -- שם המסכת בעברית
  daf         integer NOT NULL,
  amud        text    CHECK (amud IN ('a','b')),
  sefaria_ref text    NOT NULL,           -- "Kiddushin 2a" — העוגן בספריא
  target_ref  text    NOT NULL,           -- "Shulchan Arukh, Even HaEzer 26:4"
  target_book text,                       -- "Shulchan Arukh" — לקיבוץ ולסינון
  category    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- אותו קישור משני צדדים של אותו עמוד אינו שני קישורים
  UNIQUE (tractate, daf, amud, target_ref)
);

CREATE INDEX IF NOT EXISTS idx_ein_mishpat_daf  ON public.ein_mishpat (tractate, daf, amud);
CREATE INDEX IF NOT EXISTS idx_ein_mishpat_book ON public.ein_mishpat (target_book);

-- קריאה פתוחה כמו בשאר הטבלאות של הפרויקט; הכתיבה דרך הכלים בלבד.
ALTER TABLE public.ein_mishpat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ein_mishpat_read" ON public.ein_mishpat;
CREATE POLICY "ein_mishpat_read" ON public.ein_mishpat
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "ein_mishpat_write" ON public.ein_mishpat;
CREATE POLICY "ein_mishpat_write" ON public.ein_mishpat
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

COMMENT ON TABLE public.ein_mishpat IS
  'עין משפט נר מצוה — מדף הגמרא אל ההלכה ברמב"ם, סמ"ג, טור ושולחן ערוך. מקור: ספריא.';
