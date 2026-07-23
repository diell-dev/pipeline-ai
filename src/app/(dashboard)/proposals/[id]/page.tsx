'use client'

/**
 * Proposal Detail Page
 *
 * Shows internal + client-facing fields. Surfaces workflow actions based on
 * status: edit, submit-for-approval, admin-approve, send-to-client, convert-to-job,
 * delete. Displays signature audit trail at the bottom when signed.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Pencil,
  Send,
  CheckCircle2,
  Mail,
  ArrowRightCircle,
  Trash2,
  Loader2,
  FileSignature,
  Wrench,
  Hash,
  Copy,
  ExternalLink,
  XCircle,
} from 'lucide-react'
import type {
  Proposal,
  ProposalStatus,
  ProposalLineItem,
  ProposalSignature,
  ProposalMaterial,
} from '@/types/database'
import { useSwipeBack } from '@/hooks/use-swipe-back'

const STATUS_CONFIG: Record<ProposalStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  pending_admin_approval: { label: 'Pending Approval', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  admin_approved: { label: 'Admin Approved', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  sent_to_client: { label: 'Sent to Client', className: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' },
  client_approved: { label: 'Client Signed', className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  client_rejected: { label: 'Client Rejected', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  converted_to_job: { label: 'Converted to Job', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  expired: { label: 'Expired', className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
  cancelled: { label: 'Cancelled', className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
}

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

interface ProposalDetail extends Proposal {
  clients?: { company_name: string; primary_contact_name: string; primary_contact_email: string | null } | null
  sites?: { name: string; address: string; borough: string | null } | null
  creator?: { full_name: string; email: string } | null
  proposal_line_items?: ProposalLineItem[]
  proposal_signatures?: ProposalSignature[]
}

export default function ProposalDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuthStore()
  const id = params.id as string

  // M2.5 — iOS swipe-back. Attached to the page wrapper below.
  const swipeBackRef = useSwipeBack<HTMLDivElement>()

  const canApprove = user?.role ? hasPermission(user.role, 'proposals:approve') : false
  const canSend = user?.role ? hasPermission(user.role, 'proposals:send') : false
  const canConvert = user?.role ? hasPermission(user.role, 'proposals:convert') : false
  const canDelete = user?.role ? hasPermission(user.role, 'proposals:delete') : false

  const [proposal, setProposal] = useState<ProposalDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showDeclineForm, setShowDeclineForm] = useState(false)
  const [declineReason, setDeclineReason] = useState('')

  const loadProposal = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('proposals')
      .select(`
        *,
        clients:client_id ( company_name, primary_contact_name, primary_contact_email ),
        sites:site_id ( name, address, borough ),
        creator:created_by ( full_name, email ),
        proposal_line_items ( id, service_catalog_id, service_name, description, quantity, unit, unit_price, total, sort_order, created_at ),
        proposal_signatures ( id, signed_at, signed_by_name, signed_by_email, signed_by_title, signature_data, signature_type, ip_address, user_agent, proposal_id )
      `)
      .eq('id', id)
      .single()
    if (error) {
      console.error('Failed to load proposal:', error.message)
      toast.error('Failed to load proposal')
    } else {
      setProposal(data as ProposalDetail)
    }
  }, [id])

  useEffect(() => {
    setLoading(true)
    loadProposal().finally(() => setLoading(false))
  }, [loadProposal])

  // ── Actions ──
  async function callAction(path: string, key: string, successMsg: string) {
    setActionLoading(key)
    try {
      const res = await fetch(path, { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Action failed')
      toast.success(successMsg)
      await loadProposal()
      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      toast.error(message)
      return null
    } finally {
      setActionLoading(null)
    }
  }

  async function handleSubmitForApproval() {
    await callAction(`/api/proposals/${id}/submit-for-approval`, 'submit', 'Submitted for approval')
  }
  async function handleAdminApprove() {
    await callAction(`/api/proposals/${id}/admin-approve`, 'approve', 'Approved')
  }
  async function handleSendToClient() {
    const data = await callAction(`/api/proposals/${id}/send-to-client`, 'send', 'Sent to client')
    if (data?.signUrl && process.env.NODE_ENV !== 'production') {
      // helpful in dev
      console.log('Sign URL:', data.signUrl)
    }
  }
  async function handleConvert() {
    const data = await callAction(
      `/api/proposals/${id}/convert-to-job`,
      'convert',
      'Converted to job'
    )
    if (data?.jobId) {
      router.push(`/jobs/${data.jobId}`)
    }
  }
  async function handleMarkExpired() {
    const supabase = createClient()
    setActionLoading('expire')
    const { error } = await supabase
      .from('proposals')
      .update({ status: 'expired' })
      .eq('id', id)
    if (error) toast.error(error.message)
    else {
      toast.success('Marked expired')
      await loadProposal()
    }
    setActionLoading(null)
  }
  async function handleDecline() {
    const reason = declineReason.trim()
    if (!reason) {
      toast.error('Please enter a reason')
      return
    }
    setActionLoading('decline')
    try {
      const res = await fetch(`/api/proposals/${id}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to record decline')
      toast.success('Marked as not accepted')
      setShowDeclineForm(false)
      setDeclineReason('')
      await loadProposal()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setActionLoading(null)
    }
  }
  async function handleDelete() {
    setActionLoading('delete')
    try {
      const res = await fetch(`/api/proposals/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      toast.success('Proposal deleted')
      router.push('/proposals')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      toast.error(message)
    } finally {
      setActionLoading(null)
      setShowDeleteConfirm(false)
    }
  }

  const signUrl = useMemo(() => {
    if (!proposal?.public_token) return null
    if (typeof window === 'undefined') return null
    return `${window.location.origin}/proposals/sign/${proposal.public_token}`
  }, [proposal?.public_token])

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    )
  }

  if (!proposal) {
    return (
      <div className="p-4 sm:p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <h3 className="text-lg font-semibold mb-1">Proposal not found</h3>
            <Button className="mt-4 h-10" variant="outline" onClick={() => router.push('/proposals')}>
              Back to Proposals
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const statusConf = STATUS_CONFIG[proposal.status]
  const isCreator = proposal.created_by === user?.id
  const canEditDraft = ['draft', 'pending_admin_approval'].includes(proposal.status) && (isCreator || canApprove)

  return (
    <div
      ref={swipeBackRef}
      className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6 will-change-transform"
    >
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0"
            onClick={() => router.push('/proposals')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight break-all">
                {proposal.proposal_number}
              </h1>
              <Badge className={statusConf.className}>{statusConf.label}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1 break-words">
              {proposal.clients?.company_name || 'Unknown Client'}
              {proposal.sites?.address ? ` · ${proposal.sites.address}` : ''}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 lg:shrink-0">
          {canEditDraft && (
            <Button
              variant="outline"
              onClick={() => router.push(`/proposals/${id}/edit`)}
              className="h-10 w-full sm:w-auto"
            >
              <Pencil className="h-4 w-4 mr-1" /> Edit
            </Button>
          )}
          {proposal.status === 'draft' && isCreator && (
            <Button
              onClick={handleSubmitForApproval}
              disabled={actionLoading === 'submit'}
              className="h-10 w-full sm:w-auto"
            >
              <Send className="h-4 w-4 mr-1" /> Submit for Approval
            </Button>
          )}
          {proposal.status === 'pending_admin_approval' && canApprove && (
            <Button
              onClick={handleAdminApprove}
              disabled={actionLoading === 'approve'}
              className="h-10 w-full sm:w-auto"
            >
              <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
            </Button>
          )}
          {proposal.status === 'admin_approved' && canSend && (
            <Button
              onClick={handleSendToClient}
              disabled={actionLoading === 'send'}
              className="h-10 w-full sm:w-auto"
            >
              <Mail className="h-4 w-4 mr-1" /> Send to Client
            </Button>
          )}
          {proposal.status === 'client_approved' && canConvert && (
            <Button
              onClick={handleConvert}
              disabled={actionLoading === 'convert'}
              className="h-10 w-full sm:w-auto"
            >
              <ArrowRightCircle className="h-4 w-4 mr-1" /> Convert to Job
            </Button>
          )}
          {['admin_approved', 'sent_to_client'].includes(proposal.status) && canApprove && (
            <Button
              variant="outline"
              onClick={() => setShowDeclineForm((v) => !v)}
              disabled={actionLoading === 'decline'}
              className="h-10 w-full sm:w-auto"
            >
              <XCircle className="h-4 w-4 mr-1" /> Mark as Not Accepted
            </Button>
          )}
          {!['expired', 'cancelled', 'converted_to_job', 'client_approved'].includes(proposal.status) && canApprove && (
            <Button
              variant="outline"
              onClick={handleMarkExpired}
              disabled={actionLoading === 'expire'}
              className="h-10 w-full sm:w-auto"
            >
              Mark Expired
            </Button>
          )}
          {canDelete && (
            <Button
              variant="destructive"
              onClick={() => setShowDeleteConfirm(true)}
              className="h-10 w-full sm:w-auto"
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          )}
        </div>
      </div>

      {showDeclineForm && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10">
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Record why the client isn&apos;t moving forward
            </p>
            <Textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="e.g. Client went with another contractor / decided to hold off / price too high"
              rows={3}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              This marks the proposal as not accepted and stops follow-up reminders.
              The reason is saved for your records.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                onClick={handleDecline}
                disabled={actionLoading === 'decline' || !declineReason.trim()}
                className="h-10 w-full sm:w-auto"
              >
                {actionLoading === 'decline' ? 'Saving…' : 'Save as not accepted'}
              </Button>
              <Button
                variant="outline"
                onClick={() => { setShowDeclineForm(false); setDeclineReason('') }}
                className="h-10 w-full sm:w-auto"
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showDeleteConfirm && (
        <Card className="border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10">
          <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-red-700 dark:text-red-300">
              Soft-delete this proposal? You can recover it from the database.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={actionLoading === 'delete'}
                className="h-10 w-full sm:w-auto"
              >
                {actionLoading === 'delete' ? 'Deleting…' : 'Yes, delete'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                className="h-10 w-full sm:w-auto"
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Not-accepted reason (client rejected online OR staff-recorded) */}
      {proposal.status === 'client_rejected' && proposal.client_rejection_reason && (
        <Card className="border-red-200 dark:border-red-500/30">
          <CardHeader className="pb-2 p-4 sm:p-6">
            <CardTitle className="text-sm flex items-center gap-2 text-red-700 dark:text-red-300">
              <XCircle className="h-4 w-4" /> Not accepted
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0 space-y-1">
            <p className="text-sm whitespace-pre-wrap">{proposal.client_rejection_reason}</p>
            {proposal.client_rejected_at && (
              <p className="text-xs text-muted-foreground">
                Recorded {new Date(proposal.client_rejected_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Public sign URL panel */}
      {['admin_approved', 'sent_to_client', 'client_approved', 'client_rejected'].includes(proposal.status) && signUrl && (
        <Card>
          <CardHeader className="pb-2 p-4 sm:p-6">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileSignature className="h-4 w-4" /> Public Sign Link
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 sm:p-6 pt-0 sm:pt-0">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <code className="flex-1 text-xs bg-muted rounded px-2 py-2 break-all">
                {signUrl}
              </code>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(signUrl)
                    toast.success('Link copied')
                  }}
                  className="h-10 flex-1 sm:flex-none"
                >
                  <Copy className="h-3.5 w-3.5 sm:mr-0 mr-2" />
                  <span className="sm:hidden">Copy</span>
                </Button>
                <a
                  href={signUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center h-10 px-3 sm:w-10 sm:px-0 rounded-md border bg-background hover:bg-muted text-foreground flex-1 sm:flex-none gap-2"
                  title="Open public sign page"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="sm:hidden text-sm">Open</span>
                </a>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Internal + Client-facing — single col on mobile, 2-col on lg+ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Internal block */}
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-sm flex items-center gap-2">
              <Hash className="h-4 w-4" /> Internal (not visible to client)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm p-4 sm:p-6 pt-0 sm:pt-0">
            <div>
              <p className="text-muted-foreground text-xs mb-1">Measurements</p>
              <p className="whitespace-pre-wrap break-words">{proposal.measurements || '—'}</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border rounded-lg p-3 bg-muted/50">
              <div>
                <p className="text-[11px] uppercase text-muted-foreground">Hours</p>
                <p className="font-semibold">{proposal.estimated_hours ?? '—'}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-muted-foreground">Techs</p>
                <p className="font-semibold">{proposal.num_techs_needed}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-muted-foreground">Days</p>
                <p className="font-semibold">{proposal.estimated_days}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-muted-foreground">Material Cost</p>
                <p className="font-semibold">{fmtUSD(Number(proposal.material_cost_total) || 0)}</p>
              </div>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Materials</p>
              {proposal.material_list && proposal.material_list.length > 0 ? (
                <ul className="space-y-1">
                  {(proposal.material_list as ProposalMaterial[]).map((m, i) => (
                    <li key={i} className="text-sm break-words">
                      {m.qty} × {m.name} @ {fmtUSD(Number(m.cost) || 0)} ={' '}
                      <strong>{fmtUSD((Number(m.qty) || 0) * (Number(m.cost) || 0))}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">—</p>
              )}
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Equipment</p>
              <div className="flex flex-wrap gap-1">
                {proposal.equipment_list && proposal.equipment_list.length > 0 ? (
                  proposal.equipment_list.map((eq) => (
                    <Badge key={eq} variant="outline" className="text-xs">
                      {eq}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground text-sm">—</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Internal Notes</p>
              <p className="whitespace-pre-wrap break-words">{proposal.internal_notes || '—'}</p>
            </div>
          </CardContent>
        </Card>

        {/* Client-facing block */}
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-sm">Client-Facing Estimate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm p-4 sm:p-6 pt-0 sm:pt-0">
            <div>
              <p className="text-muted-foreground text-xs mb-1">Issue</p>
              <p className="whitespace-pre-wrap break-words">{proposal.issue_description}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Proposed Solution</p>
              <p className="whitespace-pre-wrap break-words">{proposal.proposed_solution}</p>
            </div>

            {proposal.proposal_line_items && proposal.proposal_line_items.length > 0 && (
              <div>
                <p className="text-muted-foreground text-xs mb-1 flex items-center gap-1">
                  <Wrench className="h-3 w-3" /> Line Items
                </p>
                {/* Mobile: card list */}
                <div className="sm:hidden space-y-2">
                  {proposal.proposal_line_items.map((li) => (
                    <div key={li.id} className="border rounded-lg p-3 space-y-1.5">
                      <p className="text-sm font-medium break-words">{li.service_name}</p>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Qty: <span className="text-foreground">{li.quantity}</span></span>
                        <span>Price: <span className="text-foreground">{fmtUSD(Number(li.unit_price))}</span></span>
                      </div>
                      <div className="text-right text-sm font-medium pt-1 border-t">
                        {fmtUSD(Number(li.total))}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Desktop: table */}
                <div className="hidden sm:block border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Service</th>
                        <th className="text-center px-3 py-2 font-medium text-muted-foreground">Qty</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Price</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proposal.proposal_line_items.map((li) => (
                        <tr key={li.id} className="border-t">
                          <td className="px-3 py-2">{li.service_name}</td>
                          <td className="px-3 py-2 text-center">{li.quantity}</td>
                          <td className="px-3 py-2 text-right">{fmtUSD(Number(li.unit_price))}</td>
                          <td className="px-3 py-2 text-right font-medium">
                            {fmtUSD(Number(li.total))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="border-t pt-3 text-right space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Subtotal:</span>{' '}
                <strong>{fmtUSD(Number(proposal.subtotal))}</strong>
              </p>
              {proposal.discount_enabled && Number(proposal.discount_amount) > 0 && (
                <p className="text-muted-foreground">
                  Discount{proposal.discount_reason ? ` (${proposal.discount_reason})` : ''}:{' '}
                  <strong className="text-red-600">−{fmtUSD(Number(proposal.discount_amount))}</strong>
                </p>
              )}
              <p>
                <span className="text-muted-foreground">Tax ({proposal.tax_rate}%):</span>{' '}
                <strong>{fmtUSD(Number(proposal.tax_amount))}</strong>
              </p>
              <p className="text-lg font-bold pt-1 border-t">
                Total: {fmtUSD(Number(proposal.total_amount))}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Signatures */}
      {proposal.proposal_signatures && proposal.proposal_signatures.length > 0 && (
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileSignature className="h-4 w-4" /> Signature Audit Trail
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 sm:p-6 pt-0 sm:pt-0">
            {proposal.proposal_signatures.map((sig) => (
              <div key={sig.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{sig.signed_by_name}</p>
                    <p className="text-xs text-muted-foreground break-words">
                      {sig.signed_by_email}
                      {sig.signed_by_title ? ` · ${sig.signed_by_title}` : ''}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground sm:text-right shrink-0">
                    {new Date(sig.signed_at).toLocaleString()}
                  </p>
                </div>
                {sig.signature_type === 'drawn' && sig.signature_data ? (
                  <img
                    src={sig.signature_data}
                    alt="Signature"
                    className="max-h-24 max-w-full bg-white border rounded dark:bg-zinc-50"
                  />
                ) : (
                  <p className="font-serif italic text-lg break-words">{sig.signature_data}</p>
                )}
                <div className="text-[11px] text-muted-foreground break-all">
                  Type: {sig.signature_type} · IP: {sig.ip_address || '—'}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
