-- ============================================================
-- Migration 035: Audit B1 — stop accepting HEIC into the photo buckets.
--
-- HEIC depends on the patent-encumbered HEVC codec, which Chrome, Firefox and
-- Edge have never licensed. A HEIC upload SUCCEEDED and then rendered as a
-- blank tile everywhere except Safari — and jsPDF dropped it out of the
-- client-facing report PDF with no warning. Verified on 2026-07-20: the
-- signed URL returned HTTP 200 with the full 1.4 MB payload while the
-- browser reported naturalWidth === 0.
--
-- The app now transcodes HEIC to JPEG in the browser at selection time
-- (src/lib/image-prepare.ts), so nothing should ever try to store HEIC again.
-- Removing it from the allow-list makes that a guarantee rather than a hope:
-- if the client-side conversion ever fails, the upload is REJECTED loudly
-- instead of quietly succeeding into a photo nobody can see.
--
-- Applied live to zabfuqxjjunsppotfrel on 2026-07-20.
-- ============================================================

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id IN ('job-photos', 'equipment-photos');
