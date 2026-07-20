-- ============================================================
-- Migration 034: Audit S1 — make the photo buckets PRIVATE.
--
-- `job-photos` and `equipment-photos` were public buckets. A public bucket is
-- served straight off the CDN with no auth and no RLS, so anyone holding an
-- object URL could fetch a photo taken inside a customer's property — forever,
-- with no way to revoke short of deleting the file. Migration 028 stopped
-- portal clients reading each other's photos *through the app*; this closes
-- the raw URL.
--
-- Reads now go through POST /api/storage/sign, which mints a 1-hour signed URL
-- after checking (a) the object sits under the caller's own organisation
-- prefix and (b) for portal clients, that they can actually SEE the owning job
-- — answered by querying `jobs` with the client's own session so RLS stays the
-- single source of truth.
--
-- ORDER MATTERS: the application code that signs URLs (commit 19b6e05) must be
-- deployed BEFORE this migration runs, otherwise every photo 404s. It reads
-- both legacy public URLs and new `bucket/path` refs, so there is no window
-- where images break.
--
-- `company-assets` deliberately stays PUBLIC: the org logo is rendered inside
-- transactional emails, and email clients cannot send an Authorization header.
--
-- Applied live to zabfuqxjjunsppotfrel on 2026-07-20. Verified: the previously
-- public object URL now returns {"statusCode":"404","error":"Bucket not found"}.
-- ============================================================

UPDATE storage.buckets
   SET public = false
 WHERE id IN ('job-photos', 'equipment-photos');

-- Parity hardening while we're here: equipment-photos had no size or type
-- limit, so it accepted arbitrary files of any size. Match job-photos.
UPDATE storage.buckets
   SET file_size_limit = 10485760, -- 10 MB
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
 WHERE id = 'equipment-photos';
