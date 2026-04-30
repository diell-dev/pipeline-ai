'use client'

/**
 * Recurring Schedules Page
 *
 * - Lists all recurring patterns with client/site/frequency/next-occurrence/status.
 * - Wizard dialog to create a new recurring pattern.
 * - Pause/resume/end actions.
 */
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  Repeat,
  Loader2,
  Plus,
  Pause,
  Play,
  X,
} from 'lucide-react'
import type { Client, Site, ServiceCatalogItem, User, RecurringFrequency } from '@/types/database'

interface RecurringWithRelations {
  id: string
  client_id: string
  site_id: string
  assigned_to: string | null
  crew_id: string | null
  frequency: RecurringFrequency
  day_of_week: number[]
  day_of_month: number | null
  scheduled_time: string
  estimated_duration_minutes: number
  service_ids: string[]
  advance_creation_days: number
  next_occurrence_date: string
  is_active: boolean
  paused_until: string | null
  notes: string | null
  clients: { company_name: string } | null
  sites: { name: string; address: string } | null
  assigned_user: { full_name: string } | null
  crew: { name: string; color: string } | null
}

interface CrewLite {
  id: string
  name: string
  color: string
}

const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function RecurringPage() {
  const { user, organization } = useAuthStore()
  const canManage = user?.role ? hasPermission(user.role, 'recurring:manage') : false

  const [schedules, setSchedules] = useState<RecurringWithRelations[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [services, setServices] = useState<ServiceCatalogItem[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [crews, setCrews] = useState<CrewLite[]>([])
  const [loading, setLoading] = useState(true)
  const [showWizard, setShowWizard] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [form, setForm] = useState({
    client_id: '',
    site_id: '',
    frequency: 'weekly' as RecurringFrequency,
    day_of_week: [1] as number[],
    day_of_month: 1,
    scheduled_time: '09:00',
    estimated_duration_minutes: 60,
    service_ids: [] as string[],
    assignee_kind: 'tech' as 'tech' | 'crew',
    assigned_to: '',
    crew_id: '',
    next_occurrence_date: new Date().toISOString().slice(0, 10),
    advance_creation_days: 7,
    notes: '',
  })

  const loadSchedules = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/recurring-schedules')
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)
      setSchedules(result.schedules || [])
    } catch (err) {
      console.error('Failed to load:', err)
      toast.error('Failed to load schedules')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!organization) return
    loadSchedules()

    async function loadStaticData() {
      const supabase = createClient()
      const [clientsRes, servicesRes, usersRes, crewsRes] = await Promise.all([
        supabase
          .from('clients')
          .select('*')
          .eq('organization_id', organization!.id)
          .is('deleted_at', null)
          .order('company_name'),
        supabase
          .from('service_catalog')
          .select('*')
          .eq('organization_id', organization!.id)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('users')
          .select('*')
          .eq('organization_id', organization!.id)
          .eq('is_active', true)
          .neq('role', 'client')
          .order('full_name'),
        fetch('/api/crews').then((r) => r.json()),
      ])
      setClients(clientsRes.data || [])
      setServices(servicesRes.data || [])
      setUsers(usersRes.data || [])
      setCrews((crewsRes.crews || []).filter((c: CrewLite & { is_active?: boolean }) => c.is_active !== false))
    }
    loadStaticData()
  }, [organization, loadSchedules])

  // Load sites when form.client_id changes
  useEffect(() => {
    if (!form.client_id) {
      setSites([])
      return
    }
    async function loadSites() {
      const supabase = createClient()
      const { data } = await supabase
        .from('sites')
        .select('*')
        .eq('client_id', form.client_id)
        .is('deleted_at', null)
        .order('name')
      setSites(data || [])
    }
    loadSites()
  }, [form.client_id])

  function openWizard() {
    setForm({
      client_id: '',
      site_id: '',
      frequency: 'weekly',
      day_of_week: [1],
      day_of_month: 1,
      scheduled_time: '09:00',
      estimated_duration_minutes: 60,
      service_ids: [],
      assignee_kind: 'tech',
      assigned_to: '',
      crew_id: '',
      next_occurrence_date: new Date().toISOString().slice(0, 10),
      advance_creation_days: 7,
      notes: '',
    })
    setShowWizard(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.client_id || !form.site_id) {
      toast.error('Client and site are required')
      return
    }

    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        client_id: form.client_id,
        site_id: form.site_id,
        frequency: form.frequency,
        scheduled_time: form.scheduled_time + ':00',
        estimated_duration_minutes: form.estimated_duration_minutes,
        service_ids: form.service_ids,
        next_occurrence_date: form.next_occurrence_date,
        advance_creation_days: form.advance_creation_days,
        notes: form.notes || null,
      }
      if (form.frequency === 'weekly' || form.frequency === 'biweekly') {
        body.day_of_week = form.day_of_week
      } else if (form.frequency === 'monthly') {
        body.day_of_month = form.day_of_month
      }
      if (form.assignee_kind === 'tech' && form.assigned_to) {
        body.assigned_to = form.assigned_to
      } else if (form.assignee_kind === 'crew' && form.crew_id) {
        body.crew_id = form.crew_id
      }

      const res = await fetch('/api/recurring-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed')
      toast.success('Recurring schedule created')
      setShowWizard(false)
      await loadSchedules()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  async function pauseSchedule(s: RecurringWithRelations) {
    const until = prompt('Pause until (YYYY-MM-DD)?', '')
    if (!until) return
    try {
      const res = await fetch(`/api/recurring-schedules/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused_until: until }),
      })
      if (!res.ok) {
        const r = await res.json()
        throw new Error(r.error)
      }
      toast.success('Paused')
      await loadSchedules()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(msg)
    }
  }

  async function resumeSchedule(s: RecurringWithRelations) {
    try {
      const res = await fetch(`/api/recurring-schedules/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused_until: null }),
      })
      if (!res.ok) {
        const r = await res.json()
        throw new Error(r.error)
      }
      toast.success('Resumed')
      await loadSchedules()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(msg)
    }
  }

  async function endSchedule(s: RecurringWithRelations) {
    if (!confirm('End this recurring pattern? Future occurrences will not be created.')) return
    try {
      const res = await fetch(`/api/recurring-schedules/${s.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const r = await res.json()
        throw new Error(r.error)
      }
      toast.success('Ended')
      await loadSchedules()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(msg)
    }
  }

  function describeFrequency(s: RecurringWithRelations): string {
    if (s.frequency === 'daily') return 'Every day'
    if (s.frequency === 'weekly') {
      const days = s.day_of_week.map((d) => DAY_NAMES_SHORT[d]).join(', ')
      return `Weekly on ${days || 'Mon'}`
    }
    if (s.frequency === 'biweekly') {
      const days = s.day_of_week.map((d) => DAY_NAMES_SHORT[d]).join(', ')
      return `Every 2 weeks on ${days || 'Mon'}`
    }
    if (s.frequency === 'monthly') {
      return `Monthly on day ${s.day_of_month || 1}`
    }
    return s.frequency
  }

  function toggleDay(day: number) {
    setForm((prev) => ({
      ...prev,
      day_of_week: prev.day_of_week.includes(day)
        ? prev.day_of_week.filter((d) => d !== day)
        : [...prev.day_of_week, day].sort(),
    }))
  }

  function toggleService(id: string) {
    setForm((prev) => ({
      ...prev,
      service_ids: prev.service_ids.includes(id)
        ? prev.service_ids.filter((s) => s !== id)
        : [...prev.service_ids, id],
    }))
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Recurring Schedules</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Auto-create jobs on a schedule (weekly cleanouts, monthly inspections, etc.).
          </p>
        </div>
        {canManage && (
          <Button onClick={openWizard}>
            <Plus className="mr-2 h-4 w-4" />
            New Recurring Schedule
          </Button>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && schedules.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Repeat className="h-12 w-12 text-muted-foreground/50 mb-3" />
            <h3 className="text-base font-semibold mb-1">No recurring schedules</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Recurring patterns auto-create jobs ahead of time so you never forget a maintenance visit.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && schedules.length > 0 && (
        <div className="space-y-3">
          {schedules.map((s) => {
            const isPaused = s.paused_until && new Date(s.paused_until) > new Date()
            return (
              <Card key={s.id} className={s.is_active ? '' : 'opacity-60'}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-medium text-sm">
                          {s.clients?.company_name || 'Unknown Client'}
                        </span>
                        {!s.is_active && (
                          <Badge variant="outline" className="text-[10px]">Ended</Badge>
                        )}
                        {isPaused && (
                          <Badge className="text-[10px] bg-amber-100 text-amber-700">
                            Paused until {s.paused_until}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mb-1">
                        {s.sites?.name} — {s.sites?.address}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Repeat className="h-3 w-3" />
                          {describeFrequency(s)} at {s.scheduled_time?.slice(0, 5)}
                        </span>
                        <span>Next: {s.next_occurrence_date}</span>
                        {s.crew && (
                          <span>
                            Crew: <span className="font-medium">{s.crew.name}</span>
                          </span>
                        )}
                        {s.assigned_user && !s.crew && (
                          <span>
                            Tech: <span className="font-medium">{s.assigned_user.full_name}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    {canManage && s.is_active && (
                      <div className="flex items-center gap-1 shrink-0">
                        {isPaused ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title="Resume"
                            onClick={() => resumeSchedule(s)}
                          >
                            <Play className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title="Pause"
                            onClick={() => pauseSchedule(s)}
                          >
                            <Pause className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          title="End pattern"
                          onClick={() => endSchedule(s)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Wizard Dialog */}
      <Dialog open={showWizard} onOpenChange={setShowWizard}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Recurring Schedule</DialogTitle>
            <DialogDescription>
              Set up an auto-recurring job. The system will create the actual job a few days before each occurrence.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Client *</Label>
                <select
                  value={form.client_id}
                  onChange={(e) => setForm({ ...form, client_id: e.target.value, site_id: '' })}
                  required
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm"
                >
                  <option value="">Select client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.company_name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label>Site *</Label>
                <select
                  value={form.site_id}
                  onChange={(e) => setForm({ ...form, site_id: e.target.value })}
                  disabled={!form.client_id}
                  required
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm"
                >
                  <option value="">Select site</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Frequency *</Label>
                <select
                  value={form.frequency}
                  onChange={(e) => setForm({ ...form, frequency: e.target.value as RecurringFrequency })}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label>Time *</Label>
                <Input
                  type="time"
                  value={form.scheduled_time}
                  onChange={(e) => setForm({ ...form, scheduled_time: e.target.value })}
                  required
                />
              </div>
            </div>

            {(form.frequency === 'weekly' || form.frequency === 'biweekly') && (
              <div className="space-y-2">
                <Label>Days of Week</Label>
                <div className="flex flex-wrap gap-1">
                  {DAY_NAMES_SHORT.map((name, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => toggleDay(idx)}
                      className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                        form.day_of_week.includes(idx)
                          ? 'bg-zinc-900 text-white border-zinc-900'
                          : 'bg-white border-zinc-200 hover:bg-zinc-50'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {form.frequency === 'monthly' && (
              <div className="space-y-2">
                <Label>Day of Month</Label>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  value={form.day_of_month}
                  onChange={(e) => setForm({ ...form, day_of_month: parseInt(e.target.value) || 1 })}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Duration (min)</Label>
                <Input
                  type="number"
                  min="15"
                  step="15"
                  value={form.estimated_duration_minutes}
                  onChange={(e) =>
                    setForm({ ...form, estimated_duration_minutes: parseInt(e.target.value) || 60 })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Create N days early</Label>
                <Input
                  type="number"
                  min="0"
                  max="30"
                  value={form.advance_creation_days}
                  onChange={(e) =>
                    setForm({ ...form, advance_creation_days: parseInt(e.target.value) || 7 })
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Next Occurrence *</Label>
              <Input
                type="date"
                value={form.next_occurrence_date}
                onChange={(e) => setForm({ ...form, next_occurrence_date: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Assignee</Label>
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, assignee_kind: 'tech' })}
                  className={`flex-1 px-3 py-1.5 text-xs rounded-md border ${
                    form.assignee_kind === 'tech' ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white'
                  }`}
                >
                  Individual Tech
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, assignee_kind: 'crew' })}
                  className={`flex-1 px-3 py-1.5 text-xs rounded-md border ${
                    form.assignee_kind === 'crew' ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white'
                  }`}
                >
                  Crew
                </button>
              </div>
              {form.assignee_kind === 'tech' ? (
                <select
                  value={form.assigned_to}
                  onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm"
                >
                  <option value="">— Unassigned —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name}</option>
                  ))}
                </select>
              ) : (
                <select
                  value={form.crew_id}
                  onChange={(e) => setForm({ ...form, crew_id: e.target.value })}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm"
                >
                  <option value="">— Unassigned —</option>
                  {crews.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-2">
              <Label>Services</Label>
              <div className="border rounded-lg p-2 max-h-32 overflow-y-auto space-y-1">
                {services.length === 0 && (
                  <p className="text-xs text-muted-foreground p-2">No services available</p>
                )}
                {services.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-50 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={form.service_ids.includes(s.id)}
                      onChange={() => toggleService(s.id)}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowWizard(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Schedule
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
