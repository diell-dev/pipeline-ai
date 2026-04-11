'use client'

/**
 * Dashboard Page
 *
 * Role-adaptive dashboard:
 * - Field Tech: My jobs stats, quick submit button
 * - Owner/Office Manager: All jobs overview, financials summary
 * - Client: Their reports and invoices
 */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { getRoleLabel } from '@/lib/permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ClipboardList,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Send,
} from 'lucide-react'

interface DashboardStats {
  totalJobs: number
  pendingReview: number
  approved: number
  submitted: number
}

export default function DashboardPage() {
  const router = useRouter()
  const { user, organization, isLoading } = useAuthStore()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loadingStats, setLoadingStats] = useState(true)

  const canViewAll = user?.role ? hasPermission(user.role, 'jobs:view_all') : false
  const canCreate = user?.role ? hasPermission(user.role, 'jobs:create') : false

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
        approved: jobs.filter((j) => j.status === 'approved' || j.status === 'sent' || j.status === 'completed').length,
        submitted: jobs.filter((j) => j.status === 'submitted' || j.status === 'ai_generating').length,
      })
      setLoadingStats(false)
    }

    loadStats()
  }, [organization, user, canViewAll])

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">
            Welcome back{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}
          </h1>
          <p className="text-muted-foreground text-sm">
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push('/jobs')}
        >
          <CardHeader className="pb-2 px-4">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ClipboardList className="h-4 w-4 shrink-0" />
              <span className="truncate">{canViewAll ? 'Total Jobs' : 'My Jobs'}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <div className="text-2xl md:text-3xl font-bold">
              {loadingStats ? '—' : stats?.totalJobs ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">all time</p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push('/jobs')}
        >
          <CardHeader className="pb-2 px-4">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Send className="h-4 w-4 shrink-0" />
              Submitted
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <div className="text-2xl md:text-3xl font-bold text-blue-600">
              {loadingStats ? '—' : stats?.submitted ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">being processed</p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push('/jobs')}
        >
          <CardHeader className="pb-2 px-4">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 shrink-0" />
              <span className="truncate">Pending Review</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <div className="text-2xl md:text-3xl font-bold text-amber-600">
              {loadingStats ? '—' : stats?.pendingReview ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">awaiting approval</p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push('/jobs')}
        >
          <CardHeader className="pb-2 px-4">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Approved
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <div className="text-2xl md:text-3xl font-bold text-green-600">
              {loadingStats ? '—' : stats?.approved ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">completed or sent</p>
          </CardContent>
        </Card>
      </div>

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
