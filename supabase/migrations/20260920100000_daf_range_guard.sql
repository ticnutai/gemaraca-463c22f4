-- ============================================================================
-- שמירה על תקינות מראי מקומות: דף חייב להיות בין ב׳ לדף האחרון במסכת
-- ----------------------------------------------------------------------------
-- נמצאו 1,547 קישורי סוגיה (15%) ו-262 מראי מקומות שמפנים לדף שאינו קיים,
-- למשל "סנהדרין דף 214" כשיש במסכת 113 דפים. חלקם נובעים מספירת עמודים
-- במקום דפים, וחלקם ממילים עבריות שנקראו כגימטריה.
--
-- הטבלה masechtot_daf_limits מחזיקה את מספר הדפים בכל מסכת, וטריגר בודק
-- כל כתיבה: מראה מקום פסול ב-talmud_references מסומן 'incorrect' במקום
-- להיחסם, וקישור סוגיה פסול פשוט לא נשמר.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.masechtot_daf_limits (
  name    text PRIMARY KEY,
  max_daf integer NOT NULL CHECK (max_daf > 1)
);

INSERT INTO public.masechtot_daf_limits (name, max_daf) VALUES
  ('ברכות',64),('שבת',157),('עירובין',105),('פסחים',121),('שקלים',22),('יומא',88),
  ('סוכה',56),('ביצה',40),('ראש השנה',35),('תענית',31),('מגילה',32),('מועד קטן',29),
  ('חגיגה',27),('יבמות',122),('כתובות',112),('נדרים',91),('נזיר',66),('סוטה',49),
  ('גיטין',90),('קידושין',82),('בבא קמא',119),('בבא מציעא',119),('בבא בתרא',176),
  ('סנהדרין',113),('מכות',24),('שבועות',49),('עבודה זרה',76),('הוריות',14),
  ('זבחים',120),('מנחות',110),('חולין',142),('בכורות',61),('ערכין',34),('תמורה',34),
  ('כריתות',28),('מעילה',22),('תמיד',33),('נידה',73)
ON CONFLICT (name) DO UPDATE SET max_daf = EXCLUDED.max_daf;

ALTER TABLE public.masechtot_daf_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read daf limits" ON public.masechtot_daf_limits;
CREATE POLICY "Anyone can read daf limits" ON public.masechtot_daf_limits FOR SELECT USING (true);

-- ── ניקוי מה שכבר נשמר ──────────────────────────────────────────────────────
DELETE FROM public.pattern_sugya_links l
 USING public.masechtot_daf_limits m
 WHERE m.name = l.masechet AND l.daf ~ '^[0-9]+$'
   AND (l.daf::int > m.max_daf OR l.daf::int < 2);

UPDATE public.talmud_references r
   SET validation_status = 'incorrect'
  FROM public.masechtot_daf_limits m
 WHERE m.name = r.tractate AND r.daf ~ '^[0-9]+$'
   AND (r.daf::int > m.max_daf OR r.daf::int < 2)
   AND r.validation_status <> 'incorrect';

-- ── הגנה על כתיבות עתידיות ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_daf_range()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_daf  text;
  v_max  integer;
BEGIN
  IF TG_TABLE_NAME = 'talmud_references' THEN
    v_name := NEW.tractate; v_daf := NEW.daf;
  ELSE
    v_name := NEW.masechet; v_daf := NEW.daf;
  END IF;

  IF v_daf IS NULL OR v_daf !~ '^[0-9]+$' THEN RETURN NEW; END IF;

  SELECT max_daf INTO v_max FROM public.masechtot_daf_limits WHERE name = v_name;
  IF v_max IS NULL THEN RETURN NEW; END IF;

  IF v_daf::int > v_max OR v_daf::int < 2 THEN
    IF TG_TABLE_NAME = 'talmud_references' THEN
      NEW.validation_status := 'incorrect';   -- נשמר, אבל מסומן כשגוי
      RETURN NEW;
    END IF;
    RETURN NULL;                              -- קישור סוגיה פסול לא נשמר
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_daf_range_refs ON public.talmud_references;
CREATE TRIGGER guard_daf_range_refs
  BEFORE INSERT OR UPDATE ON public.talmud_references
  FOR EACH ROW EXECUTE FUNCTION public.guard_daf_range();

DROP TRIGGER IF EXISTS guard_daf_range_links ON public.pattern_sugya_links;
CREATE TRIGGER guard_daf_range_links
  BEFORE INSERT OR UPDATE ON public.pattern_sugya_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_daf_range();
