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
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { PhotoUpload } from '@/components/jobs/photo-upload'
import { toast } from 'sonner'
import { ArrowLeft, Send, Loader2, Search, X, Plus, Wrench, Clock } from 'lucide-react'
import type { Client, Site, JobPriority, ServiceCatalogItem, User } from '@/types/database'

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

  // Pre-fill from query params (e.g. when coming from the calendar empty-slot click)
  const prefilledDate = searchParams.get('scheduled_date') || ''
  const prefilledHour = searchParams.get('scheduled_hour') || ''

  // Form state
  const [clientId, setClientId] = useState('')
  const [siteId, setSiteId] = useState('')
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
  const [clients, setClients] = useState<Client[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [services, setServices] = useState<ServiceCatalogItem[]>([])
  const [loadingClients, setLoadingClients] = useState(true)
  const [loadingSites, setLoadingSites] = useState(false)

  // Service selection
  const [selectedServices, setSelectedServices] = useState<SelectedService[]>([])
  const [serviceSearch, setServiceSearch] = useState('')
  const [showServiceDropdown, setShowServiceDropdown] = useState(false)
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [customService, setCustomService] = useState({ name: '', price: '' })

  // Load clients and services on mount
  useEffect(() => {
    if (!organization) return

    async function loadData() {
      setLoadingClients(true)
      const [clientsRes, servicesRes] = await Promise.all([
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
      ])

      if (clientsRes.error) {
        console.error('Failed to load clients:', clientsRes.error.message)
        toast.error('Failed to load clients')
      } else {
        setClients(clientsRes.data || [])
      }

      setServices(servicesRes.data || [])
      setLoadingClients(false)
    }

    loadData()
  }, [organization])

  // Load users + crews if the current user can schedule
  useEffect(() => {
    if (!organization || !canSchedule) return

    async function loadSchedulingOptions() {
      const [usersRes, crewsRes] = await Promise.all([
        supabase
          .from('users')
          .select('*')
          .eq('organization_id', organization!.id)
          .eq('is_active', true)
          .neq('role', 'client')
          .order('full_name'),
        fetch('/api/crews').then((r) => r.json()).catch(() => ({ crews: [] })),
      ])
      setUsers(usersRes.data || [])
      setCrews((crewsRes.crews || []).filter((c: CrewLite) => c.is_active !== false))
    }
    loadSchedulingOptions()
  }, [organization, canSchedule])

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
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Job</h1>
          <p className="text-muted-foreground text-sm">
            Submit a new field service job with photos and notes.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Client & Site Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Location</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="client">Client *</Label>
              <select
                id="client"
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value)
                  setSiteId('')
                }}
                disabled={loadingClients}
                required
                className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">
                  {loadingClients ? 'Loading clients...' : 'Select a client'}
                </option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name}
                  </option>
                ))}
              </select>
              {clients.length === 0 && !loadingClients && (
                <p className="text-xs text-amber-600">
                  No clients found. Ask your office manager to add clients first.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="site">Site *</Label>
              <select
                id="site"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                disabled={!clientId || loadingSites}
                required
                className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
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
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Wrench className="h-4 w-4" /> Services Performed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Selected services */}
            {selectedServices.length > 0 && (
              <div className="space-y-2">
                {selectedServices.map((svc) => (
                  <div
                    key={svc.id}
                    className="flex items-center justify-between border rounded-lg px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{svc.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {svc.isCustom ? 'Custom' : svc.code} · {formatCurrency(svc.unit_price)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Input
                        type="number"
                        min="1"
                        value={svc.quantity}
                        onChange={(e) => updateQuantity(svc.id, parseInt(e.target.value) || 1)}
                        className="w-16 h-8 text-center text-sm"
                      />
                      <span className="text-sm font-medium w-20 text-right">
                        {formatCurrency(svc.unit_price * svc.quantity)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeService(svc.id)}
                        className="text-muted-foreground hover:text-red-500 transition-colors"
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
                className="pl-9 h-9"
              />
              {showServiceDropdown && filteredServices.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-50 max-h-48 overflow-auto">
                  {filteredServices.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => addService(s)}
                      className="w-full text-left px-3 py-2 hover:bg-zinc-50 transition-colors"
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
              <div className="border rounded-lg p-3 space-y-3 bg-zinc-50">
                <p className="text-sm font-medium">Custom Service</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Service Name</Label>
                    <Input
                      value={customService.name}
                      onChange={(e) => setCustomService({ ...customService, name: e.target.value })}
                      placeholder="e.g. Emergency call-out"
                      className="h-8 text-sm"
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
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={addCustomService}>
                    Add
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowCustomForm(false)
                      setCustomService({ name: '', price: '' })
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowCustomForm(true)}
              >
                <Plus className="mr-2 h-3 w-3" />
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
          <CardHeader>
            <CardTitle className="text-base">Service Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="service-date">Service Date *</Label>
                <Input
                  id="service-date"
                  type="date"
                  value={serviceDate}
                  onChange={(e) => setServiceDate(e.target.value)}
                  required
                  className="h-9"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <select
                  id="priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as JobPriority)}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" /> Schedule (Optional)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
                    className="h-9"
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
                    className="h-9"
                    disabled={!scheduledTime}
                  />
                </div>
              </div>

              {scheduledTime && (
                <div className="space-y-2">
                  <Label>Assign To</Label>
                  <div className="flex gap-2 mb-2">
                    {(['none', 'tech', 'crew'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setAssigneeKind(k)}
                        className={`flex-1 px-3 py-1.5 text-xs rounded-md border capitalize ${
                          assigneeKind === k
                            ? 'bg-zinc-900 text-white border-zinc-900'
                            : 'bg-white border-zinc-200 hover:bg-zinc-50'
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
                      className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
                      className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
          <CardHeader>
            <CardTitle className="text-base">Photos</CardTitle>
          </CardHeader>
          <CardContent>
            <PhotoUpload
              photos={photos}
              onPhotosChange={setPhotos}
              maxPhotos={20}
              maxSizeMB={10}
            />
          </CardContent>
        </Card>

        {/* Tech Notes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Technician Notes</CardTitle>
          </CardHeader>
          <CardContent>
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
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
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
