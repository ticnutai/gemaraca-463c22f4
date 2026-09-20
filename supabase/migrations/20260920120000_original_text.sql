-- שמירת הטקסט המקורי לפני עיצוב, כדי שאפשר יהיה תמיד לחזור אליו
-- ולהריץ עליו חילוץ מראי מקומות בלי קוד ה-CSS של התבנית.
ALTER TABLE public.psakei_din ADD COLUMN IF NOT EXISTS original_text text;
COMMENT ON COLUMN public.psakei_din.original_text IS 'הטקסט כפי שהתקבל מהמקור, לפני שהוחלף ב-HTML מעוצב';
