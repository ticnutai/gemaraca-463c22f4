-- ============================================================================
-- מרשם מקורות הפסקים
-- ----------------------------------------------------------------------------
-- לכל פסק נשמר עכשיו מזהה מקור אחד (source_key), ולכל מקור יש רשומה במרשם
-- עם שם לתצוגה, כתובת האתר, הרישוי, נוסח הייחוס הנדרש, והאם להציג אותו.
-- כך אפשר לסנן פסקים לפי המקור שממנו הובאו, ולכבות מקור שלא רוצים להציג.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.psak_source_registry (
  key         text PRIMARY KEY,
  label       text NOT NULL,
  site_url    text,
  license     text,                       -- נחלת הכלל / כל הזכויות שמורות / CC-BY ...
  attribution text,                       -- נוסח הייחוס שיש להציג, אם נדרש
  enabled     boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.psak_source_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read source registry" ON public.psak_source_registry;
CREATE POLICY "Anyone can read source registry" ON public.psak_source_registry FOR SELECT USING (true);

DROP POLICY IF EXISTS "Signed-in users can manage source registry" ON public.psak_source_registry;
CREATE POLICY "Signed-in users can manage source registry" ON public.psak_source_registry
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.psak_source_registry (key, label, site_url, license, attribution, sort_order) VALUES
  ('psakim.org', 'אתר פסקים', 'https://www.psakim.org', 'שימוש לא מסחרי בלבד, עם ייחוס', 'אתר פסקים psakim.org', 10),
  ('gov.il', 'בתי הדין הרבניים', 'https://www.gov.il/he/Departments/DynamicCollectors/verdict_the_rabbinical_courts', 'נחלת הכלל (סעיף 6 לחוק זכות יוצרים)', 'בתי הדין הרבניים, gov.il', 20),
  ('upload', 'קבצים שהועלו למערכת', NULL, 'לא ידוע', NULL, 30),
  ('other', 'אחר', NULL, 'לא ידוע', NULL, 900)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, site_url = EXCLUDED.site_url,
      license = EXCLUDED.license, attribution = EXCLUDED.attribution;

-- ── שיוך הפסקים הקיימים ────────────────────────────────────────────────────
ALTER TABLE public.psakei_din ADD COLUMN IF NOT EXISTS source_key text;

UPDATE public.psakei_din SET source_key = 'gov.il'
 WHERE source_key IS NULL AND 'gov.il' = ANY(tags);

UPDATE public.psakei_din SET source_key = 'psakim.org'
 WHERE source_key IS NULL
   AND ('psakim.org' = ANY(tags) OR coalesce(original_text, full_text, '') LIKE '%psakim.org/Psakim/File%');

UPDATE public.psakei_din SET source_key = 'upload'
 WHERE source_key IS NULL AND source_url LIKE '%storage/v1/object%';

UPDATE public.psakei_din SET source_key = 'other' WHERE source_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_psakei_din_source_key ON public.psakei_din (source_key);

-- מקור חדש שנכנס בעתיד יקבל רשומה במרשם אוטומטית, כדי שלא ייעלם מהסינון
CREATE OR REPLACE FUNCTION public.ensure_source_in_registry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.source_key IS NOT NULL THEN
    INSERT INTO public.psak_source_registry (key, label)
    VALUES (NEW.source_key, NEW.source_key)
    ON CONFLICT (key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_source_in_registry_trg ON public.psakei_din;
CREATE TRIGGER ensure_source_in_registry_trg
  BEFORE INSERT OR UPDATE OF source_key ON public.psakei_din
  FOR EACH ROW EXECUTE FUNCTION public.ensure_source_in_registry();
