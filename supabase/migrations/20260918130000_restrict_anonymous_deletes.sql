-- ============================================================================
-- Deleting content requires a signed-in user
-- ----------------------------------------------------------------------------
-- Until now the anon key (public in every browser) could DELETE rows from the
-- core content tables and delete files from storage without logging in: one
-- request could wipe all psakei din. This limits DELETE to authenticated users.
-- INSERT/UPDATE are unchanged so anonymous flows (upload, analysis, indexing)
-- keep working. shas_download_progress and function_logs are operational
-- tables and are left as they were. Idempotent.
-- ============================================================================

DROP POLICY IF EXISTS "Anyone can delete pattern sugya links" ON public.pattern_sugya_links;
DROP POLICY IF EXISTS "Signed-in users can delete pattern_sugya_links" ON public.pattern_sugya_links;
CREATE POLICY "Signed-in users can delete pattern_sugya_links" ON public.pattern_sugya_links FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "pdf_annotations_delete" ON public.pdf_annotations;
DROP POLICY IF EXISTS "Signed-in users can delete pdf_annotations" ON public.pdf_annotations;
CREATE POLICY "Signed-in users can delete pdf_annotations" ON public.pdf_annotations FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "psak_sections_delete" ON public.psak_sections;
DROP POLICY IF EXISTS "Signed-in users can delete psak_sections" ON public.psak_sections;
CREATE POLICY "Signed-in users can delete psak_sections" ON public.psak_sections FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow delete psakei din" ON public.psakei_din;
DROP POLICY IF EXISTS "Signed-in users can delete psakei_din" ON public.psakei_din;
CREATE POLICY "Signed-in users can delete psakei_din" ON public.psakei_din FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone can delete smart index results" ON public.smart_index_results;
DROP POLICY IF EXISTS "Signed-in users can delete smart_index_results" ON public.smart_index_results;
CREATE POLICY "Signed-in users can delete smart_index_results" ON public.smart_index_results FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow delete sugya psak links" ON public.sugya_psak_links;
DROP POLICY IF EXISTS "Signed-in users can delete sugya_psak_links" ON public.sugya_psak_links;
CREATE POLICY "Signed-in users can delete sugya_psak_links" ON public.sugya_psak_links FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone can delete text annotations" ON public.text_annotations;
DROP POLICY IF EXISTS "Signed-in users can delete text_annotations" ON public.text_annotations;
CREATE POLICY "Signed-in users can delete text_annotations" ON public.text_annotations FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "user_books_delete" ON public.user_books;
DROP POLICY IF EXISTS "Signed-in users can delete user_books" ON public.user_books;
CREATE POLICY "Signed-in users can delete user_books" ON public.user_books FOR DELETE TO authenticated USING (true);

-- ── Storage ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public delete for psakei-din-files" ON storage.objects;
DROP POLICY IF EXISTS "Signed-in users can delete psakei-din-files" ON storage.objects;
CREATE POLICY "Signed-in users can delete psakei-din-files" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'psakei-din-files');

DROP POLICY IF EXISTS "Authenticated users can delete shas PDFs" ON storage.objects;
CREATE POLICY "Authenticated users can delete shas PDFs" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'shas-pdf-pages');

DROP POLICY IF EXISTS "Authenticated users can update shas PDFs" ON storage.objects;
CREATE POLICY "Authenticated users can update shas PDFs" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'shas-pdf-pages');
