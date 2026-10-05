-- דגל ייעודי להפניות שממתינות להכרעה ידנית
-- ─────────────────────────────────────────────────────────────
-- סימנתי 65 הפניות שאינן לדף גמרא ("שו״ע אה״ע לח, כד" הוא סימן לח סעיף
-- כד, לא קידושין לח ע״ב) בערך `validation_status = 'pending'`.
--
-- אבל `pending` הוא **ערך ברירת המחדל** של העמודה, ולכן 10,702 שורות
-- נושאות אותו — רובן פשוט מעולם לא נבדקו. הסימון היה בלתי ניתן להבחנה
-- ממצבן, כלומר חסר תועלת.
--
-- עמודה נפרדת פותרת זאת: היא ריקה אצל כולם חוץ ממי שסומן במפורש.

ALTER TABLE public.talmud_references
  ADD COLUMN IF NOT EXISTS review_reason text;

CREATE INDEX IF NOT EXISTS idx_refs_review
  ON public.talmud_references (review_reason)
  WHERE review_reason IS NOT NULL;

COMMENT ON COLUMN public.talmud_references.review_reason IS
  'סיבה להכרעה ידנית. NULL = אין צורך. אל להשתמש ב-validation_status לכך — pending הוא ברירת המחדל.';

NOTIFY pgrst, 'reload schema';
