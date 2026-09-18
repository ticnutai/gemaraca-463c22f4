-- Scheduled automatic backups get their own kind so retention can prune them
-- (and safety backups) without ever touching backups made by hand. Idempotent.
ALTER TABLE public.data_backups DROP CONSTRAINT IF EXISTS data_backups_kind_check;
ALTER TABLE public.data_backups ADD CONSTRAINT data_backups_kind_check
  CHECK (kind IN ('cloud', 'download', 'both', 'safety', 'auto'));
