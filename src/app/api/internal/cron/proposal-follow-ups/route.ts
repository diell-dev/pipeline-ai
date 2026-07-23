/**
 * POST /api/internal/cron/proposal-follow-ups
 *
 * Nightly cron — nudges staff about proposals that were sent to a client and
 * have gone unanswered. Sends at most two reminders per send:
 *   - stage 1 after 3 days
 *   - stage 2 after 7 days
 * then stops. Recipients are the org's owner + office managers (the people
 * who can act on it). It never emails the client (Diell's call, 2026-07-21).
 *
 * Idempotent: `proposals.last_follow_up_stage` records the highest stage
 * already sent, so re-running the same day is a no-op, and a proposal that is
 * re-sent to the client gets a fresh set of reminders (the send route + a DB
 * trigger reset the stage to 0).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}. Same contract as
 * spawn-recurring-jobs — the secret is required and compared in constant time.
 *
 * Returns { reminded, byStage, skipped, errors }.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { escapeHtml } from '@/lib/escape-html'
import {
  nextFollowUpStage,
  FOLLOW_UP_STAGE_1_DAYS,
  FOLLOW_UP_STAGE_2_DAYS,
} from '@/lib/proposal-follow-up'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Missing SUPABASE env vars')
  return createServiceClient(url, serviceKey)
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Constant-time string compare (see spawn-recurring-jobs for rationale). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const DAY_MS = 24 * 60 * 60 * 1000

interface ProposalRow {
  id: string
  organization_id: string
  proposal_number: string
  total_amount: number | null
  sent_to_client_at: string
  valid_until: string | null
  last_follow_up_stage: number
  clients: { company_name: string | null } | null
  sites: { name: string | null; address: string | null } | null
}

interface OrgInfo {
  name: string
  appUrl: string
  recipients: string[]
}

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('CRON_SECRET not configured — refusing to run proposal follow-ups')
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 })
  }
  if (!timingSafeEqual(request.headers.get('authorization') ?? '', `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getServiceClient()
  const now = Date.now()
  const errors: Array<{ proposal_id: string; error: string }> = []
  let reminded = 0
  let skipped = 0
  const byStage = { 1: 0, 2: 0 }

  try {
    // Candidates: sent to a client, still awaiting a response, sent >= 3 days
    // ago, and not yet reminded at the stage they now qualify for.
    const stage1Cutoff = new Date(now - FOLLOW_UP_STAGE_1_DAYS * DAY_MS).toISOString()
    const { data: rows, error } = await supabase
      .from('proposals')
      .select(
        'id, organization_id, proposal_number, total_amount, sent_to_client_at, valid_until, last_follow_up_stage, clients:client_id ( company_name ), sites:site_id ( name, address )'
      )
      .eq('status', 'sent_to_client')
      .is('deleted_at', null)
      .not('sent_to_client_at', 'is', null)
      .lte('sent_to_client_at', stage1Cutoff)
      .lt('last_follow_up_stage', 2)
      .returns<ProposalRow[]>()

    if (error) throw new Error(`fetch proposals: ${error.message}`)

    const resendKey = process.env.RESEND_API_KEY
    const orgCache = new Map<string, OrgInfo | null>()

    async function orgInfo(orgId: string): Promise<OrgInfo | null> {
      if (orgCache.has(orgId)) return orgCache.get(orgId) ?? null
      const [{ data: org }, { data: staff }] = await Promise.all([
        supabase.from('organizations').select('name').eq('id', orgId).maybeSingle<{ name: string }>(),
        supabase
          .from('users')
          .select('email')
          .eq('organization_id', orgId)
          .in('role', ['owner', 'office_manager'])
          .eq('is_active', true),
      ])
      const recipients = ((staff ?? []) as { email: string }[])
        .map((s) => s.email)
        .filter(Boolean)
      const info: OrgInfo | null = recipients.length
        ? {
            name: org?.name || 'Pipeline AI',
            appUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://pipeline-ai-beige.vercel.app',
            recipients,
          }
        : null
      orgCache.set(orgId, info)
      return info
    }

    for (const p of rows ?? []) {
      const ageDays = Math.floor((now - Date.parse(p.sent_to_client_at)) / DAY_MS)
      const targetStage = nextFollowUpStage(ageDays, p.last_follow_up_stage)
      if (targetStage === 0) {
        skipped++
        continue
      }

      try {
        const org = await orgInfo(p.organization_id)

        // No deliverable recipients (or no email provider) — still advance the
        // stage so we don't reconsider this proposal every night forever.
        if (org && resendKey) {
          const clientName = p.clients?.company_name || 'the client'
          const where = p.sites?.name || p.sites?.address || ''
          const total =
            typeof p.total_amount === 'number'
              ? `$${p.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : null
          const proposalUrl = `${org.appUrl}/proposals/${p.id}`
          const stageLabel =
            targetStage === 2
              ? `still open after ${FOLLOW_UP_STAGE_2_DAYS} days`
              : `open for ${FOLLOW_UP_STAGE_1_DAYS} days`

          const { Resend } = await import('resend')
          const resend = new Resend(resendKey)
          await resend.emails.send({
            from: 'Pipeline AI <noreply@pipeline-ai.com>',
            to: org.recipients,
            subject: `Follow up: ${escapeHtml(clientName)} hasn't responded to proposal ${escapeHtml(p.proposal_number)}`,
            html: `
              <p>Proposal <strong>${escapeHtml(p.proposal_number)}</strong> for
              <strong>${escapeHtml(clientName)}</strong>${where ? ` (${escapeHtml(where)})` : ''}
              was sent ${ageDays} days ago and is ${stageLabel} with no response.</p>
              ${total ? `<p><strong>Amount:</strong> ${escapeHtml(total)}</p>` : ''}
              ${
                p.valid_until
                  ? `<p><strong>Valid until:</strong> ${escapeHtml(
                      new Date(p.valid_until).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })
                    )}</p>`
                  : ''
              }
              <p>It may be worth a quick call or a nudge.</p>
              <p><a href="${escapeHtml(proposalUrl)}"
                 style="display:inline-block;background:#1e3a5f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">
                 View proposal</a></p>
              <p style="color:#888;font-size:12px;">${escapeHtml(proposalUrl)}</p>`,
          })
        }

        // Advance the stage regardless of whether an email actually went out,
        // so a missing RESEND_API_KEY doesn't cause a nightly re-scan storm.
        const { error: updErr } = await supabase
          .from('proposals')
          .update({ last_follow_up_stage: targetStage })
          .eq('id', p.id)
          .eq('status', 'sent_to_client')
          .lt('last_follow_up_stage', targetStage)
        if (updErr) throw new Error(updErr.message)

        reminded++
        byStage[targetStage as 1 | 2]++
      } catch (e) {
        errors.push({
          proposal_id: p.id,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    return NextResponse.json({ reminded, byStage, skipped, errors })
  } catch (err) {
    console.error('Proposal follow-up cron failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Follow-up run failed' },
      { status: 500 }
    )
  }
}
