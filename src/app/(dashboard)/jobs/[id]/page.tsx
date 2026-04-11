'use client'

/**
 * Job Detail Page
 *
 * Shows full job details with photos, notes, and status.
 * - Field Tech: view own job, edit if status is "submitted"
 * - Owner/Office Manager: approve, reject, request revision
 * - All: view status timeline
 */
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Calendar,
  MapPin,
  User,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Loader2,
  Image as ImageIcon,
} from 'lucide-react'
import type { Job, JobStatus, JobPriority } from '@/types/database'

const STATUS_CONFIG: Record<JobStatus, { label: string; className: string }> = {
  submitted: { label: 'Submitted', className: 'bg-blue-100 text-blue-700' },
  ai_generating: { label: 'AI Processing', className: 'bg-purple-100 text-purple-700' },
  pending_review: { label: 'Pending Review', className: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Approved', className: 'bg-green-100 text-green-700' },
  sent: { label: 'Sent to Client', className: 'bg-teal-100 text-teal-700' },
  revision_requested: { label: 'Revision Requested', className: 'bg-orange-100 text-orange-700' },
  revised: { label: 'Revised', className: 'bg-indigo-100 text-indigo-700' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700' },
  completed: { label: 'Completed', className: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'Cancelled', className: 'bg-zinc-100 text-zinc-500' },
}

const PRIORITY_CONFIG: Record<JobPriority, { label: string; className: string }> = {
  normal: { label: 'Normal', className: 'bg-zinc-100 text-zinc-600' },
  urgent: { label: 'Urgent', className: 'bg-amber-100 text-amber-700' },
  emergency: { label: 'Emergency', className: 'bg-red-100 text-red-700' },
}

interface JobDetail extends Job {
  clients?: { company_name: string; primary_contact_name: string } | null
  sites?: { name: string; address: string; borough: string | null } | null
  submitter?: { full_name: string; email: string } | null
  approver?: { full_name: string } | null
}

export default function JobDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuthStore()
  const jobId = params.id as string

  const canApprove = user?.role ? hasPermission(user.role, 'jobs:approve') : false
  const canReject = user?.role ? hasPermission(user.role, 'jobs:reject') : false

  const [job, setJob] = useState<JobDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [rejectionNotes, setRejectionNotes] = useState('')
  const [revisionRequest, setRevisionRequest] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [showRevisionForm, setShowRevisionForm] = useState(false)
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null)

  useEffect(() => {
    async function loadJob() {
      setLoading(true)
      const supabase = createClient()

      const { data, error } = await supabase
        .from('jobs')
        .select(`
          *,
          clients:client_id ( company_name, primary_contact_name ),
          sites:site_id ( name, address, borough ),
          submitter:submitted_by ( full_name, email ),
          approver:approved_by ( full_name )
        `)
        .eq('id', jobId)
        .single()

      if (error) {
        console.error('Failed to load job:', error.message)
        toast.error('Failed to load job details')
      } else {
        setJob(data as JobDetail)
      }
      setLoading(false)
    }

    if (jobId) loadJob()
  }, [jobId])

  async function handleStatusUpdate(newStatus: JobStatus, extra?: Record<string, unknown>) {
    if (!job) return
    setActionLoading(true)

    try {
      const supabase = createClient()
      const updateData: Record<string, unknown> = {
        status: newStatus,
        ...extra,
      }

      if (newStatus === 'approved') {
        updateData.approved_by = user!.id
        updateData.approved_at = new Date().toISOString()
      }

      const { error } = await supabase
        .from('jobs')
        .update(updateData)
        .eq('id', job.id)

      if (error) throw error

      // Log activity
      const actionMap: Record<string, string> = {
        approved: 'job_approved',
        rejected: 'job_rejected',
        completed: 'job_completed',
        cancelled: 'job_cancelled',
      }

      if (actionMap[newStatus]) {
        await supabase.from('activity_log').insert({
          organization_id: job.organization_id,
          user_id: user!.id,
          action: actionMap[newStatus],
          entity_type: 'job',
          entity_id: job.id,
        })
      }

      toast.success(`Job ${newStatus.replace('_', ' ')}`)
      setJob({ ...job, status: newStatus, ...updateData } as JobDetail)
      setShowRejectForm(false)
      setShowRevisionForm(false)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error('Status update failed:', message)
      toast.error('Failed to update job status')
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!job) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <h3 className="text-lg font-semibold mb-1">Job Not Found</h3>
            <p className="text-sm text-muted-foreground">
              This job may have been deleted or you don&apos;t have access.
            </p>
            <Button className="mt-4" variant="outline" onClick={() => router.push('/jobs')}>
              Back to Jobs
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const statusConf = STATUS_CONFIG[job.status]
  const priorityConf = PRIORITY_CONFIG[job.priority]
  const isOwner = job.submitted_by === user?.id

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/jobs')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">
                {job.clients?.company_name || 'Job Details'}
              </h1>
              <Badge className={statusConf.className}>{statusConf.label}</Badge>
              {job.priority !== 'normal' && (
                <Badge className={priorityConf.className}>
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {priorityConf.label}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Job ID: {job.id.slice(0, 8)}...
            </p>
          </div>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Location */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="h-4 w-4" /> Location
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium">{job.sites?.name || 'N/A'}</p>
            <p className="text-muted-foreground">{job.sites?.address || 'No address'}</p>
            {job.sites?.borough && (
              <p className="text-muted-foreground">{job.sites.borough}</p>
            )}
          </CardContent>
        </Card>

        {/* Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Service Date:</span>{' '}
              {new Date(job.service_date).toLocaleDateString()}
            </p>
            <p>
              <span className="text-muted-foreground">Submitted:</span>{' '}
              {new Date(job.created_at).toLocaleDateString()}
            </p>
            <p className="flex items-center gap-1">
              <User className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">By:</span>{' '}
              {job.submitter?.full_name || 'Unknown'}
            </p>
            {job.approved_by && job.approver && (
              <p>
                <span className="text-muted-foreground">Approved by:</span>{' '}
                {job.approver.full_name}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Photos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <ImageIcon className="h-4 w-4" /> Photos ({job.photos?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {job.photos && job.photos.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {job.photos.map((url, idx) => (
                <div
                  key={idx}
                  className="aspect-square rounded-lg overflow-hidden border bg-zinc-100 cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all"
                  onClick={() => setLightboxPhoto(url)}
                >
                  <img
                    src={url}
                    alt={`Job photo ${idx + 1}`}
                    className="h-full w-full object-cover"
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No photos attached</p>
          )}
        </CardContent>
      </Card>

      {/* Tech Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Technician Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {job.tech_notes ? (
            <p className="text-sm whitespace-pre-wrap">{job.tech_notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">No notes provided</p>
          )}
        </CardContent>
      </Card>

      {/* Rejection / Revision notes */}
      {job.rejection_notes && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-sm text-red-700">Rejection Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-red-600">{job.rejection_notes}</p>
          </CardContent>
        </Card>
      )}

      {job.revision_request && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="text-sm text-orange-700">Revision Requested</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-orange-600">{job.revision_request}</p>
          </CardContent>
        </Card>
      )}

      {/* Action Buttons — Approval workflow for owners/managers */}
      {(canApprove || canReject) && ['submitted', 'pending_review', 'revised'].includes(job.status) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {canApprove && (
                <Button
                  onClick={() => handleStatusUpdate('approved')}
                  disabled={actionLoading}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Approve
                </Button>
              )}
              {canReject && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setShowRevisionForm(!showRevisionForm)}
                    disabled={actionLoading}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Request Revision
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setShowRejectForm(!showRejectForm)}
                    disabled={actionLoading}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Reject
                  </Button>
                </>
              )}
            </div>

            {/* Revision form */}
            {showRevisionForm && (
              <div className="space-y-2 p-3 border rounded-lg bg-orange-50">
                <Label>What needs to be revised?</Label>
                <Textarea
                  value={revisionRequest}
                  onChange={(e) => setRevisionRequest(e.target.value)}
                  placeholder="Describe what needs to be changed..."
                  className="min-h-[80px]"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      handleStatusUpdate('revision_requested', {
                        revision_request: revisionRequest,
                      })
                    }
                    disabled={!revisionRequest.trim() || actionLoading}
                  >
                    Send Revision Request
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowRevisionForm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Reject form */}
            {showRejectForm && (
              <div className="space-y-2 p-3 border rounded-lg bg-red-50">
                <Label>Reason for rejection</Label>
                <Textarea
                  value={rejectionNotes}
                  onChange={(e) => setRejectionNotes(e.target.value)}
                  placeholder="Explain why this job is being rejected..."
                  className="min-h-[80px]"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      handleStatusUpdate('rejected', {
                        rejection_notes: rejectionNotes,
                      })
                    }
                    disabled={!rejectionNotes.trim() || actionLoading}
                  >
                    Confirm Rejection
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowRejectForm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Photo lightbox */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxPhoto(null)}
        >
          <img
            src={lightboxPhoto}
            alt="Full size"
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
          />
        </div>
      )}
    </div>
  )
}
