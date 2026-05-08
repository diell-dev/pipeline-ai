-- ============================================================
-- Pipeline AI — Audit-fix Phase 2 (round 2, part 2)
-- Migration 006: Schema and policy changes from the second pass of
-- the round-2 code review.
--
-- Changes:
--   1. Tighten the proposals UPDATE RLS policy so a creator (typically a
--      field tech) can only edit drafts. Once they submit for approval
--      they lose edit rights — only managers can change a proposal in
--      `pending_admin_approval` state. Mirrors the JS-side check in
--      src/app/api/proposals/[id]/route.ts (defense in depth).
--   2. Make activity_log.user_id nullable so system-generated rows
--      (Stripe webhook payments, public-token signatures) can be logged
--      without faking a user.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Tighten the proposals UPDATE policy
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Creators and managers can update proposals" ON proposals;

CREATE POLICY "Creators and managers can update proposals" ON proposals FOR UPDATE
  USING (
    organization_id = public.get_user_org_id()
    AND (
      public.get_user_role() IN ('super_admin', 'owner', 'office_manager')
      OR (created_by = auth.uid() AND status = 'draft')
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 2. Allow null user_id on activity_log (for webhooks / public-token actions)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE activity_log
  ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN activity_log.user_id IS
  'The user who performed the action. NULL when the action came from a system source like a Stripe webhook payment or a public-token client signature.';
