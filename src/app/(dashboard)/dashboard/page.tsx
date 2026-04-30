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
import { hasPermission } from '@/lib/permissions'
import { getRoleLabel } from '@/lib/permissions'
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

  // Analytics filters
  const [timeframe, setTimeframe] = useState<Timeframe>('month')
  const [clientId, setClientId] = useState<string>('all')
  const [clients, setClients] = useState<ClientOption[]>([])
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null)
  const [loadingAnalytics, setLoadingAnalytics] = useState(true)

  const canViewAll = user?.role ? hasPermission(user.role, 'jobs:view_all') : false
  const canCreate = user?.role ? hasPermission(user.role, 'jobs:create') : false
  // Analytics layer is only useful to people who can see all jobs (owners/managers).
  const showAnalytics = canViewAll

  const dateRange = useMemo(() => getDateRange(timeframe), [timeframe])

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
        .eq('organization_id', organization!.id)
        .is('deleted_at', null)

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
  }, [organization, user, canViewAll, dateRange, clientId])

  // Load client list for the filter dropdown (owner/manager only)
  useEffect(() => {
    if (!organization || !showAnalytics) return

    async function loadClients() {
      const supabase = createClient()
      const { data } = await supabase
        .from('clients')
        .select('id, company_name')
        .eq('organization_id', organization!.id)
        .order('company_name', { ascending: true })
      setClients((data || []) as ClientOption[])
    }

    loadClients()
  }, [organization, showAnalytics])

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
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome back{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}
          </h1>
          <p className="text-muted-foreground">
            {organization?.name} — {user?.role ? getRoleLabel(user.role) : ''}
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => router.push('/jobs/new')}>
            <Plus className="mr-2 h-4 w-4" />
            New Job
          </Button>
        )}
      </div>

      {/* Filter bar — sticky so it stays visible while scrolling KPI sections */}
      {showAnalytics && (
        <div className="sticky top-0 z-10 -mx-6 px-6 py-3 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Timeframe
              </span>
              <Select
                value={timeframe}
                onValueChange={(value) => value && setTimeframe(value as Timeframe)}
              >
                <SelectTrigger className="min-w-[140px]">
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

            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Client
              </span>
              <Select
                value={clientId}
                onValueChange={(value) => value && setClientId(value)}
              >
                <SelectTrigger className="min-w-[180px]">
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

      {/* KPI Cards — Pipeline summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
            <div className="text-3xl font-bold">
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
            <div className="text-3xl font-bold text-blue-600">
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
            <div className="text-3xl font-bold text-amber-600">
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
            <div className="text-3xl font-bold text-green-600">
              {loadingStats ? '—' : stats?.approved ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">completed or sent</p>
          </CardContent>
        </Card>
      </div>

      {/* Financials row — owner/manager only */}
      {showAnalytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                <div className="text-3xl font-bold">
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
                <div className="text-3xl font-bold">—</div>
              ) : (
                <div className="text-3xl font-bold">
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
                <div className="text-3xl font-bold">—</div>
              ) : (
                <div className="text-3xl font-bold">
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
                <div className="text-3xl font-bold">—</div>
              ) : (
                <div className="text-3xl font-bold">
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
              ) : analytics?.avgStartedToCompletedHours == null ? (
                <div className="text-3xl font-bold">—</div>
              ) : (
                <div className="text-3xl font-bold">
                  {formatDuration(analytics.avgStartedToCompletedHours)}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {analytics
                  ? `(based on ${analytics.recordCounts.startedToCompleted} jobs)`
                  : ' '}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Quick Actions */}
      {canCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button onClick={() => router.push('/jobs/new')}>
              <Plus className="mr-2 h-4 w-4" />
              Submit New Job
            </Button>
            <Button variant="outline" onClick={() => router.push('/clients')}>
              View Clients
            </Button>
            <Button variant="outline" onClick={() => router.push('/jobs')}>
              View {canViewAll ? 'All' : 'My'} Jobs
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
