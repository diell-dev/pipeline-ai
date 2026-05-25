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
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
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

  // Group jobs by date string.
  //
  // TODO(timezone): job.service_date is a plain DATE; the calendar's date
  // ranges are computed via `new Date()` in the browser's local TZ. For a
  // user in NYC viewing a job whose scheduled_time UTC falls on a different
  // calendar day, the calendar groups by service_date (which was the
  // browser's local date when created) — usually right, but not always.
  // Same root cause as the TODO in src/app/api/schedule/route.ts.
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
      // UX-SWEEP-#5: previous formatter produced "May 18 – 2026 (day: 24)" in some
      // locales because passing `month: undefined` plus `day` + `year` to
      // toLocaleDateString gives back an awkward fragment. Use explicit pieces
      // so output is always either "May 18 – 24, 2026" (same month) or
      // "May 28 – Jun 3, 2026" (crossing months).
      const start = startOfWeek(cursor)
      const end = addDays(start, 6)
      const sameMonth = start.getMonth() === end.getMonth()
      const startMonth = start.toLocaleDateString('en-US', { month: 'short' })
      const startDay = start.getDate()
      const endDay = end.getDate()
      const endYear = end.getFullYear()
      if (sameMonth) {
        return `${startMonth} ${startDay} – ${endDay}, ${endYear}`
      }
      const endMonth = end.toLocaleDateString('en-US', { month: 'short' })
      return `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${endYear}`
    }
    return cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }, [view, cursor])

  // Mobile view — render as a list grouped by day
  const showAsList = isMobile

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header — stacks on mobile */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Schedule</h1>
        </div>
        {canSchedule && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-10 flex-1 sm:flex-initial"
              onClick={() => router.push('/schedule/recurring')}
            >
              Recurring
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-10 flex-1 sm:flex-initial"
              onClick={() => router.push('/schedule/crews')}
            >
              <UsersIcon className="mr-2 h-3.5 w-3.5" />
              Crews
            </Button>
            <Button
              variant="brand"
              size="sm"
              className="h-10 flex-1 sm:flex-initial"
              onClick={() => router.push('/jobs/new')}
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              New Job
            </Button>
          </div>
        )}
      </div>

      {/* Controls — date nav + view tabs. Mobile forces list view, so view tabs hidden */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="outline" size="icon" className="h-10 w-10 flex-shrink-0" onClick={() => navigate('prev')}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-10 flex-shrink-0" onClick={() => navigate('today')}>
            Today
          </Button>
          <Button variant="outline" size="icon" className="h-10 w-10 flex-shrink-0" onClick={() => navigate('next')}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="ml-1 sm:ml-2 text-sm font-medium truncate">{headerLabel}</div>
        </div>

        {/* View tabs — hidden on mobile (list view is forced there) */}
        <div className="hidden sm:flex items-center gap-1 rounded-lg border bg-white p-1">
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

      {/* Loading — calendar-shaped skeleton */}
      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full rounded-xl" />
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
            <h2 className="text-sm font-semibold mb-2 sticky top-0 bg-zinc-50 py-2 z-10 border-b">
              {dateLabel}
            </h2>
            <div className="space-y-2">
              {(groups.get(key) || []).map((job) => {
                const assigneeChip = job.crew?.name || job.assigned_user?.full_name
                return (
                  <Card
                    key={job.id}
                    className="cursor-pointer hover:shadow-md active:bg-zinc-50 transition-shadow min-h-[60px]"
                    onClick={() => onSelect(job)}
                  >
                    <CardContent className="p-3">
                      <div
                        className="border-l-4 pl-3"
                        style={{ borderColor: getJobColor(job) }}
                      >
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                          <Clock className="h-3 w-3 flex-shrink-0" />
                          <span className="font-medium text-foreground">
                            {formatTime(job.scheduled_time) || 'No time'}
                          </span>
                        </div>
                        <p className="text-sm font-medium break-words">
                          {job.clients?.company_name || 'Unknown Client'}
                        </p>
                        <p className="text-xs text-muted-foreground flex items-start gap-1 mt-0.5">
                          <MapPin className="h-3 w-3 flex-shrink-0 mt-0.5" />
                          <span className="break-words">
                            {job.sites?.address || job.sites?.name || ''}
                          </span>
                        </p>
                        {assigneeChip && (
                          <div
                            className="text-[11px] mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-full max-w-full"
                            style={{
                              backgroundColor: getJobColor(job) + '22',
                              color: getJobColor(job),
                            }}
                          >
                            {job.crew ? (
                              <UsersIcon className="h-3 w-3 flex-shrink-0" />
                            ) : (
                              <UserIcon className="h-3 w-3 flex-shrink-0" />
                            )}
                            <span className="font-medium truncate">{assigneeChip}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
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
// WeekView — real time-axis grid (8 columns: hour gutter + 7 days)
//
// Events are absolutely-positioned in each day column by scheduled_time
// and either scheduled_end_time, estimated_duration_minutes, or a 60-min
// fallback. Overlapping events are laid out side-by-side via a simple
// column-packing algorithm. An all-day strip above the hour grid shows
// jobs with no scheduled_time. A red "now" line tracks the current minute
// when today is in view.
// ============================================================
const WEEK_START_HOUR = 6
const WEEK_END_HOUR = 22 // exclusive upper bound for label loop; grid covers 06:00–22:00
const WEEK_HOUR_HEIGHT = 48 // px — matches Tailwind h-12
const WEEK_GRID_HOURS = WEEK_END_HOUR - WEEK_START_HOUR
const WEEK_GRID_HEIGHT = WEEK_GRID_HOURS * WEEK_HOUR_HEIGHT
const WEEK_FALLBACK_DURATION_MIN = 60

interface PositionedJob {
  job: ScheduleJob
  startMin: number // minutes since midnight (local)
  endMin: number
  startClamped: boolean // event begins before WEEK_START_HOUR
  endClamped: boolean // event ends after WEEK_END_HOUR
  col: number
  nCols: number
}

// Resolve a job's [startMin, endMin] in *local* minutes from midnight.
// Returns null if the job is all-day (no scheduled_time).
function resolveJobMinutes(job: ScheduleJob): { startMin: number; endMin: number } | null {
  if (!job.scheduled_time) return null
  const start = new Date(job.scheduled_time)
  const startMin = start.getHours() * 60 + start.getMinutes()

  let endMin: number
  if (job.scheduled_end_time) {
    const end = new Date(job.scheduled_end_time)
    // Use local minutes since midnight of the *same* day as start. If end is
    // on the following day, clamp to end-of-day (1440) so the event spans
    // the rest of the visible grid rather than wrapping.
    if (sameDay(start, end)) {
      endMin = end.getHours() * 60 + end.getMinutes()
    } else {
      endMin = 24 * 60
    }
  } else if (job.estimated_duration_minutes && job.estimated_duration_minutes > 0) {
    endMin = startMin + job.estimated_duration_minutes
  } else {
    endMin = startMin + WEEK_FALLBACK_DURATION_MIN
  }
  if (endMin <= startMin) endMin = startMin + 15 // guard against degenerate ranges
  return { startMin, endMin }
}

// Column-pack a day's events: for each event, place it in the leftmost
// column whose previous event ends ≤ this event's start. Then sweep groups
// of overlapping events to assign each its column-count `nCols`.
function layoutDayEvents(jobs: ScheduleJob[]): PositionedJob[] {
  const timed: PositionedJob[] = []
  for (const job of jobs) {
    const minutes = resolveJobMinutes(job)
    if (!minutes) continue
    const { startMin, endMin } = minutes
    timed.push({
      job,
      startMin,
      endMin,
      startClamped: startMin < WEEK_START_HOUR * 60,
      endClamped: endMin > WEEK_END_HOUR * 60,
      col: 0,
      nCols: 1,
    })
  }
  timed.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)

  // Assign each event to the leftmost open column.
  const colEnds: number[] = []
  for (const ev of timed) {
    let placed = false
    for (let i = 0; i < colEnds.length; i++) {
      if (colEnds[i] <= ev.startMin) {
        ev.col = i
        colEnds[i] = ev.endMin
        placed = true
        break
      }
    }
    if (!placed) {
      ev.col = colEnds.length
      colEnds.push(ev.endMin)
    }
  }

  // Walk again and tag each event with the width of the cluster it belongs
  // to (max concurrent columns across its lifetime). Cluster = chain of
  // events where each overlaps at least one other.
  let i = 0
  while (i < timed.length) {
    let clusterEnd = timed[i].endMin
    let j = i + 1
    while (j < timed.length && timed[j].startMin < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, timed[j].endMin)
      j++
    }
    let maxCol = 0
    for (let k = i; k < j; k++) maxCol = Math.max(maxCol, timed[k].col)
    const nCols = maxCol + 1
    for (let k = i; k < j; k++) timed[k].nCols = nCols
    i = j
  }
  return timed
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour === 12) return '12 PM'
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`
}

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
  const scrollRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState<Date>(() => new Date())

  // Tick "now" every minute so the red indicator moves.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  // On first mount (and when the visible week changes), scroll the grid so
  // the most useful row is near the top: the current hour if today is in
  // view, otherwise 8 AM.
  const todayInView = days.some((d) => sameDay(d, today))
  const firstDayKey = days[0] ? ymd(days[0]) : ''
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const targetHour = todayInView
      ? Math.max(WEEK_START_HOUR, Math.min(WEEK_END_HOUR - 1, now.getHours()))
      : 8
    const top = Math.max(0, (targetHour - WEEK_START_HOUR) * WEEK_HOUR_HEIGHT - WEEK_HOUR_HEIGHT)
    el.scrollTo({ top, behavior: 'auto' })
    // We intentionally only re-run when the week or "today in view" changes
    // — not every minute when `now` ticks, which would yank the user's scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDayKey, todayInView])

  // Per-day layout: timed events for the grid + all-day events for the strip.
  const perDay = useMemo(() => {
    return days.map((day) => {
      const dayJobs = jobsByDate.get(ymd(day)) || []
      const allDay = dayJobs.filter((j) => !j.scheduled_time)
      const positioned = layoutDayEvents(dayJobs)
      return { day, allDay, positioned }
    })
  }, [days, jobsByDate])

  const allDayRows = Math.max(0, ...perDay.map((d) => d.allDay.length))

  // Now indicator: only shown if today is in this week AND `now` falls
  // inside the visible hour range.
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const showNowLine =
    todayInView && nowMin >= WEEK_START_HOUR * 60 && nowMin <= WEEK_END_HOUR * 60
  const nowTopPx = ((nowMin - WEEK_START_HOUR * 60) / 60) * WEEK_HOUR_HEIGHT

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <div className="min-w-[840px]">
          {/* Day header row: empty time-gutter cell + 7 day headers */}
          <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b bg-zinc-50">
            <div className="border-r" />
            {days.map((day) => {
              const isToday = sameDay(day, today)
              return (
                <div
                  key={ymd(day)}
                  className={`px-2 py-2 text-center border-r last:border-r-0 ${
                    isToday ? 'bg-zinc-900 text-white' : ''
                  }`}
                >
                  <div className="text-[10px] uppercase tracking-wider opacity-70">
                    {DAY_NAMES[day.getDay()]}
                  </div>
                  <div className="text-sm font-semibold">{day.getDate()}</div>
                </div>
              )
            })}
          </div>

          {/* All-day strip — one row per stacked all-day event, only rendered
              if at least one day has any */}
          {allDayRows > 0 && (
            <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b bg-white">
              <div className="border-r px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground flex items-start">
                All-day
              </div>
              {perDay.map(({ day, allDay }) => (
                <div
                  key={ymd(day)}
                  className="border-r last:border-r-0 p-1 space-y-1"
                  style={{ minHeight: allDayRows * 22 }}
                >
                  {allDay.map((job) => (
                    <div
                      key={job.id}
                      className="rounded px-1.5 py-0.5 text-[10px] cursor-pointer hover:opacity-90 transition-opacity truncate"
                      style={{
                        backgroundColor: getJobColor(job) + '20',
                        borderLeft: `3px solid ${getJobColor(job)}`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelectJob(job)
                      }}
                      title={job.clients?.company_name || ''}
                    >
                      <span className="font-medium">
                        {job.clients?.company_name || 'Untitled'}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Hour grid — scrollable region */}
          <div
            ref={scrollRef}
            className="overflow-y-auto"
            style={{ maxHeight: WEEK_GRID_HEIGHT }}
          >
            <div
              className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] relative"
              style={{ height: WEEK_GRID_HEIGHT }}
            >
              {/* Hour gutter */}
              <div className="border-r relative bg-white">
                {Array.from({ length: WEEK_GRID_HOURS }, (_, i) => {
                  const hour = WEEK_START_HOUR + i
                  return (
                    <div
                      key={hour}
                      className="border-b text-[10px] text-muted-foreground px-1 text-right"
                      style={{ height: WEEK_HOUR_HEIGHT }}
                    >
                      <span className="relative -top-1.5 inline-block">
                        {formatHourLabel(hour)}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Day columns */}
              {perDay.map(({ day, positioned }) => {
                const isToday = sameDay(day, today)
                return (
                  <div
                    key={ymd(day)}
                    className={`border-r last:border-r-0 relative ${
                      isToday ? 'bg-blue-50/30' : 'bg-white'
                    }`}
                  >
                    {/* Hour rows — clickable for quick-create */}
                    {Array.from({ length: WEEK_GRID_HOURS }, (_, i) => {
                      const hour = WEEK_START_HOUR + i
                      return (
                        <div
                          key={hour}
                          className="border-b hover:bg-zinc-50 cursor-pointer transition-colors"
                          style={{ height: WEEK_HOUR_HEIGHT }}
                          onClick={(e) => {
                            if (e.target !== e.currentTarget) return
                            const slot = new Date(day)
                            slot.setHours(hour, 0, 0, 0)
                            onSelectSlot(slot)
                          }}
                        />
                      )
                    })}

                    {/* Positioned events */}
                    {positioned.map(
                      ({ job, startMin, endMin, startClamped, endClamped, col, nCols }) => {
                        const visStart = Math.max(startMin, WEEK_START_HOUR * 60)
                        const visEnd = Math.min(endMin, WEEK_END_HOUR * 60)
                        const top = ((visStart - WEEK_START_HOUR * 60) / 60) * WEEK_HOUR_HEIGHT
                        const rawHeight = ((visEnd - visStart) / 60) * WEEK_HOUR_HEIGHT
                        const height = Math.max(24, rawHeight)
                        const widthPct = 100 / nCols
                        const leftPct = (col * 100) / nCols
                        const color = getJobColor(job)
                        return (
                          <button
                            key={job.id}
                            type="button"
                            className="absolute overflow-hidden rounded text-left text-[10px] hover:opacity-90 transition-opacity focus:outline-none focus:ring-1 focus:ring-zinc-900"
                            style={{
                              top,
                              height,
                              left: `calc(${leftPct}% + 1px)`,
                              width: `calc(${widthPct}% - 5px)`,
                              backgroundColor: color + '20',
                              borderLeft: `2px solid ${color}`,
                              // Dashed top/bottom hint for events that extend
                              // beyond the visible hour range.
                              borderTop: startClamped ? `1px dashed ${color}` : undefined,
                              borderBottom: endClamped ? `1px dashed ${color}` : undefined,
                            }}
                            onClick={(e) => {
                              e.stopPropagation()
                              onSelectJob(job)
                            }}
                            title={`${job.clients?.company_name || ''} — ${
                              job.sites?.address || job.sites?.name || ''
                            }`}
                          >
                            <div className="px-1 py-0.5 leading-tight">
                              <div className="font-semibold">
                                {formatTime(job.scheduled_time)}
                              </div>
                              <div className="truncate">
                                {job.clients?.company_name || 'Untitled'}
                              </div>
                            </div>
                          </button>
                        )
                      }
                    )}
                  </div>
                )
              })}

              {/* Now indicator — a thin red line spanning all 7 day columns,
                  starting after the time gutter */}
              {showNowLine && (
                <div
                  className="pointer-events-none absolute left-[56px] right-0 z-10 flex items-center"
                  style={{ top: nowTopPx }}
                >
                  <div className="h-2 w-2 -ml-1 rounded-full bg-red-500" />
                  <div className="h-px flex-1 bg-red-500" />
                </div>
              )}
            </div>
          </div>
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
