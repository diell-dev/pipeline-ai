'use client'

/**
 * Dashboard Page — Phase D refresh
 *
 * Role-adaptive home that reads as a purposeful product surface, not a
 * stats wall.
 *
 * Composition (top → bottom):
 *   1. <DashboardHero>           greeting + next-best-action chips
 *   2. Filter strip              timeframe / client selectors (analytics roles)
 *   3. "No jobs in this window"  helpful hint when filter is too narrow
 *   4. Primary KPI strip         4 pipeline KPIs via <KPICard>
 *   5. Financials KPI strip      revenue / cost / time-to-X KPIs (analytics)
 *   6. <EquipmentLifecycleWidget> with the new inline bar chart
 *   7. <DashboardActivityFeed>   recent activity (desktop: side-by-side with
 *                                quick actions; mobile: full width)
 *   8. Quick Actions             (kept at bottom on desktop, hidden on
 *                                mobile in favor of bottom nav + chips)
 *
 * Mobile layout collapses to a single vertical column with the most
 * actionable KPI featured first and the timeline taking the remaining
 * scroll real estate. Bottom-nav clearance: `pb-24`.
 *
 * Roles:
 *   - super_admin            sees all orgs (RLS-permitted)
 *   - owner / office_manager full analytics + lifecycle widget
 *   - field_tech             scoped to their own jobs; no analytics
 *   - client                 no analytics, simplified KPIs
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission, type Permission } from '@/lib/permissions'
import { EquipmentLifecycleWidget } from '@/components/equipment/lifecycle-widget'
import { DashboardHero } from '@/components/dashboard/dashboard-hero'
import { DashboardActivityFeed } from '@/components/dashboard/activity-feed'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { KPICard } from '@/components/ui/kpi-card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatDuration } from '@/lib/format-duration'
import {
  ClipboardList,
  Clock,
  CheckCircle2,
  Plus,
  Send,
  DollarSign,
  Receipt,
  Hourglass,
  PlayCircle,
  Flag,
  ChevronDown,
  ChevronUp,
  Wrench,
} from 'lucide-react'

interface DashboardStats {
  totalJobs: number
  pendingReview: number
  approved: number
  submitted: number
}

interface OverdueInvoiceStats {
  count: number
  outstandingTotal: number
}

interface EquipmentDueStats {
  dueSoon: number
  overdue: number
}

type Timeframe = 'week' | 'month' | 'quarter' | 'year' | 'all'

interface ClientOption {
  id: string
  company_name: string
}

interface AnalyticsResponse {
  totalJobs: number
  avgCostPerJob: number | null
  outstandingRevenue: number
  avgProposalToSignedHours: number | null
  avgSignedToStartedHours: number | null
  avgStartedToCompletedHours: number | null
  recordCounts: {
    jobs: number
    invoices: number
    proposalToSigned: number
    signedToStarted: number
    startedToCompleted: number
  }
}

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  week: 'This week',
  month: 'This month',
  quarter: 'This quarter',
  year: 'This year',
  all: 'All time',
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Resolve a timeframe key to a [from, to] date range (inclusive).
 * `all` returns nulls so the API skips the date filter entirely.
 */
function getDateRange(tf: Timeframe): { from: string | null; to: string | null } {
  const now = new Date()
  const to = isoDate(now)

  if (tf === 'all') return { from: null, to: null }

  const start = new Date(now)
  if (tf === 'week') {
    const day = start.getDay()
    start.setDate(start.getDate() - day)
  } else if (tf === 'month') {
    start.setDate(1)
  } else if (tf === 'quarter') {
    const q = Math.floor(start.getMonth() / 3)
    start.setMonth(q * 3, 1)
  } else if (tf === 'year') {
    start.setMonth(0, 1)
  }
  return { from: isoDate(start), to }
}

// KPI cards on the dashboard intentionally strip cents to keep the
// numbers scannable (e.g. "$1,250,000" not "$1,250,000.00"). Everywhere
// else the app uses `formatDollars` from `src/lib/format.ts` which keeps
// 2 decimals — that's still the canonical formatter for line items,
// invoices, and any value the reader might cross-check against a
// receipt. Don't mirror this rounded variant elsewhere.
function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)
}

export default function DashboardPage() {
  const router = useRouter()
  const { user, organization, isLoading } = useAuthStore()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loadingStats, setLoadingStats] = useState(true)

  const [timeframe, setTimeframe] = useState<Timeframe>('year')
  const [clientId, setClientId] = useState<string>('all')
  const [lifetimeJobs, setLifetimeJobs] = useState<number | null>(null)
  const [clients, setClients] = useState<ClientOption[]>([])
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null)
  const [loadingAnalytics, setLoadingAnalytics] = useState(true)

  // Phase D: extra "next-best-action" signals — overdue invoices & equipment
  // due/overdue. These are intentionally one-off lightweight queries (count
  // only) so the hero strip can render fast even before /api/dashboard/*
  // resolves.
  const [overdueInvoices, setOverdueInvoices] = useState<OverdueInvoiceStats | null>(null)
  const [equipmentDue, setEquipmentDue] = useState<EquipmentDueStats | null>(null)

  // Phase D: "Show all metrics" toggle. Hidden cards = those whose value is
  // missing/empty (the "—" cards that used to feel like padding).
  const [showAllMetrics, setShowAllMetrics] = useState(false)

  const canViewAll = user?.role ? hasPermission(user.role, 'jobs:view_all') : false
  const canCreate = user?.role ? hasPermission(user.role, 'jobs:create') : false
  const canCreateProposal = user?.role
    ? hasPermission(user.role, 'proposals:create')
    : false
  const canViewEquipment = user?.role
    ? hasPermission(user.role, 'equipment:view' as Permission)
    : false
  const canViewInvoices = user?.role
    ? hasPermission(user.role, 'invoices:view_all' as Permission) ||
      hasPermission(user.role, 'invoices:view_own' as Permission)
    : false
  const showAnalytics = canViewAll
  const isSuperAdmin = user?.role === 'super_admin'

  const dateRange = useMemo(() => getDateRange(timeframe), [timeframe])

  const firstName = user?.full_name ? user.full_name.split(' ')[0] : null

  // One-time fetch: do we have ANY jobs at all? Used to detect the
  // "your filter is too narrow" empty state.
  useEffect(() => {
    if (!organization || !user) return
    async function loadLifetime() {
      const supabase = createClient()
      let q = supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
      if (!isSuperAdmin) q = q.eq('organization_id', organization!.id)
      if (!canViewAll) q = q.eq('submitted_by', user!.id)
      const { count } = await q
      setLifetimeJobs(count ?? 0)
    }
    loadLifetime()
  }, [organization, user, canViewAll, isSuperAdmin])

  // Stats query — drives the primary KPI strip.
  useEffect(() => {
    if (!organization || !user) return

    async function loadStats() {
      setLoadingStats(true)
      const supabase = createClient()

      let query = supabase
        .from('jobs')
        .select('status', { count: 'exact' })
        .is('deleted_at', null)

      if (!isSuperAdmin) {
        query = query.eq('organization_id', organization!.id)
      }
      if (!canViewAll) {
        query = query.eq('submitted_by', user!.id)
      }
      if (dateRange.from) query = query.gte('service_date', dateRange.from)
      if (dateRange.to) query = query.lte('service_date', dateRange.to)
      if (clientId !== 'all') query = query.eq('client_id', clientId)

      const { data, error } = await query

      if (error) {
        console.error('Failed to load stats:', error.message)
        setLoadingStats(false)
        return
      }

      const jobs = data || []
      setStats({
        totalJobs: jobs.length,
        pendingReview: jobs.filter((j) => j.status === 'pending_review').length,
        approved: jobs.filter(
          (j) =>
            j.status === 'approved' ||
            j.status === 'sent' ||
            j.status === 'completed'
        ).length,
        submitted: jobs.filter(
          (j) => j.status === 'submitted' || j.status === 'ai_generating'
        ).length,
      })
      setLoadingStats(false)
    }

    loadStats()
  }, [organization, user, canViewAll, dateRange, clientId, isSuperAdmin])

  // Phase D: cheap secondary query for the hero "1 invoice overdue → mark
  // paid" chip. We pull every invoice that's flagged overdue OR is past its
  // due_date but still in 'sent' / 'partially_paid' status, then total the
  // outstanding balance for the chip subtitle.
  useEffect(() => {
    if (!organization || !user || !canViewInvoices) return
    let cancelled = false
    async function loadOverdue() {
      const supabase = createClient()
      const today = isoDate(new Date())
      // TODO: drop legacy decimal columns (total_amount, paid_amount) once all readers migrated.
      // We now read the canonical cents columns; balance_due_cents is a generated
      // column that always equals total_cents - amount_paid_cents, so we never need
      // to subtract by hand here (the legacy expression silently inflated AR by
      // every payment recorded via Books).
      let q = supabase
        .from('invoices')
        .select('id, balance_due_cents, status, due_date')
        .in('status', ['overdue', 'sent', 'partially_paid'])
      if (!isSuperAdmin) q = q.eq('organization_id', organization!.id)
      const { data, error } = await q
      if (error) {
        console.error('Overdue invoices load failed:', error.message)
        if (!cancelled) setOverdueInvoices({ count: 0, outstandingTotal: 0 })
        return
      }
      const overdueRows = (data || []).filter((inv) => {
        if (inv.status === 'overdue') return true
        return inv.due_date && inv.due_date < today
      })
      const outstanding = overdueRows.reduce((sum, inv) => {
        // balance_due_cents → dollars for the hero chip subtitle.
        const balanceCents = Number(inv.balance_due_cents) || 0
        return sum + Math.max(0, balanceCents) / 100
      }, 0)
      if (!cancelled) {
        setOverdueInvoices({
          count: overdueRows.length,
          outstandingTotal: outstanding,
        })
      }
    }
    loadOverdue()
    return () => {
      cancelled = true
    }
  }, [organization, user, canViewInvoices, isSuperAdmin])

  // Phase D: cheap secondary query for equipment due-soon / overdue chips.
  // Re-uses the lifecycle endpoint that's already in production so we don't
  // duplicate the lifecycle math here.
  useEffect(() => {
    if (!canViewEquipment) return
    let cancelled = false
    async function loadEquipment() {
      try {
        const res = await fetch('/api/dashboard/equipment-lifecycle', {
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`status ${res.status}`)
        const json = (await res.json()) as { dueSoon: number; overdue: number }
        if (!cancelled) {
          setEquipmentDue({
            dueSoon: json.dueSoon ?? 0,
            overdue: json.overdue ?? 0,
          })
        }
      } catch (err) {
        console.error('Equipment-due load failed:', err)
        if (!cancelled) setEquipmentDue({ dueSoon: 0, overdue: 0 })
      }
    }
    loadEquipment()
    return () => {
      cancelled = true
    }
  }, [canViewEquipment])

  useEffect(() => {
    if (!organization || !showAnalytics) return

    async function loadClients() {
      const supabase = createClient()
      let q = supabase
        .from('clients')
        .select('id, company_name')
        .order('company_name', { ascending: true })
      if (!isSuperAdmin) {
        q = q.eq('organization_id', organization!.id)
      }
      const { data } = await q
      setClients((data || []) as ClientOption[])
    }

    loadClients()
  }, [organization, showAnalytics, isSuperAdmin])

  const loadAnalytics = useCallback(async () => {
    if (!showAnalytics) return
    setLoadingAnalytics(true)
    const params = new URLSearchParams()
    if (dateRange.from) params.set('from', dateRange.from)
    if (dateRange.to) params.set('to', dateRange.to)
    if (clientId !== 'all') params.set('client_id', clientId)

    try {
      const res = await fetch(`/api/dashboard/analytics?${params.toString()}`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        console.error('Analytics fetch failed:', res.status)
        setAnalytics(null)
      } else {
        const json = (await res.json()) as AnalyticsResponse
        setAnalytics(json)
      }
    } catch (err) {
      console.error('Analytics fetch error:', err)
      setAnalytics(null)
    } finally {
      setLoadingAnalytics(false)
    }
  }, [dateRange, clientId, showAnalytics])

  useEffect(() => {
    loadAnalytics()
  }, [loadAnalytics])

  // ── Compose next-best-action chips for the hero ──────────────────────
  // Order matters here: highest-impact actions first. The hero re-sorts
  // by tone severity but preserves relative order for ties.
  const heroActions = useMemo(() => {
    const list: Array<{
      count: number
      noun: string
      context: string
      href: string
      icon: typeof ClipboardList
      tone: 'warning' | 'danger' | 'info' | 'success'
    }> = []

    if (canViewAll && stats && stats.pendingReview > 0) {
      list.push({
        count: stats.pendingReview,
        noun: 'job',
        context: 'pending review',
        href: '/jobs?status=pending_review',
        icon: ClipboardList,
        tone: 'warning',
      })
    }
    if (canViewInvoices && overdueInvoices && overdueInvoices.count > 0) {
      list.push({
        count: overdueInvoices.count,
        noun: 'invoice',
        context: 'overdue',
        href: '/invoices?status=overdue',
        icon: DollarSign,
        tone: 'danger',
      })
    }
    const equipmentTotal =
      (equipmentDue?.overdue ?? 0) + (equipmentDue?.dueSoon ?? 0)
    if (canViewEquipment && equipmentTotal > 0) {
      list.push({
        count: equipmentTotal,
        noun: 'piece of equipment',
        context: equipmentDue!.overdue > 0 ? 'overdue or due soon' : 'due soon',
        href: '/equipment',
        icon: Wrench,
        tone: equipmentDue!.overdue > 0 ? 'warning' : 'info',
      })
    }
    return list
  }, [
    canViewAll,
    canViewInvoices,
    canViewEquipment,
    stats,
    overdueInvoices,
    equipmentDue,
  ])

  // Pick the "featured" KPI for the mobile single-column layout.
  const featuredMobileKPI = useMemo(() => {
    if (!stats) return null
    if (stats.pendingReview > 0 && canViewAll) {
      return {
        label: 'Pending Review',
        value: stats.pendingReview,
        helper: 'Jobs awaiting your approval',
        icon: Clock,
        onClick: () => router.push('/jobs?status=pending_review'),
      }
    }
    if (showAnalytics && analytics && analytics.outstandingRevenue > 0) {
      return {
        label: 'Outstanding Revenue',
        value: formatCurrency(analytics.outstandingRevenue),
        helper: 'Unpaid invoice balance',
        icon: Receipt,
        onClick: () => router.push('/invoices'),
      }
    }
    return {
      label: canViewAll ? 'Total Jobs' : 'My Jobs',
      value: stats.totalJobs,
      helper: showAnalytics
        ? TIMEFRAME_LABELS[timeframe].toLowerCase()
        : 'all time',
      icon: ClipboardList,
      onClick: () => router.push('/jobs'),
    }
  }, [stats, analytics, canViewAll, showAnalytics, timeframe, router])

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto pb-24 sm:pb-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-32 rounded-full" />
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  const heroRightActions = (
    <>
      {canCreateProposal && (
        <Button
          variant="outline"
          className="w-full sm:w-auto h-10"
          onClick={() => router.push('/proposals/new')}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Proposal
        </Button>
      )}
      {canCreate && (
        <Button
          variant="brand"
          className="w-full sm:w-auto h-10"
          onClick={() => router.push('/jobs/new')}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Job
        </Button>
      )}
    </>
  )

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto pb-24 sm:pb-6">
      {/* D1: Hero greeting + next-best-action chips */}
      <DashboardHero
        firstName={firstName}
        actions={heroActions}
        rightActions={heroRightActions}
      />

      {/* MOBILE-ONLY: single featured KPI card (D5) */}
      {featuredMobileKPI && (
        <div className="sm:hidden">
          <KPICard
            label={featuredMobileKPI.label}
            value={featuredMobileKPI.value}
            helper={featuredMobileKPI.helper}
            icon={featuredMobileKPI.icon}
            onClick={featuredMobileKPI.onClick}
            loading={loadingStats}
          />
        </div>
      )}

      {/* Filter bar — sticky so it stays visible while scrolling KPI sections */}
      {showAnalytics && (
        <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0 hidden sm:inline">
                Timeframe
              </span>
              <Select
                value={timeframe}
                onValueChange={(value) => value && setTimeframe(value as Timeframe)}
              >
                <SelectTrigger className="w-full sm:min-w-[140px] sm:w-auto sm:flex-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TIMEFRAME_LABELS) as Timeframe[]).map((tf) => (
                    <SelectItem key={tf} value={tf}>
                      {TIMEFRAME_LABELS[tf]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0 hidden sm:inline">
                Client
              </span>
              <Select
                value={clientId}
                onValueChange={(value) => value && setClientId(value)}
              >
                <SelectTrigger className="w-full sm:min-w-[180px] sm:w-auto sm:flex-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clients</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {/* Hint: filter is too narrow */}
      {showAnalytics &&
        !loadingStats &&
        timeframe !== 'all' &&
        stats?.totalJobs === 0 &&
        (lifetimeJobs ?? 0) > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
            <p className="text-amber-900 dark:text-amber-200">
              <strong>No jobs in this timeframe.</strong> You have{' '}
              <strong>{lifetimeJobs}</strong>{' '}
              {lifetimeJobs === 1 ? 'job' : 'jobs'} in total. Try widening the
              timeframe.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-9 border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20"
              onClick={() => setTimeframe('all')}
            >
              View all time
            </Button>
          </div>
        )}

      {/* D2: Primary KPI strip — hidden on mobile (featured card replaces it) */}
      <div className="hidden sm:grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard
          label={canViewAll ? 'Total Jobs' : 'My Jobs'}
          value={stats?.totalJobs ?? 0}
          icon={ClipboardList}
          helper={
            showAnalytics ? TIMEFRAME_LABELS[timeframe].toLowerCase() : 'all time'
          }
          onClick={() => router.push('/jobs')}
          loading={loadingStats}
        />
        <KPICard
          label="Submitted"
          value={stats?.submitted ?? 0}
          icon={Send}
          helper="being processed"
          onClick={() => router.push('/jobs')}
          loading={loadingStats}
        />
        <KPICard
          label="Pending Review"
          value={stats?.pendingReview ?? 0}
          icon={Clock}
          helper="awaiting approval"
          onClick={() => router.push('/jobs?status=pending_review')}
          loading={loadingStats}
        />
        <KPICard
          label="Approved"
          value={stats?.approved ?? 0}
          icon={CheckCircle2}
          helper="completed or sent"
          onClick={() => router.push('/jobs')}
          loading={loadingStats}
        />
      </div>

      {/* D2: Financials KPI strip — owner/manager only.
          The cards with null analytics values are hidden by default; the
          "Show all metrics" toggle reveals them. */}
      {showAnalytics && (
        <div className="hidden sm:block space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <KPICard
              label="Outstanding Revenue"
              value={
                analytics ? formatCurrency(analytics.outstandingRevenue) : '$0'
              }
              icon={Receipt}
              helper="unpaid invoice balance"
              onClick={() => router.push('/invoices')}
              loading={loadingAnalytics}
            />

            {/* Show always if a value exists, otherwise behind toggle. */}
            {(showAllMetrics || (analytics?.avgCostPerJob ?? null) !== null) && (
              <KPICard
                label="Avg Cost per Job"
                value={
                  analytics?.avgCostPerJob == null
                    ? '—'
                    : formatCurrency(analytics.avgCostPerJob)
                }
                icon={DollarSign}
                helper={
                  analytics
                    ? `${analytics.recordCounts.jobs} jobs · ${analytics.recordCounts.invoices} invoices`
                    : ' '
                }
                loading={loadingAnalytics}
              />
            )}

            {(showAllMetrics ||
              (analytics?.avgProposalToSignedHours ?? null) !== null) && (
              <KPICard
                label="Avg Proposal → Signed"
                value={
                  analytics?.avgProposalToSignedHours == null
                    ? '—'
                    : formatDuration(analytics.avgProposalToSignedHours)
                }
                icon={Hourglass}
                helper={
                  analytics
                    ? `${analytics.recordCounts.proposalToSigned} proposals`
                    : ' '
                }
                loading={loadingAnalytics}
              />
            )}

            {(showAllMetrics ||
              (analytics?.avgSignedToStartedHours ?? null) !== null) && (
              <KPICard
                label="Avg Signed → Started"
                value={
                  analytics?.avgSignedToStartedHours == null
                    ? '—'
                    : formatDuration(analytics.avgSignedToStartedHours)
                }
                icon={PlayCircle}
                helper={
                  analytics
                    ? `${analytics.recordCounts.signedToStarted} jobs`
                    : ' '
                }
                loading={loadingAnalytics}
              />
            )}

            {(showAllMetrics ||
              (analytics?.avgStartedToCompletedHours ?? null) !== null) && (
              <KPICard
                label="Avg Started → Completed"
                value={
                  analytics?.avgStartedToCompletedHours == null
                    ? '—'
                    : formatDuration(analytics.avgStartedToCompletedHours)
                }
                icon={Flag}
                helper={
                  analytics
                    ? `${analytics.recordCounts.startedToCompleted} jobs`
                    : ' '
                }
                loading={loadingAnalytics}
              />
            )}
          </div>

          {/* "Show all metrics" toggle — only when there's something hidden */}
          {!loadingAnalytics &&
            analytics &&
            [
              analytics.avgCostPerJob,
              analytics.avgProposalToSignedHours,
              analytics.avgSignedToStartedHours,
              analytics.avgStartedToCompletedHours,
            ].some((v) => v == null) && (
              <button
                type="button"
                onClick={() => setShowAllMetrics((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAllMetrics ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5" />
                    Hide empty metrics
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3.5 w-3.5" />
                    Show all metrics
                  </>
                )}
              </button>
            )}
        </div>
      )}

      {/* D4: Equipment lifecycle widget — visible to users who can see equipment */}
      {canViewEquipment && <EquipmentLifecycleWidget />}

      {/* D3 + D5: Activity feed.
          Desktop = side-by-side with quick actions; mobile = full width. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2">
          <DashboardActivityFeed limit={10} />
        </div>
        {(canCreate || canCreateProposal) && (
          <div className="hidden sm:block">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {canCreate && (
                  <Button
                    variant="outline"
                    className="h-10 w-full justify-start"
                    onClick={() => router.push('/jobs/new')}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    New Job
                  </Button>
                )}
                {canCreateProposal && (
                  <Button
                    variant="outline"
                    className="h-10 w-full justify-start"
                    onClick={() => router.push('/proposals/new')}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    New Proposal
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="h-10 w-full justify-start"
                  onClick={() => router.push('/jobs')}
                >
                  View {canViewAll ? 'All' : 'My'} Jobs
                </Button>
                <Button
                  variant="outline"
                  className="h-10 w-full justify-start"
                  onClick={() => router.push('/clients')}
                >
                  View Clients
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
