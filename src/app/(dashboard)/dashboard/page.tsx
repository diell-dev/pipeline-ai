'use client'

/**
 * Dashboard Page
 *
 * Role-adaptive dashboard:
 * - Field Tech: My jobs stats, quick submit button
 * - Owner/Office Manager: All jobs overview, financials summary
 * - Client: Their reports and invoices
 *
 * Owners/managers also get an analytics layer (timeframe + client filter,
 * KPI cards for total jobs, outstanding revenue, avg cost per job, and
 * three "time-to-X" workflow metrics) on top of the existing summary.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission, type Permission } from '@/lib/permissions'
import { getRoleLabel } from '@/lib/permissions'
import { EquipmentLifecycleWidget } from '@/components/equipment/lifecycle-widget'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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
} from 'lucide-react'

interface DashboardStats {
  totalJobs: number
  pendingReview: number
  approved: number
  submitted: number
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
    // Start of week (Sunday)
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

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

export default function DashboardPage() {
  const router = useRouter()
  const { user, organization, isLoading } = useAuthStore()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loadingStats, setLoadingStats] = useState(true)

  // Analytics filters. Default to 'year' so users see their historical data
  // immediately instead of an empty "0 this month" dashboard when they have
  // data from prior months. They can narrow to 'month' or 'week' via the picker.
  const [timeframe, setTimeframe] = useState<Timeframe>('year')
  const [clientId, setClientId] = useState<string>('all')
  // Track whether *any* jobs exist (without the timeframe filter) so we can
  // show a helpful "your data is outside this timeframe" hint when the
  // current filter returns 0 but the org has jobs.
  const [lifetimeJobs, setLifetimeJobs] = useState<number | null>(null)
  const [clients, setClients] = useState<ClientOption[]>([])
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null)
  const [loadingAnalytics, setLoadingAnalytics] = useState(true)

  const canViewAll = user?.role ? hasPermission(user.role, 'jobs:view_all') : false
  const canCreate = user?.role ? hasPermission(user.role, 'jobs:create') : false
  const canCreateProposal = user?.role ? hasPermission(user.role, 'proposals:create') : false
  // Cast: 'equipment:view' is added to the Permission union by the backend agent.
  const canViewEquipment = user?.role
    ? hasPermission(user.role, 'equipment:view' as Permission)
    : false
  // Analytics layer is only useful to people who can see all jobs (owners/managers).
  const showAnalytics = canViewAll
  // Super_admin can read across all orgs (RLS allows it). The dashboard scopes
  // queries to the user's own org by default, but for super_admin we drop that
  // filter so they see platform-wide aggregates — otherwise super_admins land
  // on a "0 of everything" dashboard when their nominal org has no real data.
  const isSuperAdmin = user?.role === 'super_admin'

  const dateRange = useMemo(() => getDateRange(timeframe), [timeframe])

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

  // Re-applies stats query whenever the timeframe / client filter changes
  // so the existing "Total Jobs" / "Submitted" / "Pending Review" / "Approved"
  // KPIs respect the same filters as the new analytics layer.
  useEffect(() => {
    if (!organization || !user) return

    async function loadStats() {
      setLoadingStats(true)
      const supabase = createClient()

      let query = supabase
        .from('jobs')
        .select('status', { count: 'exact' })
        .is('deleted_at', null)

      // Super_admin sees all orgs; everyone else scoped to their own org
      if (!isSuperAdmin) {
        query = query.eq('organization_id', organization!.id)
      }

      // Field techs only see their own
      if (!canViewAll) {
        query = query.eq('submitted_by', user!.id)
      }

      // Apply timeframe + client filters (only meaningful for owner/manager view,
      // but harmless for techs since they're already constrained to their jobs).
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

  // Load client list for the filter dropdown (owner/manager only)
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

  // Fetch analytics from the API whenever the filters change
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

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            Welcome back{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}
          </h1>
          <p className="text-sm text-muted-foreground">
            {user?.role ? getRoleLabel(user.role) : ''}
            {user?.email ? ` · ${user.email}` : ''}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
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
        </div>
      </div>

      {/* Filter bar — sticky so it stays visible while scrolling KPI sections */}
      {/* UX-SWEEP-#20: filter row was here — switched mobile layout from a
          single column (TIMEFRAME / CLIENT on separate rows) to a 2-column
          grid so both selects fit on one row on phones. Coordinate with
          Agent A: this is the only change here in this scope. */}
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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
            <p className="text-amber-900">
              <strong>No jobs in this timeframe.</strong> You have{' '}
              <strong>{lifetimeJobs}</strong> {lifetimeJobs === 1 ? 'job' : 'jobs'} in total.
              Try widening the timeframe.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-9 border-amber-300 text-amber-900 hover:bg-amber-100"
              onClick={() => setTimeframe('all')}
            >
              View all time
            </Button>
          </div>
        )}

      {/* KPI Cards — Pipeline summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push('/jobs')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              {canViewAll ? 'Total Jobs' : 'My Jobs'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-bold">
              {loadingStats ? '—' : stats?.totalJobs ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {showAnalytics ? TIMEFRAME_LABELS[timeframe].toLowerCase() : 'all time'}
            </p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push('/jobs')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Send className="h-4 w-4" />
              Submitted
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-bold text-foreground">
              {loadingStats ? '—' : stats?.submitted ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">being processed</p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push('/jobs')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Pending Review
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-bold text-foreground">
              {loadingStats ? '—' : stats?.pendingReview ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">awaiting approval</p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push('/jobs')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Approved
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-bold text-foreground">
              {loadingStats ? '—' : stats?.approved ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">completed or sent</p>
          </CardContent>
        </Card>
      </div>

      {/* Financials row — owner/manager only */}
      {showAnalytics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Receipt className="h-4 w-4" />
                Outstanding Revenue
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingAnalytics ? (
                <Skeleton className="h-9 w-28" />
              ) : (
                <div className="text-2xl sm:text-3xl font-bold">
                  {formatCurrency(analytics?.outstandingRevenue ?? 0)}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">unpaid invoice balance</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Avg Cost per Job
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingAnalytics ? (
                <Skeleton className="h-9 w-28" />
              ) : analytics?.avgCostPerJob == null ? (
                <div className="text-2xl sm:text-3xl font-bold">—</div>
              ) : (
                <div className="text-2xl sm:text-3xl font-bold">
                  {formatCurrency(analytics.avgCostPerJob)}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {analytics
                  ? `(based on ${analytics.recordCounts.jobs} jobs / ${analytics.recordCounts.invoices} invoices)`
                  : ' '}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Hourglass className="h-4 w-4" />
                Avg Proposal → Signed
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingAnalytics ? (
                <Skeleton className="h-9 w-28" />
              ) : analytics?.avgProposalToSignedHours == null ? (
                <div className="text-2xl sm:text-3xl font-bold">—</div>
              ) : (
                <div className="text-2xl sm:text-3xl font-bold">
                  {formatDuration(analytics.avgProposalToSignedHours)}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {analytics
                  ? `(based on ${analytics.recordCounts.proposalToSigned} proposals)`
                  : ' '}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <PlayCircle className="h-4 w-4" />
                Avg Signed → Started
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingAnalytics ? (
                <Skeleton className="h-9 w-28" />
              ) : analytics?.avgSignedToStartedHours == null ? (
                <div className="text-2xl sm:text-3xl font-bold">—</div>
              ) : (
                <div className="text-2xl sm:text-3xl font-bold">
                  {formatDuration(analytics.avgSignedToStartedHours)}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {analytics
                  ? `(based on ${analytics.recordCounts.signedToStarted} jobs)`
                  : ' '}
              </p>
            </CardContent>
          </Card>

          {(loadingAnalytics || analytics?.avgStartedToCompletedHours != null) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Flag className="h-4 w-4" />
                  Avg Started → Completed
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingAnalytics ? (
                  <Skeleton className="h-9 w-28" />
                ) : (
                  <div className="text-2xl sm:text-3xl font-bold">
                    {formatDuration(analytics!.avgStartedToCompletedHours!)}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {analytics
                    ? `(based on ${analytics.recordCounts.startedToCompleted} jobs)`
                    : ' '}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Equipment lifecycle widget — visible only to users who can see equipment */}
      {/* UX-SWEEP-#15: collapse 3 zero cards (Overdue / Due 90d / Past Lifespan) into a single success line "All equipment current — no overdue or upcoming service items" when all three are 0. Lives inside src/components/equipment/lifecycle-widget.tsx (out of scope for dashboard agent). */}
      {/* UX-SWEEP-#16: hide the "Replacement cost by category (top 5)" sub-widget when the top result is $0 OR there's only 1 category with $0 cost. Also inside lifecycle-widget.tsx. */}
      {canViewEquipment && <EquipmentLifecycleWidget />}

      {/* Quick Actions */}
      {(canCreate || canCreateProposal) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {canCreate && (
              <Button
                variant="outline"
                className="h-10"
                onClick={() => router.push('/jobs/new')}
              >
                <Plus className="mr-2 h-4 w-4" />
                New Job
              </Button>
            )}
            {canCreateProposal && (
              <Button variant="outline" className="h-10" onClick={() => router.push('/proposals/new')}>
                <Plus className="mr-2 h-4 w-4" />
                New Proposal
              </Button>
            )}
            <Button variant="outline" className="h-10" onClick={() => router.push('/jobs')}>
              View {canViewAll ? 'All' : 'My'} Jobs
            </Button>
            <Button variant="outline" className="h-10" onClick={() => router.push('/clients')}>
              View Clients
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
