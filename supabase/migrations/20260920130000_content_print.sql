-- טביעת אצבע של תוכן הפסק, לזיהוי כפילויות גם כשהכותרת שונה.
-- מחושבת מ-2,000 התווים הראשונים אחרי הסרת תגיות וכל מה שאינו אות או ספרה.
ALTER TABLE public.psakei_din ADD COLUMN IF NOT EXISTS content_print text;

UPDATE public.psakei_din
   SET content_print = md5(left(regexp_replace(regexp_replace(coalesce(original_text, full_text, ''), '<[^>]+>', ' ', 'g'), '[^א-ת0-9]', '', 'g'), 2000))
 WHERE content_print IS NULL
   AND length(regexp_replace(regexp_replace(coalesce(original_text, full_text, ''), '<[^>]+>', ' ', 'g'), '[^א-ת0-9]', '', 'g')) >= 200;

CREATE INDEX IF NOT EXISTS idx_psakei_din_content_print ON public.psakei_din (content_print);
