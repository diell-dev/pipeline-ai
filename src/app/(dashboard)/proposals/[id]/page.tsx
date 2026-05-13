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
} from 'lucide-react'
import type {
  Proposal,
  ProposalStatus,
  ProposalLineItem,
  ProposalSignature,
  ProposalMaterial,
} from '@/types/database'

const STATUS_CONFIG: Record<ProposalStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-zinc-100 text-zinc-700' },
  pending_admin_approval: { label: 'Pending Approval', className: 'bg-amber-100 text-amber-700' },
  admin_approved: { label: 'Admin Approved', className: 'bg-blue-100 text-blue-700' },
  sent_to_client: { label: 'Sent to Client', className: 'bg-teal-100 text-teal-700' },
  client_approved: { label: 'Client Signed', className: 'bg-green-100 text-green-700' },
  client_rejected: { label: 'Client Rejected', className: 'bg-red-100 text-red-700' },
  converted_to_job: { label: 'Converted to Job', className: 'bg-emerald-100 text-emerald-700' },
  expired: { label: 'Expired', className: 'bg-zinc-100 text-zinc-500' },
  cancelled: { label: 'Cancelled', className: 'bg-zinc-100 text-zinc-500' },
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

  const canApprove = user?.role ? hasPermission(user.role, 'proposals:approve') : false
  const canSend = user?.role ? hasPermission(user.role, 'proposals:send') : false
  const canConvert = user?.role ? hasPermission(user.role, 'proposals:convert') : false
  const canDelete = user?.role ? hasPermission(user.role, 'proposals:delete') : false

  const [proposal, setProposal] = useState<ProposalDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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
    if (data?.signUrl) {
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
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!proposal) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <h3 className="text-lg font-semibold mb-1">Proposal not found</h3>
            <Button className="mt-4" variant="outline" onClick={() => router.push('/proposals')}>
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
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/proposals')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">
                {proposal.proposal_number}
              </h1>
              <Badge className={statusConf.className}>{statusConf.label}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {proposal.clients?.company_name || 'Unknown Client'}
              {proposal.sites?.address ? ` · ${proposal.sites.address}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canEditDraft && (
            <Button variant="outline" size="sm" onClick={() => router.push(`/proposals/${id}/edit`)}>
              <Pencil className="h-4 w-4 mr-1" /> Edit
            </Button>
          )}
          {proposal.status === 'draft' && isCreator && (
            <Button size="sm" onClick={handleSubmitForApproval} disabled={actionLoading === 'submit'}>
              <Send className="h-4 w-4 mr-1" /> Submit for Approval
            </Button>
          )}
          {proposal.status === 'pending_admin_approval' && canApprove && (
            <Button size="sm" onClick={handleAdminApprove} disabled={actionLoading === 'approve'}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
            </Button>
          )}
          {proposal.status === 'admin_approved' && canSend && (
            <Button size="sm" onClick={handleSendToClient} disabled={actionLoading === 'send'}>
              <Mail className="h-4 w-4 mr-1" /> Send to Client
            </Button>
          )}
          {proposal.status === 'client_approved' && canConvert && (
            <Button size="sm" onClick={handleConvert} disabled={actionLoading === 'convert'}>
              <ArrowRightCircle className="h-4 w-4 mr-1" /> Convert to Job
            </Button>
          )}
          {!['expired', 'cancelled', 'converted_to_job', 'client_approved'].includes(proposal.status) && canApprove && (
            <Button variant="outline" size="sm" onClick={handleMarkExpired} disabled={actionLoading === 'expire'}>
              Mark Expired
            </Button>
          )}
          {canDelete && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          )}
        </div>
      </div>

      {showDeleteConfirm && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4 flex items-center justify-between">
            <p className="text-sm text-red-700">
              Soft-delete this proposal? You can recover it from the database.
            </p>
            <div className="flex gap-2">
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={actionLoading === 'delete'}>
                {actionLoading === 'delete' ? 'Deleting…' : 'Yes, delete'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Public sign URL panel */}
      {['admin_approved', 'sent_to_client', 'client_approved', 'client_rejected'].includes(proposal.status) && signUrl && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileSignature className="h-4 w-4" /> Public Sign Link
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-zinc-50 rounded px-2 py-1 truncate">
                {signUrl}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(signUrl)
                  toast.success('Link copied')
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <a
                href={signUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center h-7 w-7 rounded-md border bg-background hover:bg-muted text-foreground"
                title="Open public sign page"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Internal block */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Hash className="h-4 w-4" /> Internal (not visible to client)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="text-muted-foreground text-xs mb-1">Measurements</p>
            <p className="whitespace-pre-wrap">{proposal.measurements || '—'}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border rounded-lg p-3 bg-zinc-50">
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
                  <li key={i} className="text-sm">
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
            <p className="whitespace-pre-wrap">{proposal.internal_notes || '—'}</p>
          </div>
        </CardContent>
      </Card>

      {/* Client-facing block */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Client-Facing Estimate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="text-muted-foreground text-xs mb-1">Issue</p>
            <p className="whitespace-pre-wrap">{proposal.issue_description}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-1">Proposed Solution</p>
            <p className="whitespace-pre-wrap">{proposal.proposed_solution}</p>
          </div>

          {proposal.proposal_line_items && proposal.proposal_line_items.length > 0 && (
            <div>
              <p className="text-muted-foreground text-xs mb-1 flex items-center gap-1">
                <Wrench className="h-3 w-3" /> Line Items
              </p>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50">
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

      {/* Signatures */}
      {proposal.proposal_signatures && proposal.proposal_signatures.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <FileSignature className="h-4 w-4" /> Signature Audit Trail
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {proposal.proposal_signatures.map((sig) => (
              <div key={sig.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium">{sig.signed_by_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {sig.signed_by_email}
                      {sig.signed_by_title ? ` · ${sig.signed_by_title}` : ''}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(sig.signed_at).toLocaleString()}
                  </p>
                </div>
                {sig.signature_type === 'drawn' && sig.signature_data ? (
                  <img
                    src={sig.signature_data}
                    alt="Signature"
                    className="max-h-24 bg-white border rounded"
                  />
                ) : (
                  <p className="font-serif italic text-lg">{sig.signature_data}</p>
                )}
                <div className="text-[11px] text-muted-foreground">
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
