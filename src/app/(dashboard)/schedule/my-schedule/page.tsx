'use client'

/**
 * My Schedule — field tech's personal upcoming jobs.
 * Shows jobs where assigned_to = me OR I'm a member of the assigned crew.
 * Status filter: scheduled OR submitted (active work).
 * Mobile-first: large cards, grouped by date with sticky headers.
 */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  Calendar,
  Clock,
  MapPin,
  Loader2,
  Building2,
  PlayCircle,
  AlertTriangle,
} from 'lucide-react'
import type { JobPriority, JobStatus } from '@/types/database'

interface MyJob {
  id: string
  status: JobStatus
  priority: JobPriority
  service_date: string
  scheduled_time: string | null
  scheduled_end_time: string | null
  estimated_duration_minutes: number | null
  clients: { company_name: string } | null
  sites: { name: string; address: string } | null
}

const PRIORITY_BADGE: Record<JobPriority, string> = {
  normal: 'bg-zinc-100 text-zinc-600',
  urgent: 'bg-amber-100 text-amber-700',
  emergency: 'bg-red-100 text-red-700',
}

function formatTime(iso: string | null): string {
  if (!iso) return 'No time set'
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatDateHeading(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (d.getTime() === today.getTime()) return 'Today'
  if (d.getTime() === tomorrow.getTime()) return 'Tomorrow'
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

export default function MyScheduleePage() {
  const router = useRouter()
  const { user, organization } = useAuthStore()

  const [jobs, setJobs] = useState<MyJob[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || !organization) return

    async function loadJobs() {
      setLoading(true)
      try {
        const supabase = createClient()

        // Find crews this user is a member of
        const { data: memberships } = await supabase
          .from('crew_members')
          .select('crew_id')
          .eq('user_id', user!.id)
        const crewIds = (memberships || []).map((m) => m.crew_id)

        // Build the query: jobs assigned_to me OR in one of my crews
        const todayStr = new Date().toISOString().slice(0, 10)
        let q = supabase
          .from('jobs')
          .select(`
            id, status, priority, service_date, scheduled_time, scheduled_end_time,
            estimated_duration_minutes,
            clients:client_id ( company_name ),
            sites:site_id ( name, address )
          `)
          .eq('organization_id', organization!.id)
          .is('deleted_at', null)
          .in('status', ['scheduled', 'submitted'])
          .gte('service_date', todayStr)
          .order('service_date', { ascending: true })
          .order('scheduled_time', { ascending: true })

        // Either assigned_to me OR crew_id IN myCrewIds
        if (crewIds.length > 0) {
          q = q.or(`assigned_to.eq.${user!.id},crew_id.in.(${crewIds.join(',')})`)
        } else {
          q = q.eq('assigned_to', user!.id)
        }

        const { data, error } = await q
        if (error) throw error
        setJobs((data as unknown as MyJob[]) || [])
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error('Failed to load my jobs:', msg)
        toast.error('Failed to load your schedule')
      } finally {
        setLoading(false)
      }
    }

    loadJobs()
  }, [user, organization])

  // Group by date
  const grouped: { date: string; jobs: MyJob[] }[] = []
  let currentDate = ''
  let currentGroup: MyJob[] = []
  for (const job of jobs) {
    if (job.service_date !== currentDate) {
      if (currentGroup.length > 0) {
        grouped.push({ date: currentDate, jobs: currentGroup })
      }
      currentDate = job.service_date
      currentGroup = [job]
    } else {
      currentGroup.push(job)
    }
  }
  if (currentGroup.length > 0) {
    grouped.push({ date: currentDate, jobs: currentGroup })
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <Calendar className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">My Schedule</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {jobs.length} upcoming job{jobs.length !== 1 ? 's' : ''} assigned to you.
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && jobs.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Calendar className="h-12 w-12 text-muted-foreground/50 mb-3" />
            <h3 className="text-base font-semibold mb-1">No upcoming jobs</h3>
            <p className="text-sm text-muted-foreground text-center">
              You&apos;re all caught up! New jobs will appear here once assigned.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && grouped.length > 0 && (
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.date}>
              <h2 className="text-sm font-semibold mb-2 sticky top-0 bg-zinc-50 py-2 z-10 border-b">
                {formatDateHeading(group.date)}
              </h2>
              <div className="space-y-3">
                {group.jobs.map((job) => (
                  <Card key={job.id} className="overflow-hidden">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-4 w-4" />
                          <span className="font-medium text-foreground">
                            {formatTime(job.scheduled_time)}
                          </span>
                          {job.estimated_duration_minutes && (
                            <span className="text-xs">
                              · {job.estimated_duration_minutes} min
                            </span>
                          )}
                        </div>
                        {job.priority !== 'normal' && (
                          <Badge className={PRIORITY_BADGE[job.priority]} variant="outline">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {job.priority}
                          </Badge>
                        )}
                      </div>

                      <div className="space-y-2 mb-4">
                        <div className="flex items-start gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-base font-semibold">
                              {job.clients?.company_name || 'Unknown Client'}
                            </p>
                            {job.sites?.name && (
                              <p className="text-sm text-muted-foreground truncate">
                                {job.sites.name}
                              </p>
                            )}
                          </div>
                        </div>

                        {job.sites?.address && (
                          <div className="flex items-start gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                            <a
                              href={`https://maps.google.com/?q=${encodeURIComponent(job.sites.address)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm text-blue-600 hover:underline break-words"
                            >
                              {job.sites.address}
                            </a>
                          </div>
                        )}
                      </div>

                      <Button
                        className="w-full"
                        onClick={() => router.push(`/jobs/${job.id}`)}
                      >
                        <PlayCircle className="mr-2 h-4 w-4" />
                        Open Job
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
