/**
 * POST /api/stripe/webhook
 *
 * Public route. Verifies Stripe signature, then dispatches on event type.
 *
 * Handled:
 *   checkout.session.completed  → mark invoice as paid via credit_card AND
 *                                 (when the org has bookkeeping enabled)
 *                                 record a `payments` row + post the
 *                                 corresponding journal entry (DR Bank /
 *                                 CR AR) via the B2 posting engine.
 *   account.updated             → sync connected account state to org.
 *
 * Other event types are acknowledged with 200 (so Stripe stops retrying).
 *
 * Books posting is best-effort: a failure (e.g. no open accounting period
 * exists, chart-of-accounts not yet seeded) MUST NOT fail the Stripe
 * webhook. The customer's payment is still recorded in the legacy
 * `invoices` columns, and the books posting can be retried later from
 * the existing `payments` row (the row is created even when posting
 * fails — that's what `postPayment` will pick up on a retry, because it
 * is idempotent on `source_id`).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { getStripeClient, deriveAccountStatus } from '@/lib/stripe'
import { postPayment } from '@/lib/books/posting'
import { STANDARD_ACCOUNTS, getAccountByCode } from '@/lib/books/accounts'
import { getTierConfig } from '@/lib/tier-limits'
import type { SubscriptionTier } from '@/types/database'

// Force the runtime to read raw body — Next.js App Router gives us
// the raw text from request.text() directly.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey)
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not set')
    return NextResponse.json(
      { error: 'Webhook not configured' },
      { status: 500 }
    )
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  // IMPORTANT: use the raw text body. Do NOT use request.json().
  const rawBody = await request.text()

  let event: Stripe.Event
  try {
    const stripe = getStripeClient()
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature'
    console.error('Stripe webhook signature failed:', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const supabase = getServiceClient()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        await handleCheckoutCompleted(supabase, session)
        break
      }
      case 'account.updated': {
        // event.account is set on Connect-account events. When it's absent the
        // event refers to our platform account itself — nothing to sync to an
        // org row, so log and skip.
        if (!event.account) {
          console.log('Stripe webhook: account.updated for platform account (no event.account) — skipping')
          break
        }
        const account = event.data.object as Stripe.Account
        await handleAccountUpdated(supabase, account)
        break
      }
      default:
        // Acknowledge but ignore other event types.
        break
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error(`Webhook handler error (${event.type}):`, err)
    // Return 500 so Stripe retries — but only when handling fails AFTER
    // signature verification. Signature errors above stay 400.
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(
  supabase: ReturnType<typeof getServiceClient>,
  session: Stripe.Checkout.Session
) {
  const invoiceId = session.metadata?.invoice_id
  const organizationId = session.metadata?.organization_id

  if (!invoiceId) {
    console.warn('checkout.session.completed without invoice_id metadata', session.id)
    return
  }

  // Fetch the invoice (we need total_amount + organization_id)
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .select('id, organization_id, total_amount, total_cents, amount_paid_cents, status')
    .eq('id', invoiceId)
    .single()

  if (invErr || !invoice) {
    console.warn('Invoice not found for completed checkout', invoiceId)
    return
  }

  // Skip double-application if already paid
  if (invoice.status === 'paid') return

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null

  const today = new Date().toISOString().slice(0, 10)

  const { error: updateErr } = await supabase
    .from('invoices')
    .update({
      status: 'paid',
      paid_amount: invoice.total_amount,
      paid_date: today,
      payment_method: 'credit_card',
      stripe_payment_intent_id: paymentIntentId,
    })
    .eq('id', invoiceId)

  if (updateErr) {
    throw new Error(`Failed to mark invoice paid: ${updateErr.message}`)
  }

  // Activity log (best-effort — don't fail the webhook if this errors).
  // No real user is associated with a webhook payment, so user_id is null.
  // Migration 006 makes activity_log.user_id nullable for exactly this case.
  const orgId = organizationId || invoice.organization_id
  await supabase.from('activity_log').insert({
    organization_id: orgId,
    user_id: null,
    action: 'invoice_paid_via_stripe',
    entity_type: 'invoice',
    entity_id: invoiceId,
    metadata: {
      stripe_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      amount: invoice.total_amount,
    },
  })

  // ─────────────────────────────────────────────────────────────
  // Books: record the payment + post DR Bank / CR AR.
  // ─────────────────────────────────────────────────────────────
  // Tier-gated and best-effort. Any failure here is logged and
  // swallowed — the legacy invoice update above is what Stripe needs to
  // see, and Stripe should not retry the webhook because of a books
  // problem (e.g. closed period, missing chart of accounts).
  try {
    await maybePostStripePaymentToBooks(supabase, {
      orgId,
      invoiceId,
      session,
      paymentIntentId,
      invoiceTotalCents: invoice.total_cents ?? null,
      invoiceAmountPaidCents: invoice.amount_paid_cents ?? null,
    })
  } catch (err) {
    // Belt-and-suspenders — `maybePostStripePaymentToBooks` already
    // swallows its own errors, but if anything escapes (e.g. an
    // unexpected exception in the tier lookup) we still don't want to
    // bring down the webhook.
    console.error(
      `Books posting for Stripe payment ${paymentIntentId ?? session.id} failed (non-fatal):`,
      err
    )
  }
}

// ─────────────────────────────────────────────────────────────────
// Books bridge
// ─────────────────────────────────────────────────────────────────

interface MaybePostInput {
  orgId: string
  invoiceId: string
  session: Stripe.Checkout.Session
  paymentIntentId: string | null
  invoiceTotalCents: number | null
  invoiceAmountPaidCents: number | null
}

/**
 * Record the Stripe payment in the books module (if the org's tier
 * allows it). Three steps:
 *   1. Tier check — only `business` tier (bookkeeping=true) progresses.
 *   2. Idempotency — if a `payments` row already exists for this
 *      Stripe payment intent, do nothing (Stripe retries webhooks; we
 *      must not double-count).
 *   3. Insert payment row + call B2's postPayment().
 *
 * Step 3 is wrapped in its own try/catch: if posting the journal
 * entry fails (e.g. closed period), the `payments` row is left in
 * place so a later sweep / manual retry can post it without
 * re-querying Stripe.
 *
 * Returns silently on every error path — caller is the webhook
 * handler and we never want to 500 because of books.
 */
async function maybePostStripePaymentToBooks(
  supabase: SupabaseClient,
  input: MaybePostInput
): Promise<void> {
  const { orgId, invoiceId, session, paymentIntentId } = input

  if (!paymentIntentId) {
    // Without a payment_intent we can't dedupe across webhook retries,
    // so refuse to write a books row. The legacy update is still done.
    console.warn(
      `checkout.session.completed for invoice ${invoiceId} had no payment_intent — skipping books posting`
    )
    return
  }

  // 1. Tier check.
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, tier, stripe_account_id')
    .eq('id', orgId)
    .maybeSingle<{ id: string; tier: SubscriptionTier; stripe_account_id: string | null }>()

  if (orgErr || !org) {
    console.warn(`Books posting: failed to load org ${orgId}: ${orgErr?.message ?? 'not found'}`)
    return
  }

  const tier = getTierConfig(org.tier)
  if (!tier.features.bookkeeping) {
    // Basic / professional orgs: legacy-only behavior. Not an error.
    return
  }

  // 2. Idempotency — bail if we've already recorded this PI.
  // payments.payment_method_details->>'stripe_payment_intent_id' is the
  // canonical dedupe key. Stripe retries webhooks on failure, so this
  // check must run BEFORE any insert.
  const { data: existing, error: existingErr } = await supabase
    .from('payments')
    .select('id')
    .eq('organization_id', orgId)
    .filter('payment_method_details->>stripe_payment_intent_id', 'eq', paymentIntentId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (existingErr) {
    console.error(
      `Books posting: failed to check for existing payment with PI ${paymentIntentId}: ${existingErr.message}`
    )
    return
  }
  if (existing) {
    // Already recorded — Stripe is retrying a webhook we've already
    // processed. Nothing to do.
    return
  }

  // 3. Resolve the amount. Prefer the PaymentIntent's amount over
  // anything stored locally — that's what the customer was actually
  // charged. Fall back to session.amount_total (always in cents) and
  // then the invoice header.
  let pi: Stripe.PaymentIntent | null = null
  let charge: Stripe.Charge | null = null
  try {
    const stripe = getStripeClient()
    // The PaymentIntent lives on the org's connected account when the
    // session was created there (which is how createInvoiceCheckoutSession
    // does it). We pass stripeAccount so we can read it back.
    if (org.stripe_account_id) {
      pi = await stripe.paymentIntents.retrieve(
        paymentIntentId,
        { expand: ['latest_charge'] },
        { stripeAccount: org.stripe_account_id }
      )
    } else {
      pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge'],
      })
    }
    if (pi.latest_charge && typeof pi.latest_charge !== 'string') {
      charge = pi.latest_charge
    }
  } catch (err) {
    // Non-fatal: we can still create a payment from the session payload.
    console.warn(
      `Books posting: PaymentIntent retrieve failed for ${paymentIntentId}, falling back to session data:`,
      err instanceof Error ? err.message : err
    )
  }

  const amountCents = pi?.amount ?? session.amount_total ?? input.invoiceTotalCents ?? 0
  if (amountCents <= 0) {
    console.warn(
      `Books posting: cannot determine amount for PI ${paymentIntentId} (invoice ${invoiceId}); skipping`
    )
    return
  }

  const currency = (pi?.currency ?? session.currency ?? 'USD').toUpperCase().slice(0, 3)

  const paymentDate = pi?.created
    ? new Date(pi.created * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)

  // 4. Resolve the deposit-to account: prefer a bank_accounts row of
  // type='stripe' (a user might have provisioned one in B3 settings),
  // otherwise fall back to the standard Operating Bank account.
  let depositToAccountId: string | null = null
  try {
    const { data: stripeBank } = await supabase
      .from('bank_accounts')
      .select('id, chart_account_id')
      .eq('organization_id', orgId)
      .eq('type', 'stripe')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle<{ id: string; chart_account_id: string | null }>()

    if (stripeBank?.chart_account_id) {
      depositToAccountId = stripeBank.chart_account_id
    } else {
      const operating = await getAccountByCode(
        supabase,
        orgId,
        STANDARD_ACCOUNTS.OPERATING_BANK
      )
      depositToAccountId = operating.id
    }
  } catch (err) {
    console.error(
      `Books posting: failed to resolve deposit account for org ${orgId}:`,
      err instanceof Error ? err.message : err
    )
    return
  }

  // 5. Claim a payment number (per-org sequence).
  const { data: paymentNumberRaw, error: seqErr } = await supabase.rpc(
    'next_books_sequence',
    { p_org_id: orgId, p_kind: 'payment' }
  )
  if (seqErr) {
    console.error(
      `Books posting: failed to claim payment sequence for org ${orgId}: ${seqErr.message}`
    )
    return
  }
  const paymentNumber =
    typeof paymentNumberRaw === 'string'
      ? paymentNumberRaw
      : (paymentNumberRaw as { next_books_sequence?: string } | null)
          ?.next_books_sequence ?? null
  if (!paymentNumber) {
    console.error(
      `Books posting: next_books_sequence returned unexpected payload for org ${orgId}`
    )
    return
  }

  // 6. Build payment_method_details. Keep it Stripe-shaped so a future
  // dedupe / reconciliation tool can grep it without surprises.
  const cardDetails = charge?.payment_method_details?.card ?? null
  const paymentMethodDetails: Record<string, unknown> = {
    stripe_payment_intent_id: paymentIntentId,
    stripe_charge_id: charge?.id ?? null,
    stripe_account_id: org.stripe_account_id,
    stripe_checkout_session_id: session.id,
    last4: cardDetails?.last4 ?? null,
    brand: cardDetails?.brand ?? null,
    funding: cardDetails?.funding ?? null,
    receipt_url: charge?.receipt_url ?? null,
  }

  // 7. Insert the payments row.
  const { data: inserted, error: insertErr } = await supabase
    .from('payments')
    .insert({
      organization_id: orgId,
      payment_date: paymentDate,
      payment_number: paymentNumber,
      reference: paymentIntentId,
      type: 'invoice_payment',
      source_type: 'invoice',
      source_id: invoiceId,
      amount_cents: amountCents,
      currency,
      payment_method: 'stripe',
      payment_method_details: paymentMethodDetails,
      deposit_to_account_id: depositToAccountId,
      notes: `Stripe payment ${paymentIntentId}`,
    })
    .select('id')
    .single<{ id: string }>()

  if (insertErr || !inserted) {
    console.error(
      `Books posting: failed to insert payments row for PI ${paymentIntentId}: ${insertErr?.message ?? 'no row returned'}`
    )
    return
  }

  // 8. Update the invoice's books-side amount_paid_cents via the
  // atomic RPC. The earlier read-modify-write (read amount_paid_cents
  // → compute new total → write back) raced with concurrent webhook
  // retries and with manual /api/books/payments POSTs against the
  // same invoice; both readers saw the old value and both writes
  // overwrote each other, leaving the invoice under-paid in books.
  // The DB function uses a single UPDATE so concurrent calls serialize.
  // NOTE: the legacy `paid_amount` / `status` write at lines ~145-158
  // above is the pre-books UI path. We intentionally leave it alone in
  // this pass; once the legacy UI is retired the RPC can be the sole
  // source of truth.
  const { error: invoiceUpdateErr } = await supabase.rpc('books_apply_payment_delta', {
    p_source_type: 'invoice',
    p_source_id: invoiceId,
    p_amount_delta_cents: amountCents,
  })
  if (invoiceUpdateErr) {
    // Log but keep going — the payment row is the source of truth.
    console.warn(
      `Books posting: books_apply_payment_delta failed for invoice ${invoiceId}: ${invoiceUpdateErr.message}`
    )
  }

  // 9. Post the journal entry. Wrapped separately so a posting failure
  // (e.g. closed accounting period) doesn't roll back the payments row
  // — the row remains queued for a later retry.
  try {
    await postPayment(supabase, inserted.id)
  } catch (err) {
    console.error(
      `Books posting: postPayment failed for payment ${inserted.id} (PI ${paymentIntentId}); ` +
        `payment row left in place for retry:`,
      err instanceof Error ? err.message : err
    )
  }
}

async function handleAccountUpdated(
  supabase: ReturnType<typeof getServiceClient>,
  account: Stripe.Account
) {
  const status = deriveAccountStatus({
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled,
    details_submitted: account.details_submitted,
  })

  const { error } = await supabase
    .from('organizations')
    .update({
      stripe_account_status: status,
      stripe_charges_enabled: !!account.charges_enabled,
      stripe_payouts_enabled: !!account.payouts_enabled,
    })
    .eq('stripe_account_id', account.id)

  if (error) {
    throw new Error(`Failed to sync account state: ${error.message}`)
  }
}
