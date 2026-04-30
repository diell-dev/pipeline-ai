/**
 * GET /api/dashboard/analytics
 *
 * Returns aggregate analytics for the dashboard, scoped to the caller's org.
 *
 * Query params:
 *   from        ISO date (YYYY-MM-DD)   — start of window (inclusive)
 *   to          ISO date (YYYY-MM-DD)   — end of window (inclusive)
 *   client_id   uuid (optional)         — narrow to a single client
 *
 * Response:
 *   {
 *     totalJobs,
 *     avgCostPerJob,
 *     outstandingRevenue,
 *     avgProposalToSignedHours,
 *     avgSignedToStartedHours,
 *     avgStartedToCompletedHours,
 *     recordCounts: {
 *       jobs, invoices, proposalToSigned, signedToStarted, startedToCompleted
 *     }
 *   }
 *
 * Time-to-X metrics are averaged across the timeframe filter using the
 * relevant timestamp on each side of the transition. Returns null for any
 * average where there are zero matching records (so the UI can render "—").
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getApiUser } from '@/lib/api-auth'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = SupabaseClient<any, 'public', any>

function getServiceClient(): ServiceClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey)
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function avg(values: number[]): number | null {
  if (values.length === 0) return null
  const sum = values.reduce((a, b) => a + b, 0)
  return sum / values.length
}

function hoursBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const ms = new Date(b).getTime() - new Date(a).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  return ms / (1000 * 60 * 60)
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { searchParams } = new URL(request.url)
    const fromRaw = searchParams.get('from')
    const toRaw = searchParams.get('to')
    const clientIdRaw = searchParams.get('client_id')

    const from = fromRaw && DATE_RE.test(fromRaw) ? fromRaw : null
    const to = toRaw && DATE_RE.test(toRaw) ? toRaw : null
    const clientId =
      clientIdRaw && UUID_RE.test(clientIdRaw) ? clientIdRaw : null

    const supabase = getServiceClient()

    // ── Jobs in the window ──
    let jobsQuery = supabase
      .from('jobs')
      .select(
        'id, client_id, proposal_id, service_date, arrival_time, completion_time'
      )
      .eq('organization_id', auth.organizationId)
      .is('deleted_at', null)

    if (from) jobsQuery = jobsQuery.gte('service_date', from)
    if (to) jobsQuery = jobsQuery.lte('service_date', to)
    if (clientId) jobsQuery = jobsQuery.eq('client_id', clientId)

    const { data: jobs, error: jobsError } = await jobsQuery
    if (jobsError) throw new Error(`jobs: ${jobsError.message}`)

    const jobRows = jobs || []
    const totalJobs = jobRows.length

    // ── Invoices in the window (use created_at to match the timeframe) ──
    let invoicesQuery = supabase
      .from('invoices')
      .select('id, client_id, total_amount, paid_amount, status, created_at')
      .eq('organization_id', auth.organizationId)

    if (from) invoicesQuery = invoicesQuery.gte('created_at', `${from}T00:00:00Z`)
    if (to) invoicesQuery = invoicesQuery.lte('created_at', `${to}T23:59:59Z`)
    if (clientId) invoicesQuery = invoicesQuery.eq('client_id', clientId)

    const { data: invoices, error: invoicesError } = await invoicesQuery
    if (invoicesError) throw new Error(`invoices: ${invoicesError.message}`)

    const invoiceRows = invoices || []
    const invoiceTotal = invoiceRows.reduce(
      (sum, inv) => sum + (Number(inv.total_amount) || 0),
      0
    )
    const avgCostPerJob = totalJobs > 0 ? invoiceTotal / totalJobs : null

    // Outstanding = unpaid balance across non-cancelled, non-draft invoices
    const outstandingRevenue = invoiceRows
      .filter((inv) => inv.status !== 'cancelled' && inv.status !== 'paid')
      .reduce((sum, inv) => {
        const total = Number(inv.total_amount) || 0
        const paid = Number(inv.paid_amount) || 0
        return sum + Math.max(0, total - paid)
      }, 0)

    // ── Proposals: proposal_sent → client_approved ──
    let proposalsQuery = supabase
      .from('proposals')
      .select('id, client_id, sent_to_client_at, client_approved_at')
      .eq('organization_id', auth.organizationId)
      .not('sent_to_client_at', 'is', null)
      .not('client_approved_at', 'is', null)

    if (from) proposalsQuery = proposalsQuery.gte('client_approved_at', `${from}T00:00:00Z`)
    if (to) proposalsQuery = proposalsQuery.lte('client_approved_at', `${to}T23:59:59Z`)
    if (clientId) proposalsQuery = proposalsQuery.eq('client_id', clientId)

    const { data: proposals, error: proposalsError } = await proposalsQuery
    if (proposalsError) throw new Error(`proposals: ${proposalsError.message}`)

    const proposalToSignedHoursList: number[] = []
    for (const p of proposals || []) {
      const h = hoursBetween(p.sent_to_client_at, p.client_approved_at)
      if (h !== null) proposalToSignedHoursList.push(h)
    }

    // ── Signed → Started: join via jobs.proposal_id ──
    const proposalIdsOnJobs = jobRows
      .map((j) => j.proposal_id)
      .filter((id): id is string => !!id)

    let approvedByProposal: Map<string, string> = new Map()
    if (proposalIdsOnJobs.length > 0) {
      const { data: linkedProposals, error: linkErr } = await supabase
        .from('proposals')
        .select('id, client_approved_at')
        .eq('organization_id', auth.organizationId)
        .in('id', proposalIdsOnJobs)
        .not('client_approved_at', 'is', null)
      if (linkErr) throw new Error(`proposals(linked): ${linkErr.message}`)
      approvedByProposal = new Map(
        (linkedProposals || [])
          .filter((p) => !!p.client_approved_at)
          .map((p) => [p.id as string, p.client_approved_at as string])
      )
    }

    const signedToStartedHoursList: number[] = []
    for (const job of jobRows) {
      if (!job.proposal_id || !job.arrival_time) continue
      const approvedAt = approvedByProposal.get(job.proposal_id)
      if (!approvedAt) continue
      const h = hoursBetween(approvedAt, job.arrival_time)
      if (h !== null) signedToStartedHoursList.push(h)
    }

    // ── Started → Completed: any job in the window with both timestamps ──
    const startedToCompletedHoursList: number[] = []
    for (const job of jobRows) {
      const h = hoursBetween(job.arrival_time, job.completion_time)
      if (h !== null) startedToCompletedHoursList.push(h)
    }

    return NextResponse.json({
      totalJobs,
      avgCostPerJob,
      outstandingRevenue,
      avgProposalToSignedHours: avg(proposalToSignedHoursList),
      avgSignedToStartedHours: avg(signedToStartedHoursList),
      avgStartedToCompletedHours: avg(startedToCompletedHoursList),
      recordCounts: {
        jobs: totalJobs,
        invoices: invoiceRows.length,
        proposalToSigned: proposalToSignedHoursList.length,
        signedToStarted: signedToStartedHoursList.length,
        startedToCompleted: startedToCompletedHoursList.length,
      },
    })
  } catch (err) {
    console.error('Analytics query failed:', err)
    const errMsg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      {
        error: 'Failed to load analytics',
        ...(process.env.NODE_ENV === 'development' && { detail: errMsg }),
      },
      { status: 500 }
    )
  }
}
