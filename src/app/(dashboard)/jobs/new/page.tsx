'use client'

/**
 * New Job Submission Page
 *
 * Core flow for Field Technicians:
 * 1. Pick a client (dropdown)
 * 2. Pick a site (filtered by selected client)
 * 3. Choose service date + priority
 * 4. Upload photos
 * 5. Type tech notes
 * 6. Submit → status becomes "submitted"
 */
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { PhotoUpload } from '@/components/jobs/photo-upload'
import { toast } from 'sonner'
import { ArrowLeft, Send, Loader2 } from 'lucide-react'
import type { Client, Site, JobPriority } from '@/types/database'

export default function NewJobPage() {
  const router = useRouter()
  const { user, organization } = useAuthStore()
  const supabase = createClient()

  // Permission check
  const canCreate = user?.role ? hasPermission(user.role, 'jobs:create') : false

  // Form state
  const [clientId, setClientId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [serviceDate, setServiceDate] = useState(
    new Date().toISOString().split('T')[0]
  )
  const [priority, setPriority] = useState<JobPriority>('normal')
  const [techNotes, setTechNotes] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Data lists
  const [clients, setClients] = useState<Client[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [loadingClients, setLoadingClients] = useState(true)
  const [loadingSites, setLoadingSites] = useState(false)

  // Load clients on mount
  useEffect(() => {
    if (!organization) return

    async function loadClients() {
      setLoadingClients(true)
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('organization_id', organization!.id)
        .is('deleted_at', null)
        .order('company_name')

      if (error) {
        console.error('Failed to load clients:', error.message)
        toast.error('Failed to load clients')
      } else {
        setClients(data || [])
      }
      setLoadingClients(false)
    }

    loadClients()
  }, [organization])

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

    try {
      // 1. Create the job record first (without photos)
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert({
          organization_id: organization!.id,
          client_id: clientId,
          site_id: siteId,
          submitted_by: user!.id,
          status: 'submitted',
          priority,
          service_date: serviceDate,
          tech_notes: techNotes || null,
          photos: [],
        })
        .select()
        .single()

      if (jobError) throw jobError

      // 2. Upload photos if any
      let photoUrls: string[] = []
      if (photos.length > 0) {
        photoUrls = await uploadPhotos(job.id)

        // 3. Update job with photo URLs
        if (photoUrls.length > 0) {
          const { error: updateError } = await supabase
            .from('jobs')
            .update({ photos: photoUrls })
            .eq('id', job.id)

          if (updateError) {
            console.error('Failed to update job with photos:', updateError.message)
          }
        }
      }

      // 4. Log activity
      await supabase.from('activity_log').insert({
        organization_id: organization!.id,
        user_id: user!.id,
        action: 'job_submitted',
        entity_type: 'job',
        entity_id: job.id,
        metadata: {
          client_id: clientId,
          site_id: siteId,
          photo_count: photoUrls.length,
        },
      })

      toast.success('Job submitted! AI is generating report & invoice...')

      // 5. Trigger AI report + invoice generation (fire-and-forget)
      // This runs in the background — the field tech doesn't need to wait
      fetch(`/api/jobs/${job.id}/generate`, { method: 'POST' })
        .then((res) => {
          if (!res.ok) console.error('AI generation request failed')
        })
        .catch((err) => console.error('AI generation trigger error:', err))

      router.push('/jobs')
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
            {/* Client Dropdown */}
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

            {/* Site Dropdown */}
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

        {/* Service Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Service Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Date */}
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

              {/* Priority */}
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
                Submitting...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Submit Job
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
