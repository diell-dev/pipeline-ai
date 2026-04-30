'use client'

/**
 * Schedule / Calendar Page
 *
 * Three views: Day, Week, Month. Default Week.
 * Managers see the full calendar; field techs see "My Schedule" via a separate route
 * but they can also access this page (read-only filtered to their crew/own jobs by RLS).
 *
 * Color-coded by crew (or by tech if no crew).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Loader2,
  Clock,
  MapPin,
  User as UserIcon,
  Users as UsersIcon,
} from 'lucide-react'

interface ScheduleJob {
  id: string
  status: string
  priority: string
  service_date: string
  scheduled_time: string | null
  scheduled_end_time: string | null
  estimated_duration_minutes: number | null
  assigned_to: string | null
  crew_id: string | null
  clients: { id: string; company_name: string } | null
  sites: { id: string; name: string; address: string } | null
  assigned_user: { id: string; full_name: string; avatar_url: string | null } | null
  crew: { id: string; name: string; color: string } | null
}

type ViewMode = 'day' | 'week' | 'month'

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7) // 7am — 8pm
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ── Date helpers (no date-fns; using native Date) ─────────────
function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function startOfWeek(d: Date): Date {
  const x = startOfDay(d)
  const day = x.getDay() // 0 = Sun
  // Treat Monday as start of week
  const diff = day === 0 ? -6 : 1 - day
  x.setDate(x.getDate() + diff)
  return x
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function sameDay(a: Date, b: Date): boolean {
  return ymd(a) === ymd(b)
}
function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function SchedulePage() {
  const router = useRouter()
  const { user } = useAuthStore()
  const canSchedule = user?.role ? hasPermission(user.role, 'jobs:schedule') : false

  const [view, setView] = useState<ViewMode>('week')
  const [cursor, setCursor] = useState<Date>(new Date())
  const [jobs, setJobs] = useState<ScheduleJob[]>([])
  const [loading, setLoading] = useState(true)
  const [isMobile, setIsMobile] = useState(false)
  const [quickDate, setQuickDate] = useState<Date | null>(null)

  // Mobile detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Compute the date range for the API call based on view
  const { rangeFrom, rangeTo, daysShown } = useMemo(() => {
    if (view === 'day') {
      const d = startOfDay(cursor)
      return { rangeFrom: d, rangeTo: d, daysShown: [d] }
    }
    if (view === 'week') {
      const start = startOfWeek(cursor)
      const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
      return { rangeFrom: start, rangeTo: addDays(start, 6), daysShown: days }
    }
    // month — show full grid that contains the month (start of week of 1st → end of week of last)
    const monthStart = startOfMonth(cursor)
    const monthEnd = endOfMonth(cursor)
    const gridStart = startOfWeek(monthStart)
    const gridEnd = (() => {
      const end = startOfWeek(monthEnd)
      return addDays(end, 6)
    })()
    const total = Math.round((gridEnd.getTime() - gridStart.getTime()) / 86400000) + 1
    const days = Array.from({ length: total }, (_, i) => addDays(gridStart, i))
    return { rangeFrom: gridStart, rangeTo: gridEnd, daysShown: days }
  }, [view, cursor])

  // Load jobs in the current range
  const loadJobs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/schedule?from=${ymd(rangeFrom)}&to=${ymd(rangeTo)}`
      )
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to load schedule')
      setJobs(result.jobs || [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('Failed to load schedule:', msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [rangeFrom, rangeTo])

  useEffect(() => {
    loadJobs()
  }, [loadJobs])

  // Group jobs by date string
  const jobsByDate = useMemo(() => {
    const map = new Map<string, ScheduleJob[]>()
    for (const job of jobs) {
      const key = job.service_date
      const arr = map.get(key) || []
      arr.push(job)
      map.set(key, arr)
    }
    // Sort each day by scheduled_time
    map.forEach((arr) => {
      arr.sort((a, b) => {
        if (!a.scheduled_time && !b.scheduled_time) return 0
        if (!a.scheduled_time) return 1
        if (!b.scheduled_time) return -1
        return a.scheduled_time.localeCompare(b.scheduled_time)
      })
    })
    return map
  }, [jobs])

  // Navigation
  function navigate(dir: 'prev' | 'next' | 'today') {
    if (dir === 'today') {
      setCursor(new Date())
      return
    }
    const delta = dir === 'next' ? 1 : -1
    if (view === 'day') setCursor(addDays(cursor, delta))
    else if (view === 'week') setCursor(addDays(cursor, delta * 7))
    else {
      const d = new Date(cursor)
      d.setMonth(d.getMonth() + delta)
      setCursor(d)
    }
  }

  // Get color for a job (crew color or fallback)
  function getJobColor(job: ScheduleJob): string {
    if (job.crew?.color) return job.crew.color
    // Hash assigned_to id for consistent color
    if (job.assigned_to) {
      const hash = job.assigned_to.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
      const palette = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4']
      return palette[hash % palette.length]
    }
    return '#6B7280'
  }

  // Header label depending on view
  const headerLabel = useMemo(() => {
    if (view === 'day') {
      return cursor.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    }
    if (view === 'week') {
      const start = startOfWeek(cursor)
      const end = addDays(start, 6)
      const sameMonth = start.getMonth() === end.getMonth()
      const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const endStr = end.toLocaleDateString('en-US', {
        month: sameMonth ? undefined : 'short',
        day: 'numeric',
        year: 'numeric',
      })
      return `${startStr} – ${endStr}`
    }
    return cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }, [view, cursor])

  // Mobile view — render as a list grouped by day
  const showAsList = isMobile

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Schedule</h1>
        </div>
        {canSchedule && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/schedule/recurring')}
            >
              Recurring
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/schedule/crews')}
            >
              <UsersIcon className="mr-2 h-3.5 w-3.5" />
              Crews
            </Button>
            <Button size="sm" onClick={() => router.push('/jobs/new')}>
              <Plus className="mr-2 h-3.5 w-3.5" />
              New Job
            </Button>
          </div>
        )}
      </div>

      {/* Controls — date nav + view tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('prev')}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('today')}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('next')}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="ml-2 text-sm font-medium">{headerLabel}</div>
        </div>

        <div className="flex items-center gap-1 rounded-lg border bg-white p-1">
          {(['day', 'week', 'month'] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-xs rounded-md transition-colors capitalize ${
                view === v
                  ? 'bg-zinc-900 text-white'
                  : 'text-zinc-600 hover:bg-zinc-100'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Mobile / list view */}
      {!loading && showAsList && (
        <MobileListView
          jobs={jobs}
          getJobColor={getJobColor}
          onSelect={(job) => router.push(`/jobs/${job.id}`)}
        />
      )}

      {/* Day view */}
      {!loading && !showAsList && view === 'day' && (
        <DayView
          date={cursor}
          jobs={jobsByDate.get(ymd(cursor)) || []}
          getJobColor={getJobColor}
          onSelectJob={(job) => router.push(`/jobs/${job.id}`)}
          onSelectSlot={(date) => canSchedule && setQuickDate(date)}
        />
      )}

      {/* Week view */}
      {!loading && !showAsList && view === 'week' && (
        <WeekView
          days={daysShown}
          jobsByDate={jobsByDate}
          getJobColor={getJobColor}
          onSelectJob={(job) => router.push(`/jobs/${job.id}`)}
          onSelectSlot={(date) => canSchedule && setQuickDate(date)}
        />
      )}

      {/* Month view */}
      {!loading && !showAsList && view === 'month' && (
        <MonthView
          days={daysShown}
          monthDate={cursor}
          jobsByDate={jobsByDate}
          getJobColor={getJobColor}
          onSelectJob={(job) => router.push(`/jobs/${job.id}`)}
          onSelectSlot={(date) => canSchedule && setQuickDate(date)}
        />
      )}

      {/* Quick-create dialog */}
      <Dialog open={!!quickDate} onOpenChange={(open) => !open && setQuickDate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule a Job</DialogTitle>
            <DialogDescription>
              {quickDate?.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Open the new job form pre-filled with this date and time.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setQuickDate(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!quickDate) return
                  const params = new URLSearchParams({
                    scheduled_date: ymd(quickDate),
                    scheduled_hour: String(quickDate.getHours()),
                  })
                  router.push(`/jobs/new?${params.toString()}`)
                }}
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                Create Job
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============================================================
// MobileListView — collapses to a list grouped by day
// ============================================================
function MobileListView({
  jobs,
  getJobColor,
  onSelect,
}: {
  jobs: ScheduleJob[]
  getJobColor: (job: ScheduleJob) => string
  onSelect: (job: ScheduleJob) => void
}) {
  if (jobs.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-10">
          <Calendar className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">No jobs in this range.</p>
        </CardContent>
      </Card>
    )
  }

  // Group jobs by service_date
  const groups = new Map<string, ScheduleJob[]>()
  for (const j of jobs) {
    const key = j.service_date
    const arr = groups.get(key) || []
    arr.push(j)
    groups.set(key, arr)
  }
  const sortedKeys = Array.from(groups.keys()).sort()

  return (
    <div className="space-y-4">
      {sortedKeys.map((key) => {
        const dateLabel = new Date(key).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        })
        return (
          <div key={key}>
            <h2 className="text-sm font-semibold mb-2 sticky top-0 bg-zinc-50 py-1">
              {dateLabel}
            </h2>
            <div className="space-y-2">
              {(groups.get(key) || []).map((job) => (
                <Card
                  key={job.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => onSelect(job)}
                >
                  <CardContent className="py-3">
                    <div
                      className="border-l-4 pl-3"
                      style={{ borderColor: getJobColor(job) }}
                    >
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                        <Clock className="h-3 w-3" />
                        {formatTime(job.scheduled_time)}
                      </div>
                      <p className="text-sm font-medium">
                        {job.clients?.company_name || 'Unknown Client'}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <MapPin className="h-3 w-3" />
                        {job.sites?.address || job.sites?.name || ''}
                      </p>
                      {(job.assigned_user || job.crew) && (
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          {job.crew ? (
                            <>
                              <UsersIcon className="h-3 w-3" />
                              {job.crew.name}
                            </>
                          ) : (
                            <>
                              <UserIcon className="h-3 w-3" />
                              {job.assigned_user?.full_name}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ============================================================
// DayView — hourly timeline 7am-8pm
// ============================================================
function DayView({
  date,
  jobs,
  getJobColor,
  onSelectJob,
  onSelectSlot,
}: {
  date: Date
  jobs: ScheduleJob[]
  getJobColor: (job: ScheduleJob) => string
  onSelectJob: (job: ScheduleJob) => void
  onSelectSlot: (date: Date) => void
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y">
          {HOURS.map((hour) => {
            const slotJobs = jobs.filter((j) => {
              if (!j.scheduled_time) return hour === HOURS[0] // unscheduled at top
              const h = new Date(j.scheduled_time).getHours()
              return h === hour
            })
            const slotDate = new Date(date)
            slotDate.setHours(hour, 0, 0, 0)
            return (
              <div key={hour} className="grid grid-cols-[80px_1fr] min-h-[64px]">
                <div className="bg-zinc-50 px-3 py-2 text-xs text-muted-foreground border-r">
                  {hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}
                </div>
                <div
                  className="p-2 hover:bg-zinc-50 cursor-pointer transition-colors"
                  onClick={(e) => {
                    if (e.target === e.currentTarget) onSelectSlot(slotDate)
                  }}
                >
                  {slotJobs.map((job) => (
                    <div
                      key={job.id}
                      className="rounded-md p-2 text-xs cursor-pointer hover:opacity-90 transition-opacity mb-1"
                      style={{
                        backgroundColor: getJobColor(job) + '20',
                        borderLeft: `3px solid ${getJobColor(job)}`,
                      }}
                      onClick={() => onSelectJob(job)}
                    >
                      <div className="font-medium">{job.clients?.company_name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {formatTime(job.scheduled_time)} · {job.sites?.address}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// WeekView — 7 columns
// ============================================================
function WeekView({
  days,
  jobsByDate,
  getJobColor,
  onSelectJob,
  onSelectSlot,
}: {
  days: Date[]
  jobsByDate: Map<string, ScheduleJob[]>
  getJobColor: (job: ScheduleJob) => string
  onSelectJob: (job: ScheduleJob) => void
  onSelectSlot: (date: Date) => void
}) {
  const today = startOfDay(new Date())
  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <div className="grid grid-cols-7 min-w-[700px]">
          {days.map((day) => {
            const isToday = sameDay(day, today)
            const dayJobs = jobsByDate.get(ymd(day)) || []
            return (
              <div key={ymd(day)} className="border-r last:border-r-0">
                <div
                  className={`px-2 py-2 text-center border-b ${
                    isToday ? 'bg-zinc-900 text-white' : 'bg-zinc-50'
                  }`}
                >
                  <div className="text-[10px] uppercase tracking-wider opacity-70">
                    {DAY_NAMES[day.getDay()]}
                  </div>
                  <div className="text-sm font-semibold">{day.getDate()}</div>
                </div>
                <div
                  className="min-h-[400px] p-1 space-y-1 cursor-pointer hover:bg-zinc-50/50 transition-colors"
                  onClick={(e) => {
                    if (e.target === e.currentTarget) {
                      const slot = new Date(day)
                      slot.setHours(9, 0, 0, 0)
                      onSelectSlot(slot)
                    }
                  }}
                >
                  {dayJobs.map((job) => (
                    <div
                      key={job.id}
                      className="rounded p-1.5 text-[10px] cursor-pointer hover:opacity-90 transition-opacity"
                      style={{
                        backgroundColor: getJobColor(job) + '20',
                        borderLeft: `3px solid ${getJobColor(job)}`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelectJob(job)
                      }}
                    >
                      {job.scheduled_time && (
                        <div className="font-semibold mb-0.5">
                          {formatTime(job.scheduled_time)}
                        </div>
                      )}
                      <div className="font-medium truncate">
                        {job.clients?.company_name}
                      </div>
                      <div className="text-muted-foreground truncate">
                        {job.sites?.address || job.sites?.name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// MonthView — standard grid
// ============================================================
function MonthView({
  days,
  monthDate,
  jobsByDate,
  getJobColor,
  onSelectJob,
  onSelectSlot,
}: {
  days: Date[]
  monthDate: Date
  jobsByDate: Map<string, ScheduleJob[]>
  getJobColor: (job: ScheduleJob) => string
  onSelectJob: (job: ScheduleJob) => void
  onSelectSlot: (date: Date) => void
}) {
  const today = startOfDay(new Date())
  const targetMonth = monthDate.getMonth()

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <div className="grid grid-cols-7 min-w-[700px]">
          {DAY_NAMES.map((d) => (
            <div
              key={d}
              className="px-2 py-2 text-center text-[10px] uppercase tracking-wider text-muted-foreground bg-zinc-50 border-b"
            >
              {d}
            </div>
          ))}
          {days.map((day) => {
            const isToday = sameDay(day, today)
            const inMonth = day.getMonth() === targetMonth
            const dayJobs = jobsByDate.get(ymd(day)) || []
            const visible = dayJobs.slice(0, 3)
            const overflow = dayJobs.length - visible.length

            return (
              <div
                key={ymd(day)}
                className={`border-r border-b last:border-r-0 min-h-[100px] p-1 cursor-pointer hover:bg-zinc-50/50 transition-colors ${
                  inMonth ? '' : 'bg-zinc-50/50 opacity-60'
                }`}
                onClick={(e) => {
                  if (e.target === e.currentTarget) {
                    const slot = new Date(day)
                    slot.setHours(9, 0, 0, 0)
                    onSelectSlot(slot)
                  }
                }}
              >
                <div
                  className={`text-xs font-medium mb-1 ${
                    isToday
                      ? 'inline-flex items-center justify-center h-5 w-5 rounded-full bg-zinc-900 text-white'
                      : ''
                  }`}
                >
                  {day.getDate()}
                </div>
                <div className="space-y-0.5">
                  {visible.map((job) => (
                    <div
                      key={job.id}
                      className="rounded px-1.5 py-0.5 text-[10px] cursor-pointer hover:opacity-90 transition-opacity truncate"
                      style={{
                        backgroundColor: getJobColor(job) + '20',
                        borderLeft: `2px solid ${getJobColor(job)}`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelectJob(job)
                      }}
                      title={`${job.clients?.company_name} — ${job.sites?.address || ''}`}
                    >
                      {job.scheduled_time && (
                        <span className="font-semibold mr-1">
                          {formatTime(job.scheduled_time)}
                        </span>
                      )}
                      {job.clients?.company_name}
                    </div>
                  ))}
                  {overflow > 0 && (
                    <div className="text-[10px] text-muted-foreground px-1.5">
                      +{overflow} more
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
