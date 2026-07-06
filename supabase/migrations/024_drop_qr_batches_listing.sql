-- Migration 024: Audit fix H13 (follow-up) — remove the last broad storage
-- listing policy. QR-batch PDFs are actually stored in the `public` bucket and
-- streamed through /api/equipment/qr-batches/[id]/pdf, so the `qr-batches`
-- bucket's authenticated SELECT policy is unused. Dropping it fully closes the
-- "public bucket allows listing" advisor finding (public object URLs, if any,
-- still resolve because the bucket is public).
DROP POLICY IF EXISTS "Authenticated can read QR batches" ON storage.objects;
