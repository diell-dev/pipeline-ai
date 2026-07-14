'use client'

/**
 * New Job Submission Page
 *
 * Core flow for Field Technicians:
 * 1. Pick a client (dropdown)
 * 2. Pick a site (filtered by selected client)
 * 3. Choose service(s) from searchable dropdown + Custom option
 * 4. Choose service date + priority
 * 5. Upload photos
 * 6. Type tech notes
 * 7. Submit → status becomes "submitted" → AI auto-generates report + invoice
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { DictateJobCard, DictateFieldButton, type DictationResult } from '@/components/dictation/dictate-button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { PhotoUpload } from '@/components/jobs/photo-upload'
import { ClientCombobox } from '@/components/clients/client-combobox'
import { toast } from 'sonner'
import { ArrowLeft, Send, Loader2, Search, X, Plus, Wrench, Clock } from 'lucide-react'
import type { Site, JobPriority, ServiceCatalogItem, User } from '@/types/database'

interface CrewLite {
  id: string
  name: string
  color: string
  is_active?: boolean
}

interface SelectedService {
  id: string // catalog id or 'custom-{index}'
  name: string
  code: string
  unit_price: number
  quantity: number
  isCustom: boolean
}

export default function NewJobPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, organization } = useAuthStore()
  const supabase = createClient()

  // Permission check
  const canCreate = user?.role ? hasPermission(user.role, 'jobs:create') : false
  const canSchedule = user?.role ? hasPermission(user.role, 'jobs:schedule') : false
  const isSuperAdmin = user?.role === 'super_admin'

  // Pre-fill from query params (e.g. when coming from the calendar empty-slot click)
  const prefilledDate = searchParams.get('scheduled_date') || ''
  const prefilledHour = searchParams.get('scheduled_hour') || ''

  // Form state
  const [clientId, setClientId] = useState('')
  const [siteId, setSiteId] = useState('')
  // Site matched by dictation — selected once the client's sites finish loading
  const pendingSiteIdRef = useRef<string | null>(null)
  const [serviceDate, setServiceDate] = useState(
    prefilledDate || new Date().toISOString().split('T')[0]
  )
  const [priority, setPriority] = useState<JobPriority>('normal')
  const [techNotes, setTechNotes] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Scheduling fields (managers can schedule on creation)
  const [scheduledTime, setScheduledTime] = useState<string>(
    prefilledHour ? `${prefilledHour.padStart(2, '0')}:00` : ''
  )
  const [estimatedDuration, setEstimatedDuration] = useState<number>(60)
  const [assigneeKind, setAssigneeKind] = useState<'tech' | 'crew' | 'none'>('none')
  const [assignedTo, setAssignedTo] = useState<string>('')
  const [crewId, setCrewId] = useState<string>('')
  const [users, setUsers] = useState<User[]>([])
  const [crews, setCrews] = useState<CrewLite[]>([])

  // Data lists
  const [sites, setSites] = useState<Site[]>([])
  const [services, setServices] = useState<ServiceCatalogItem[]>([])
  const [loadingSites, setLoadingSites] = useState(false)

  // Service selection
  const [selectedServices, setSelectedServices] = useState<SelectedService[]>([])
  const [serviceSearch, setServiceSearch] = useState('')
  const [showServiceDropdown, setShowServiceDropdown] = useState(false)
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [customService, setCustomService] = useState({ name: '', price: '' })

  // Load services on mount (clients are loaded inside ClientCombobox)
  useEffect(() => {
    if (!organization) return

    async function loadData() {
      let q = supabase
        .from('service_catalog')
        .select('*')
        .eq('is_active', true)
        .order('name')
      if (!isSuperAdmin) q = q.eq('organization_id', organization!.id)
      const { data } = await q

      setServices(data || [])
    }

    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization, isSuperAdmin])

  // Load users + crews if the current user can schedule
  useEffect(() => {
    if (!organization || !canSchedule) return

    async function loadSchedulingOptions() {
      let usersQ = supabase
        .from('users')
        .select('*')
        .eq('is_active', true)
        .neq('role', 'client')
        .order('full_name')
      if (!isSuperAdmin) usersQ = usersQ.eq('organization_id', organization!.id)
      const [usersRes, crewsRes] = await Promise.all([
        usersQ,
        fetch('/api/crews').then((r) => r.json()).catch(() => ({ crews: [] })),
      ])
      setUsers(usersRes.data || [])
      setCrews((crewsRes.crews || []).filter((c: CrewLite) => c.is_active !== false))
    }
    loadSchedulingOptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization, canSchedule, isSuperAdmin])

  // Load sites when client changes
  useEffect(() => {
    if (!clientId) {
      setSites([])
      setSiteId('')
      return
    }

    async function loadSites() {
      setLoadingSites(true)
      const { data, error } = await supabase
        .from('sites')
        .select('*')
        .eq('client_id', clientId)
        .is('deleted_at', null)
        .order('name')

      if (error) {
        console.error('Failed to load sites:', error.message)
        toast.error('Failed to load sites')
      } else {
        setSites(data || [])
        const pending = pendingSiteIdRef.current
        if (pending && (data || []).some((s) => s.id === pending)) {
          setSiteId(pending)
        }
        pendingSiteIdRef.current = null
      }
      setLoadingSites(false)
    }

    loadSites()
  }, [clientId])

  // Filtered services for dropdown
  const filteredServices = useMemo(() => {
    const selected = new Set(selectedServices.filter((s) => !s.isCustom).map((s) => s.id))
    let list = services.filter((s) => !selected.has(s.id))
    if (serviceSearch.trim()) {
      const q = serviceSearch.toLowerCase()
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.code.toLowerCase().includes(q) ||
          (s.description && s.description.toLowerCase().includes(q))
      )
    }
    return list
  }, [services, serviceSearch, selectedServices])

  function addService(svc: ServiceCatalogItem) {
    setSelectedServices((prev) => [
      ...prev,
      {
        id: svc.id,
        name: svc.name,
        code: svc.code,
        unit_price: svc.default_price,
        quantity: 1,
        isCustom: false,
      },
    ])
    setServiceSearch('')
    setShowServiceDropdown(false)
  }

  function applyDictation(result: DictationResult) {
    // Select client/building if the tech named them — never override a manual pick
    if (result.clientId) {
      if (!clientId) {
        pendingSiteIdRef.current = result.siteId
        setClientId(result.clientId)
      } else if (clientId === result.clientId && result.siteId && !siteId) {
        setSiteId(result.siteId)
      }
    }
    // Append notes — never overwrite what the tech already typed
    if (result.techNotes) {
      setTechNotes((prev) => (prev ? `${prev}\n\n${result.techNotes}` : result.techNotes))
    }
    if (result.priority) setPriority(result.priority)
    // Add suggested services that aren't already on the job
    for (const s of result.services) {
      const svc = services.find((c) => c.id === s.id)
      if (!svc) continue
      setSelectedServices((prev) =>
        prev.some((existing) => existing.id === svc.id)
          ? prev
          : [
              ...prev,
              {
                id: svc.id,
                name: svc.name,
                code: svc.code,
                unit_price: svc.default_price,
                quantity: s.quantity,
                isCustom: false,
              },
            ]
      )
    }
  }

  function addCustomService() {
    if (!customService.name.trim() || !customService.price) {
      toast.error('Please enter both service name and price')
      return
    }
    const price = parseFloat(customService.price)
    if (isNaN(price) || price < 0) {
      toast.error('Please enter a valid price')
      return
    }

    setSelectedServices((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        name: customService.name.trim(),
        code: 'CUSTOM',
        unit_price: price,
        quantity: 1,
        isCustom: true,
      },
    ])
    setCustomService({ name: '', price: '' })
    setShowCustomForm(false)
  }

  function removeService(id: string) {
    setSelectedServices((prev) => prev.filter((s) => s.id !== id))
  }

  function updateQuantity(id: string, qty: number) {
    if (qty < 1) return
    setSelectedServices((prev) =>
      prev.map((s) => (s.id === id ? { ...s, quantity: qty } : s))
    )
  }

  // Upload photos to Supabase Storage
  const uploadPhotos = useCallback(
    async (jobId: string): Promise<string[]> => {
      const urls: string[] = []

      for (const photo of photos) {
        const ext = photo.name.split('.').pop() || 'jpg'
        const path = `${organization!.id}/jobs/${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

        const { error } = await supabase.storage
          .from('job-photos')
          .upload(path, photo, {
            cacheControl: '3600',
            upsert: false,
          })

        if (error) {
          console.error('Photo upload failed:', error.message)
          toast.error(`Failed to upload ${photo.name}`)
          continue
        }

        const { data: urlData } = supabase.storage
          .from('job-photos')
          .getPublicUrl(path)

        urls.push(urlData.publicUrl)
      }

      return urls
    },
    [photos, organization, supabase]
  )

  // Submit job
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!canCreate) {
      toast.error('You do not have permission to create jobs')
      return
    }
    if (!clientId) {
      toast.error('Please select a client')
      return
    }
    if (!siteId) {
      toast.error('Please select a site')
      return
    }
    if (!serviceDate) {
      toast.error('Please set a service date')
      return
    }

    setIsSubmitting(true)

    // Determine if this should be scheduled vs. submitted-now
    const isScheduling = canSchedule && !!scheduledTime

    try {
      // Build the insert payload, including scheduling fields if relevant
      const insertPayload: Record<string, unknown> = {
        organization_id: organization!.id,
        client_id: clientId,
        site_id: siteId,
        submitted_by: user!.id,
        status: isScheduling ? 'scheduled' : 'submitted',
        priority,
        service_date: serviceDate,
        tech_notes: techNotes || null,
        photos: [],
      }

      if (isScheduling) {
        // Combine date + time into ISO timestamp (local time)
        const [hh, mm] = scheduledTime.split(':')
        const startDate = new Date(serviceDate + 'T00:00:00')
        startDate.setHours(parseInt(hh), parseInt(mm), 0, 0)
        const endDate = new Date(startDate.getTime() + estimatedDuration * 60_000)

        insertPayload.scheduled_time = startDate.toISOString()
        insertPayload.scheduled_end_time = endDate.toISOString()
        insertPayload.estimated_duration_minutes = estimatedDuration
        insertPayload.scheduled_by = user!.id

        if (assigneeKind === 'tech' && assignedTo) {
          insertPayload.assigned_to = assignedTo
        } else if (assigneeKind === 'crew' && crewId) {
          insertPayload.crew_id = crewId
        }
      }

      // 1. Create the job record
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert(insertPayload)
        .select()
        .single()

      if (jobError) throw jobError

      // 2. Insert selected services as line items
      if (selectedServices.length > 0) {
        const lineItems = selectedServices.map((svc) => ({
          job_id: job.id,
          service_catalog_id: svc.isCustom ? null : svc.id,
          description: svc.isCustom ? svc.name : null,
          quantity: svc.quantity,
          unit_price: svc.unit_price,
          total_price: svc.unit_price * svc.quantity,
          notes: svc.isCustom ? `Custom service: ${svc.name}` : null,
        }))

        const { error: lineError } = await supabase
          .from('job_line_items')
          .insert(lineItems)

        if (lineError) {
          console.error('Failed to insert line items:', lineError.message)
        }
      }

      // 3. Upload photos
      let photoUrls: string[] = []
      if (photos.length > 0) {
        photoUrls = await uploadPhotos(job.id)
        if (photoUrls.length > 0) {
          await supabase
            .from('jobs')
            .update({ photos: photoUrls })
            .eq('id', job.id)
        }
      }

      // 4. Log activity — job created and submitted
      await supabase.from('activity_log').insert({
        organization_id: organization!.id,
        user_id: user!.id,
        action: 'job_created',
        entity_type: 'job',
        entity_id: job.id,
        metadata: {
          client_id: clientId,
          site_id: siteId,
          photo_count: photoUrls.length,
          services_count: selectedServices.length,
        },
      })

      if (isScheduling) {
        toast.success('Job scheduled successfully')
        router.push('/schedule')
      } else {
        toast.success('Job submitted! AI is generating report & invoice...')

        // 5. Trigger AI report + invoice generation (fire-and-forget) — only for submitted jobs
        fetch(`/api/jobs/${job.id}/generate`, { method: 'POST' })
          .then((res) => {
            if (!res.ok) console.error('AI generation request failed')
          })
          .catch((err) => console.error('AI generation trigger error:', err))

        router.push('/jobs')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error('Job submission failed:', message)
      toast.error('Failed to submit job. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Guard: no permission
  if (!canCreate) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <h3 className="text-lg font-semibold mb-1">Access Denied</h3>
            <p className="text-sm text-muted-foreground">
              You don&apos;t have permission to create jobs.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">New Job</h1>
          <p className="text-muted-foreground text-sm">
            Submit a new field service job with photos and notes.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Client & Site Selection */}
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base">Location</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4 sm:p-6 pt-0 sm:pt-0">
            <div className="space-y-2">
              <Label htmlFor="client">Client *</Label>
              <ClientCombobox
                id="client"
                value={clientId}
                onChange={(newId) => {
                  setClientId(newId)
                  setSiteId('')
                }}
                placeholder="Select or add a client"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="site">Site *</Label>
              <select
                id="site"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                disabled={!clientId || loadingSites}
                required
                className="flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">
                  {!clientId
                    ? 'Select a client first'
                    : loadingSites
                    ? 'Loading sites...'
                    : 'Select a site'}
                </option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.address}
                  </option>
                ))}
              </select>
              {clientId && sites.length === 0 && !loadingSites && (
                <p className="text-xs text-amber-600">
                  No sites found for this client. Ask your office manager to add sites.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Service Selection */}
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base flex items-center gap-2">
              <Wrench className="h-4 w-4" /> Services Performed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4 sm:p-6 pt-0 sm:pt-0">
            {/* Selected services — card list (mobile-friendly) */}
            {selectedServices.length > 0 && (
              <div className="space-y-2">
                {selectedServices.map((svc) => (
                  <div
                    key={svc.id}
                    className="border rounded-lg p-3 space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between sm:gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2 sm:block">
                        <div className="min-w-0">
                          <p className="text-sm font-medium break-words">{svc.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {svc.isCustom ? 'Custom' : svc.code} · {formatCurrency(svc.unit_price)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeService(svc.id)}
                          className="sm:hidden text-muted-foreground hover:text-red-500 transition-colors p-1 -m-1 shrink-0"
                          aria-label="Remove service"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 sm:justify-end sm:shrink-0">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground sm:hidden">Qty</Label>
                        <Input
                          type="number"
                          min="1"
                          value={svc.quantity}
                          onChange={(e) => updateQuantity(svc.id, parseInt(e.target.value) || 1)}
                          className="w-16 h-10 sm:h-9 text-center text-sm"
                        />
                      </div>
                      <span className="text-sm font-medium w-24 sm:w-20 text-right">
                        {formatCurrency(svc.unit_price * svc.quantity)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeService(svc.id)}
                        className="hidden sm:inline-flex text-muted-foreground hover:text-red-500 transition-colors"
                        aria-label="Remove service"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Service search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search services..."
                value={serviceSearch}
                onChange={(e) => {
                  setServiceSearch(e.target.value)
                  setShowServiceDropdown(true)
                }}
                onFocus={() => setShowServiceDropdown(true)}
                onBlur={() => setTimeout(() => setShowServiceDropdown(false), 200)}
                className="pl-9 h-10"
              />
              {showServiceDropdown && filteredServices.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 max-h-60 overflow-auto">
                  {filteredServices.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => addService(s)}
                      className="w-full text-left px-3 py-2.5 hover:bg-muted transition-colors min-h-[44px]"
                    >
                      <span className="text-sm font-medium">{s.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {s.code} · {formatCurrency(s.default_price)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Custom service */}
            {showCustomForm ? (
              <div className="border rounded-lg p-3 space-y-3 bg-muted/50">
                <p className="text-sm font-medium">Custom Service</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Service Name</Label>
                    <Input
                      value={customService.name}
                      onChange={(e) => setCustomService({ ...customService, name: e.target.value })}
                      placeholder="e.g. Emergency call-out"
                      className="h-10 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Price ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={customService.price}
                      onChange={(e) => setCustomService({ ...customService, price: e.target.value })}
                      placeholder="0.00"
                      className="h-10 text-sm"
                    />
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button type="button" onClick={addCustomService} className="w-full sm:w-auto h-10">
                    Add
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowCustomForm(false)
                      setCustomService({ name: '', price: '' })
                    }}
                    className="w-full sm:w-auto h-10"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCustomForm(true)}
                className="w-full sm:w-auto h-10"
              >
                <Plus className="mr-2 h-4 w-4" />
                Custom Service
              </Button>
            )}

            <p className="text-xs text-muted-foreground">
              Optional — if no services are selected, the AI will determine services from your tech notes.
            </p>
          </CardContent>
        </Card>

        {/* Service Details */}
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base">Service Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4 sm:p-6 pt-0 sm:pt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="service-date">Service Date *</Label>
                <Input
                  id="service-date"
                  type="date"
                  value={serviceDate}
                  onChange={(e) => setServiceDate(e.target.value)}
                  required
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <select
                  id="priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as JobPriority)}
                  className="flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Scheduling — managers only */}
        {canSchedule && (
          <Card>
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" /> Schedule (Optional)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4 sm:p-6 pt-0 sm:pt-0">
              <p className="text-xs text-muted-foreground">
                Set a time to schedule this job for a future date. Leave blank to submit it immediately for AI processing.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="scheduled-time">Time</Label>
                  <Input
                    id="scheduled-time"
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="h-10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="duration">Estimated Duration (min)</Label>
                  <Input
                    id="duration"
                    type="number"
                    min="15"
                    step="15"
                    value={estimatedDuration}
                    onChange={(e) => setEstimatedDuration(parseInt(e.target.value) || 60)}
                    className="h-10"
                    disabled={!scheduledTime}
                  />
                </div>
              </div>

              {scheduledTime && (
                <div className="space-y-2">
                  <Label>Assign To</Label>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    {(['none', 'tech', 'crew'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setAssigneeKind(k)}
                        className={`px-2 py-2.5 min-h-[44px] text-xs rounded-md border capitalize ${
                          assigneeKind === k
                            ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                            : 'bg-card border-border hover:bg-muted'
                        }`}
                      >
                        {k === 'none' ? 'Unassigned' : k === 'tech' ? 'Individual Tech' : 'Crew'}
                      </button>
                    ))}
                  </div>
                  {assigneeKind === 'tech' && (
                    <select
                      value={assignedTo}
                      onChange={(e) => setAssignedTo(e.target.value)}
                      className="flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <option value="">Select tech</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name}
                        </option>
                      ))}
                    </select>
                  )}
                  {assigneeKind === 'crew' && (
                    <select
                      value={crewId}
                      onChange={(e) => setCrewId(e.target.value)}
                      className="flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <option value="">Select crew</option>
                      {crews.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Photos */}
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base">Photos</CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0">
            <PhotoUpload
              photos={photos}
              onPhotosChange={setPhotos}
              maxPhotos={20}
              maxSizeMB={10}
            />
          </CardContent>
        </Card>

        {/* Voice dictation — speak the whole job, AI fills the form */}
        <DictateJobCard services={services} onApply={applyDictation} />

        {/* Tech Notes */}
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Technician Notes</CardTitle>
              <DictateFieldButton
                onText={(t) => setTechNotes((prev) => (prev ? `${prev}\n${t}` : t))}
              />
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0">
            <Textarea
              id="tech-notes"
              value={techNotes}
              onChange={(e) => setTechNotes(e.target.value)}
              placeholder="Describe the work performed, conditions found, any issues noted..."
              className="min-h-[120px]"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Be detailed — these notes will be used by AI to generate the client report.
            </p>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isSubmitting}
            className="w-full sm:w-auto h-10"
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto h-10">
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {canSchedule && scheduledTime ? 'Scheduling...' : 'Submitting...'}
              </>
            ) : (
              <>
                {canSchedule && scheduledTime ? (
                  <>
                    <Clock className="mr-2 h-4 w-4" />
                    Schedule Job
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Submit Job
                  </>
                )}
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
