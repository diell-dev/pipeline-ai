'use client'

/**
 * ScheduleWorkOrderDialog
 *
 * The "Start Work Order" flow on the equipment detail page. Instead of
 * silently creating a job for today with no one assigned, this asks the
 * right questions:
 *
 *   1. Who should do it?           (tech or crew — optional)
 *   2. When should it happen?      (date + time + duration)
 *   3. How urgent is it?           (priority chips)
 *   4. What's the issue?           (notes for the tech)
 *
 * It also fetches the chosen tech's existing jobs for that date and shows
 * them as a soft availability warning so the dispatcher can avoid
 * double-booking.
 *
 * Wraps POST /api/jobs/[id]/start-from-equipment (the `[id]` is unused — the
 * equipment_id in the body identifies the source).
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Loader2,
  AlertTriangle,
  Calendar as CalIcon,
  User as UserIcon,
  PlayCircle,
} from 'lucide-react'
import { toast } from 'sonner'

interface TechOption {
  id: string
  full_name: string | null
  role: string
}

interface CrewOption {
  id: string
  name: string
  color?: string | null
}

interface ConflictJob {
  id: string
  scheduled_time: string | null
  scheduled_end_time: string | null
  estimated_duration_minutes?: number | null
  service_date: string
  status: string
  clients: { id: string; company_name: string } | null
  sites: { id: string; name: string } | null
}

interface ScheduleWorkOrderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  equipmentId: string
  equipmentLabel: string
  /** Pre-loaded list of technicians; if empty, dialog will fetch its own. */
  techs?: TechOption[]
  crews?: CrewOption[]
}

const PRIORITIES: Array<{
  value: 'low' | 'normal' | 'high' | 'urgent'
  label: string
  bg: string
  ring: string
}> = [
  { value: 'low', label: 'Low', bg: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300', ring: 'ring-zinc-400' },
  {
    value: 'normal',
    label: 'Normal',
    bg: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    ring: 'ring-blue-500',
  },
  {
    value: 'high',
    label: 'High',
    bg: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    ring: 'ring-amber-500',
  },
  {
    value: 'urgent',
    label: 'Urgent',
    bg: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    ring: 'ring-red-600',
  },
]

const DURATION_OPTIONS = [
  { value: '30', label: '30 min' },
  { value: '60', label: '1 hour' },
  { value: '90', label: '1.5 hours' },
  { value: '120', label: '2 hours' },
  { value: '180', label: '3 hours' },
  { value: '240', label: '4 hours' },
  { value: '480', label: 'Full day (8h)' },
]

/** Today as YYYY-MM-DD, in the browser's local TZ. */
function todayLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Combine a YYYY-MM-DD + HH:mm into an ISO timestamp in the user's TZ. */
function combineToIso(date: string, time: string): string | null {
  if (!date) return null
  const t = time || '09:00'
  const d = new Date(`${date}T${t}:00`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function ScheduleWorkOrderDialog({
  open,
  onOpenChange,
  equipmentId,
  equipmentLabel,
  techs: techsProp,
  crews: crewsProp,
}: ScheduleWorkOrderDialogProps) {
  const router = useRouter()

  // ── Tech + crew lists (lazy-loaded if not provided) ─────────
  const [techs, setTechs] = useState<TechOption[]>(techsProp || [])
  const [crews, setCrews] = useState<CrewOption[]>(crewsProp || [])
  const [loadingTechs, setLoadingTechs] = useState(false)

  // ── Form state ──────────────────────────────────────────────
  const [assignmentType, setAssignmentType] = useState<'tech' | 'crew' | 'unassigned'>(
    'unassigned'
  )
  const [techId, setTechId] = useState<string>('')
  const [crewId, setCrewId] = useState<string>('')
  const [date, setDate] = useState<string>(todayLocal())
  const [time, setTime] = useState<string>('09:00')
  const [duration, setDuration] = useState<string>('60')
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal')
  const [notes, setNotes] = useState<string>('')

  const [submitting, setSubmitting] = useState(false)
  const [conflicts, setConflicts] = useState<ConflictJob[] | null>(null)
  const [loadingConflicts, setLoadingConflicts] = useState(false)

  // Reset state when re-opened (so a second open doesn't show stale data)
  useEffect(() => {
    if (!open) return
    setAssignmentType('unassigned')
    setTechId('')
    setCrewId('')
    setDate(todayLocal())
    setTime('09:00')
    setDuration('60')
    setPriority('normal')
    setNotes('')
    setConflicts(null)
  }, [open])

  // Lazy-load techs + crews when the dialog first opens
  useEffect(() => {
    if (!open) return
    if (techsProp && techsProp.length > 0 && crewsProp) return

    let alive = true
    setLoadingTechs(true)
    Promise.all([
      fetch('/api/team').then((r) => (r.ok ? r.json() : { users: [] })).catch(() => ({ users: [] })),
      fetch('/api/crews').then((r) => (r.ok ? r.json() : { crews: [] })).catch(() => ({ crews: [] })),
    ])
      .then(([teamRes, crewsRes]) => {
        if (!alive) return
        const users = (teamRes.users || []) as TechOption[]
        setTechs(users.filter((u) => u.role !== 'client'))
        setCrews((crewsRes.crews || []).filter((c: CrewOption & { is_active?: boolean }) => c.is_active !== false))
      })
      .finally(() => {
        if (alive) setLoadingTechs(false)
      })

    return () => {
      alive = false
    }
  }, [open, techsProp, crewsProp])

  // Whenever the target (tech or crew) + date combination changes, fetch the
  // conflict list. The /api/schedule endpoint accepts assigned_to / crew_id
  // filters so we don't have to filter client-side.
  useEffect(() => {
    if (!open || !date) {
      setConflicts(null)
      return
    }
    const isTech = assignmentType === 'tech' && techId
    const isCrew = assignmentType === 'crew' && crewId
    if (!isTech && !isCrew) {
      setConflicts(null)
      return
    }
    const filter = isTech
      ? `&assigned_to=${encodeURIComponent(techId)}`
      : `&crew_id=${encodeURIComponent(crewId)}`
    let alive = true
    setLoadingConflicts(true)
    fetch(`/api/schedule?from=${date}&to=${date}${filter}`)
      .then((r) => (r.ok ? r.json() : { jobs: [] }))
      .then((j) => {
        if (!alive) return
        setConflicts((j.jobs || []) as ConflictJob[])
      })
      .catch(() => {
        if (alive) setConflicts([])
      })
      .finally(() => {
        if (alive) setLoadingConflicts(false)
      })
    return () => {
      alive = false
    }
  }, [open, assignmentType, techId, crewId, date])

  // ── Derived values ──────────────────────────────────────────
  const scheduledIso = useMemo(() => combineToIso(date, time), [date, time])
  const scheduledEndIso = useMemo(() => {
    if (!scheduledIso) return null
    const mins = Number(duration)
    if (!Number.isFinite(mins) || mins <= 0) return null
    return new Date(new Date(scheduledIso).getTime() + mins * 60_000).toISOString()
  }, [scheduledIso, duration])

  /** Soft-conflict: another job assigned to this target overlaps the chosen window. */
  const conflictWarning = useMemo(() => {
    if (!conflicts || conflicts.length === 0 || !scheduledIso || !scheduledEndIso) return null
    const startMs = +new Date(scheduledIso)
    const endMs = +new Date(scheduledEndIso)
    const overlaps = conflicts.filter((c) => {
      if (!c.scheduled_time) return false
      const cStart = +new Date(c.scheduled_time)
      const cEnd = c.scheduled_end_time
        ? +new Date(c.scheduled_end_time)
        : (c.estimated_duration_minutes
            ? cStart + Number(c.estimated_duration_minutes) * 60_000
            : cStart + 60 * 60_000)
      return cStart < endMs && cEnd > startMs
    })
    return overlaps.length > 0 ? overlaps : null
  }, [conflicts, scheduledIso, scheduledEndIso])

  // ── Submit ──────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!scheduledIso) {
      toast.error('Please choose a date')
      return
    }
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        equipment_id: equipmentId,
        scheduled_time: scheduledIso,
        scheduled_end_time: scheduledEndIso,
        estimated_duration_minutes: Number(duration),
        priority,
      }
      if (assignmentType === 'tech' && techId) payload.assigned_to = techId
      if (assignmentType === 'crew' && crewId) payload.crew_id = crewId
      if (notes.trim()) payload.tech_notes = notes.trim()

      const res = await fetch(`/api/jobs/${equipmentId}/start-from-equipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.job_id) {
        throw new Error(json.error || 'Could not start work order')
      }
      toast.success('Work order scheduled')
      onOpenChange(false)
      router.push(`/jobs/${json.job_id}`)
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'Could not start work order')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      // M2.2 — long form (notes, schedule, services, equipment) benefits
      // from snap points. Peek/sit/full so users can stay at 85% and still
      // see the equipment chip behind them. Desktop ignores.
      snapPoints={[0.4, 0.85, 1]}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayCircle className="h-5 w-5" />
            Schedule work order
          </DialogTitle>
          <DialogDescription className="break-words">
            For <span className="font-medium text-foreground">{equipmentLabel}</span>
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          id="schedule-work-order-form"
          className="contents"
        >
          <DialogBody className="space-y-5">
          {/* Step 1 — Who */}
          <section className="space-y-2">
            <Label className="flex items-center gap-2 text-sm font-semibold">
              <UserIcon className="h-4 w-4" /> Who should do this?
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {(['tech', 'crew', 'unassigned'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setAssignmentType(opt)}
                  className={`rounded-md border px-3 py-2 text-sm capitalize transition ${
                    assignmentType === opt
                      ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/60'
                      : 'border-border hover:bg-muted text-foreground'
                  }`}
                >
                  {opt === 'tech' ? 'A technician' : opt === 'crew' ? 'A crew' : 'Decide later'}
                </button>
              ))}
            </div>

            {assignmentType === 'unassigned' && (
              <p className="text-xs text-muted-foreground mt-1">
                Unassigned work orders land in the dispatcher queue for someone to claim later.
              </p>
            )}

            {assignmentType === 'tech' && (
              <Select value={techId} onValueChange={(v) => setTechId(v || '')}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      loadingTechs
                        ? 'Loading technicians…'
                        : techs.length === 0
                        ? 'No technicians available'
                        : 'Pick a technician'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {techs.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.full_name || 'Unnamed'}
                      <span className="text-xs text-muted-foreground ml-2">
                        ({t.role.replace(/_/g, ' ')})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {assignmentType === 'crew' && (
              <Select value={crewId} onValueChange={(v) => setCrewId(v || '')}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={crews.length === 0 ? 'No crews available' : 'Pick a crew'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {crews.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </section>

          {/* Step 2 — When */}
          <section className="space-y-2">
            <Label className="flex items-center gap-2 text-sm font-semibold">
              <CalIcon className="h-4 w-4" /> When?
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="sched-date" className="text-xs text-muted-foreground">
                  Date
                </Label>
                <Input
                  id="sched-date"
                  type="date"
                  value={date}
                  min={todayLocal()}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="sched-time" className="text-xs text-muted-foreground">
                  Start time
                </Label>
                <Input
                  id="sched-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="sched-duration" className="text-xs text-muted-foreground">
                  Duration
                </Label>
                <Select value={duration} onValueChange={(v) => setDuration(v || '60')}>
                  <SelectTrigger id="sched-duration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* Availability — shown when a tech or crew is selected */}
          {((assignmentType === 'tech' && techId) || (assignmentType === 'crew' && crewId)) && (
            <section className="rounded-md border border-border bg-muted/50 p-3">
              <div className="text-xs font-medium text-foreground mb-2 flex items-center gap-2">
                <CalIcon className="h-3.5 w-3.5" />
                {assignmentType === 'tech' ? "Tech's schedule for " : "Crew's schedule for "}
                {new Date(date + 'T00:00:00').toLocaleDateString()}
                {loadingConflicts && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
              </div>
              {!loadingConflicts && conflicts && conflicts.length === 0 && (
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  No other jobs scheduled for {assignmentType === 'tech' ? 'this technician' : 'this crew'} on this date.
                </p>
              )}
              {!loadingConflicts && conflicts && conflicts.length > 0 && (
                <ul className="space-y-1 text-xs text-foreground">
                  {conflicts.map((c) => {
                    const overlaps = conflictWarning?.some((w) => w.id === c.id)
                    return (
                      <li
                        key={c.id}
                        className={`flex items-center justify-between gap-3 rounded px-2 py-1 ${
                          overlaps ? 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200' : 'bg-card'
                        }`}
                      >
                        <span className="font-medium">
                          {formatTime(c.scheduled_time)} – {formatTime(c.scheduled_end_time)}
                        </span>
                        <span className="text-muted-foreground truncate">
                          {c.clients?.company_name || c.sites?.name || 'Unknown'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
              {conflictWarning && conflictWarning.length > 0 && (
                <div className="mt-2 flex items-start gap-2 text-xs text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    Heads up — the chosen time overlaps {conflictWarning.length} existing job
                    {conflictWarning.length === 1 ? '' : 's'}. You can still proceed.
                  </span>
                </div>
              )}
            </section>
          )}

          {/* Step 3 — Priority */}
          <section className="space-y-2">
            <Label className="text-sm font-semibold">How urgent is it?</Label>
            <div className="flex flex-wrap gap-2">
              {PRIORITIES.map((p) => {
                const active = priority === p.value
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPriority(p.value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      p.bg
                    } ${active ? `ring-2 ${p.ring}` : 'opacity-70 hover:opacity-100'}`}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          </section>

          {/* Step 4 — Notes */}
          <section className="space-y-2">
            <Label htmlFor="sched-notes" className="text-sm font-semibold">
              Anything the tech should know?
            </Label>
            <Textarea
              id="sched-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What's the issue, what to bring, who to ask for on-site…"
            />
          </section>

          {/* Summary chip row */}
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant="outline" className="text-xs">
              {scheduledIso
                ? new Date(scheduledIso).toLocaleString([], {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                : 'No time set'}
            </Badge>
            <Badge variant="outline" className="text-xs">{duration} min</Badge>
            <Badge variant="outline" className="text-xs capitalize">
              {priority}
            </Badge>
            {assignmentType === 'tech' && techId && (
              <Badge variant="outline" className="text-xs">
                {techs.find((t) => t.id === techId)?.full_name || 'Tech'}
              </Badge>
            )}
            {assignmentType === 'crew' && crewId && (
              <Badge variant="outline" className="text-xs">
                {crews.find((c) => c.id === crewId)?.name || 'Crew'}
              </Badge>
            )}
            {assignmentType === 'unassigned' && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Unassigned
              </Badge>
            )}
          </div>
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                submitting ||
                (assignmentType === 'tech' && !techId) ||
                (assignmentType === 'crew' && !crewId) ||
                !scheduledIso
              }
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Schedule work order
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
