-- ============================================================
-- Pipeline AI — equipment_qr_codes INSERT policy fix
-- Migration 009
--
-- equipment_qr_codes was originally created with only SELECT + UPDATE
-- policies. POST /api/equipment/qr-batches needs to insert N rows
-- into this table to mint a batch of stickers. Without an INSERT
-- policy, RLS rejects every insert with:
--   'new row violates row-level security policy for table equipment_qr_codes'
--
-- This migration adds INSERT + DELETE policies for managers (owner /
-- office_manager) within their own org, plus super_admin platform-wide.
-- Also defensively adds an INSERT policy on equipment_qr_batches if
-- one was missing.
-- ============================================================

CREATE POLICY "Managers can insert QR codes" ON equipment_qr_codes FOR INSERT
  WITH CHECK (
    public.is_super_admin()
    OR (
      organization_id = public.get_user_org_id()
      AND public.get_user_role() IN ('owner', 'office_manager')
    )
  );

CREATE POLICY "Managers can delete QR codes" ON equipment_qr_codes FOR DELETE
  USING (
    public.is_super_admin()
    OR (
      organization_id = public.get_user_org_id()
      AND public.get_user_role() IN ('owner', 'office_manager')
    )
  );

-- Defensive: add INSERT on equipment_qr_batches if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.equipment_qr_batches'::regclass
      AND polcmd = 'a'
  ) THEN
    EXECUTE 'CREATE POLICY "Managers can insert QR batches" ON equipment_qr_batches FOR INSERT
             WITH CHECK (
               public.is_super_admin()
               OR (
                 organization_id = public.get_user_org_id()
                 AND public.get_user_role() IN (''owner'', ''office_manager'')
               )
             )';
  END IF;
END $$;
