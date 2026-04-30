-- ============================================================
-- Pipeline AI — Stripe Connect Integration
-- Migration 004: Adds Stripe Connect (Express) support so each
-- organization can accept credit-card payments on its own connected
-- Stripe account. No new tables — payment activity is logged via
-- the existing activity_log table.
-- ============================================================

-- 1. ORGANIZATIONS — Connected account fields
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_account_status TEXT
    CHECK (stripe_account_status IN ('pending', 'active', 'restricted', 'disconnected')),
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Lookup index for webhook handlers (account.updated events)
CREATE INDEX IF NOT EXISTS idx_organizations_stripe_account
  ON organizations(stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;

-- 2. INVOICES — Stripe Checkout / Payment Intent linkage
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_payment_link_url TEXT;

-- Webhook lookup: find an invoice by its PaymentIntent id
CREATE INDEX IF NOT EXISTS idx_invoices_stripe_payment_intent
  ON invoices(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- Optional: lookup by checkout session as well (for reconciliation)
CREATE INDEX IF NOT EXISTS idx_invoices_stripe_checkout_session
  ON invoices(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
