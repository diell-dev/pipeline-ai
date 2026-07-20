-- ============================================================
-- Migration 028: Audit S3 — portal clients must not read org-wide photos.
--
-- Table RLS (migration 025/026) correctly scopes role='client' logins to their
-- own client_id. The STORAGE policies never got the same treatment: they grant
-- SELECT to any `authenticated` user whose get_user_org_id() matches the object
-- path prefix. A portal client IS authenticated and DOES carry the org id, so
-- they could list/fetch every job + equipment photo in the org — including
-- other customers' properties — through the storage REST API.
--
-- Fix: exclude role='client' from the staff-facing photo policies.
-- (When the portal later needs to show a client THEIR OWN job photos, add a
-- separate policy that joins the object path to that client's jobs.)
-- Applied live to zabfuqxjjunsppotfrel on 2026-07-20.
-- ============================================================

DROP POLICY IF EXISTS "Org members can view job photos" ON storage.objects;
CREATE POLICY "Org members can view job photos" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND public.get_user_role() <> 'client'
    AND ((storage.foldername(name))[1] = (public.get_user_org_id())::text
         OR public.is_super_admin())
  );

DROP POLICY IF EXISTS "Org members can view equipment photos" ON storage.objects;
CREATE POLICY "Org members can view equipment photos" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'equipment-photos'
    AND public.get_user_role() <> 'client'
    AND ((storage.foldername(name))[1] = (public.get_user_org_id())::text
         OR public.is_super_admin())
  );

DROP POLICY IF EXISTS "Org members can upload job photos" ON storage.objects;
CREATE POLICY "Org members can upload job photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'job-photos'
    AND public.get_user_role() <> 'client'
    AND (storage.foldername(name))[1] = (public.get_user_org_id())::text
  );

DROP POLICY IF EXISTS "Org members can upload equipment photos" ON storage.objects;
CREATE POLICY "Org members can upload equipment photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'equipment-photos'
    AND public.get_user_role() <> 'client'
    AND ((storage.foldername(name))[1] = (public.get_user_org_id())::text
         OR public.is_super_admin())
  );

DROP POLICY IF EXISTS "Org members can update job photos" ON storage.objects;
CREATE POLICY "Org members can update job photos" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND public.get_user_role() <> 'client'
    AND (storage.foldername(name))[1] = (public.get_user_org_id())::text
  );

DROP POLICY IF EXISTS "Org members can delete job photos" ON storage.objects;
CREATE POLICY "Org members can delete job photos" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND public.get_user_role() <> 'client'
    AND (storage.foldername(name))[1] = (public.get_user_org_id())::text
  );

-- Stray legacy policy: role `public` + auth.role()='authenticated' check on a
-- bucket whose objects are streamed through an authenticated API route.
DROP POLICY IF EXISTS "Org members can upload QR batches" ON storage.objects;
CREATE POLICY "qr_batches_insert_staff" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'qr-batches' AND public.get_user_role() <> 'client');
