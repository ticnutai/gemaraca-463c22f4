-- ============================================================================
-- מראי מקומות שאינם תלמוד בבלי: רמב"ם, שולחן ערוך, תלמוד ירושלמי
-- ----------------------------------------------------------------------------
-- talmud_references מחזיקה רק בבלי (מסכת/דף/עמוד). אינדקס המקורות של
-- psakim.org מתייג כל פסק גם בשולחן ערוך (סימן/סעיף), ברמב"ם (פרק/הלכה)
-- ובירושלמי (פרק/הלכה) — 6,149 הפניות מדויקות שלא היו בשימוש.
-- אלה תיוגים ידניים של האתר, ולכן אינם דורשים ניתוח AI כלל.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.psak_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  psak_din_id   uuid NOT NULL REFERENCES public.psakei_din(id) ON DELETE CASCADE,
  corpus        text NOT NULL,          -- רמב"ם / שולחן ערוך / ירושלמי
  book          text,                   -- חושן משפט / הלכות שכירות / בבא מציעא
  section_group text,                   -- "רצא-שב - הלכות פקדון" (שולחן ערוך בלבד)
  section       text,                   -- סימן שא / פרק ב
  subsection    text,                   -- סעיף א / הלכה ג
  display       text NOT NULL,          -- "שולחן ערוך, חושן משפט, סימן שא, סעיף א"
  raw_path      text NOT NULL,          -- הנתיב כפי שהוא מופיע באתר המקור
  source        text NOT NULL DEFAULT 'site-index',
  confidence    text NOT NULL DEFAULT 'high',
  validation_status text NOT NULL DEFAULT 'correct',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_psak_sources_psak ON public.psak_sources (psak_din_id);
CREATE INDEX IF NOT EXISTS idx_psak_sources_corpus ON public.psak_sources (corpus, book, section);
-- display מרכז את הנתיב כולו, ולכן הוא המפתח הטבעי למניעת כפילויות
DROP INDEX IF EXISTS public.idx_psak_sources_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_psak_sources_unique ON public.psak_sources (psak_din_id, display);

ALTER TABLE public.psak_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read psak sources" ON public.psak_sources;
CREATE POLICY "Anyone can read psak sources" ON public.psak_sources FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can add psak sources" ON public.psak_sources;
CREATE POLICY "Anyone can add psak sources" ON public.psak_sources FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Signed-in users can update psak sources" ON public.psak_sources;
CREATE POLICY "Signed-in users can update psak sources" ON public.psak_sources
  FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Signed-in users can delete psak sources" ON public.psak_sources;
CREATE POLICY "Signed-in users can delete psak sources" ON public.psak_sources
  FOR DELETE TO authenticated USING (true);
