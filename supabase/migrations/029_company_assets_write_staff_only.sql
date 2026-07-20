-- Migration 029 (audit S3 follow-up): clients may READ company-assets (the
-- portal shell + branded invoice PDF render the org logo) but must never
-- write/replace/delete org branding.
-- Applied live to zabfuqxjjunsppotfrel on 2026-07-20.
DROP POLICY IF EXISTS "company_assets_insert_org" ON storage.objects;
CREATE POLICY "company_assets_insert_org" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-assets'
              AND public.get_user_role() <> 'client'
              AND ((storage.foldername(name))[1] = (public.get_user_org_id())::text
                   OR public.is_super_admin()));

DROP POLICY IF EXISTS "company_assets_update_org" ON storage.objects;
CREATE POLICY "company_assets_update_org" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'company-assets'
         AND public.get_user_role() <> 'client'
         AND ((storage.foldername(name))[1] = (public.get_user_org_id())::text
              OR public.is_super_admin()));

DROP POLICY IF EXISTS "company_assets_delete_org" ON storage.objects;
CREATE POLICY "company_assets_delete_org" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'company-assets'
         AND public.get_user_role() <> 'client'
         AND ((storage.foldername(name))[1] = (public.get_user_org_id())::text
              OR public.is_super_admin()));
