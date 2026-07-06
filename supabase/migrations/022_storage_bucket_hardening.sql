-- ============================================================
-- Migration 022: Audit fix H13 — storage bucket hardening
--
-- The public buckets company-assets / equipment-photos / job-photos /
-- qr-batches each had a broad SELECT policy (role public/anon,
-- bucket-wide) that let ANYONE list/enumerate every org's files via
-- the storage API. The buckets are public, so object display uses
-- getPublicUrl (served by the CDN without RLS) — the broad SELECT
-- policies are not needed for display, only for anonymous listing.
--
-- Fix: drop the anonymous listing policies; replace with authenticated
-- org-scoped SELECT (objects are stored under `${org_id}/...`). Also
-- tighten equipment-photos / company-assets writes, which were
-- authenticated-but-not-org-scoped, so a user can only write under
-- their own org prefix.
-- ============================================================

-- ── company-assets ───────────────────────────────────────────
DROP POLICY IF EXISTS "company_assets_select" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_insert" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_update" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_delete" ON storage.objects;

CREATE POLICY "company_assets_select_org" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'company-assets'
         AND ((storage.foldername(name))[1] = (public.get_user_org_id())::text
              OR public.is_super_admin()));
CREATE POLICY "company_assets_insert_org" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-assets'
         AND ((storage.foldername(name))[1] = (public.get_user_org_id())::text
              OR public.is_super_admin()));
CREATE POLICY "company_assets_update_org" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'company-assets'
         AND ((storage.foldername(name))[1] = (public.get_user_org_id())::text
              OR public.is_super_admin()));
CREATE POLICY "company_assets_delete_org" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'company-assets'
         AND ((storage.foldername(name))[1] = (public.get_user_org_id())::text
              OR public.is_super_admin()));

-- ── equipment-photos ─────────────────────────────────────────
DROP POLICY IF EXISTS "Public can read equipment photos" ON storage.objects;
DROP POLICY IF EXISTS "Org members can upload equipment photos" ON storage.objects;

CREATE POLICY "Org members can view equipment photos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'equipment-photos'
         AND ((storage.foldername(name))[1] = (public.get_user_org_id())::text
              OR public.is_super_admin()));
CREATE POLICY "Org members can upload equipment photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'equipment-photos'
         AND ((storage.foldername(name))[1] = (public.get_user_org_id())::text
              OR public.is_super_admin()));

-- ── job-photos: drop the anonymous listing policy ────────────
-- (org-scoped authenticated SELECT "Org members can view job photos"
--  already exists and is kept.)
DROP POLICY IF EXISTS "Public can view job photos" ON storage.objects;

-- ── qr-batches: drop anonymous listing; keep for authenticated ─
-- (QR-batch PDFs aren't stored under an org prefix, so scope to any
--  authenticated user rather than by org.)
DROP POLICY IF EXISTS "Public can read QR batches" ON storage.objects;
CREATE POLICY "Authenticated can read QR batches" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'qr-batches');
