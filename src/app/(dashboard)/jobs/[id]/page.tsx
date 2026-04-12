'use client'

/**
 * Job Detail Page
 *
 * Shows full job details with photos, notes, and status.
 * - Field Tech: view own job, edit if status is "submitted"
 * - Owner/Office Manager: approve, reject, request revision
 * - Owner/Office Manager: manually edit report & invoice before approving
 * - Manual edits are tracked with edited_by, edited_at metadata
 * - All: view status timeline
 */
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
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
  FileText,
  Receipt,
  RefreshCw,
  DollarSign,
  Pencil,
  Save,
  X,
  Plus,
  Trash2,
  Info,
  Download,
  ChevronDown,
  FileArchive,
  Wrench,
} from 'lucide-react'
import { downloadInvoicePdf, downloadReportPdf, downloadBothAsZip } from '@/lib/pdf/download'
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

interface JobLineItemWithCatalog {
  id: string
  service_catalog_id: string
  description: string | null
  quantity: number
  unit_price: number
  total_price: number
  notes: string | null
  service_catalog?: { name: string; code: string; unit: string } | null
}

interface JobDetail extends Job {
  clients?: { company_name: string; primary_contact_name: string } | null
  sites?: { name: string; address: string; borough: string | null } | null
  submitter?: { full_name: string; email: string } | null
  approver?: { full_name: string } | null
  job_line_items?: JobLineItemWithCatalog[]
}

const JOB_SELECT_QUERY = `
  *,
  clients:client_id ( company_name, primary_contact_name ),
  sites:site_id ( name, address, borough ),
  submitter:submitted_by ( full_name, email ),
  approver:approved_by ( full_name ),
  job_line_items (
    id, service_catalog_id, description, quantity, unit_price, total_price, notes,
    service_catalog:service_catalog_id ( name, code, unit )
  )
`

interface EditableLineItem {
  service: string
  code: string
  quantity: number
  unit_price: number
  total: number
}

// ===== REPORT EDIT COMPONENT =====
function ReportEditor({
  report,
  onSave,
  onCancel,
  saving,
}: {
  report: Record<string, unknown>
  onSave: (updated: Record<string, unknown>) => void
  onCancel: () => void
  saving: boolean
}) {
  const [summary, setSummary] = useState((report.summary as string) || '')
  const [workPerformed, setWorkPerformed] = useState<string[]>(
    Array.isArray(report.work_performed) ? [...(report.work_performed as string[])] : []
  )
  const [findings, setFindings] = useState<string[]>(
    Array.isArray(report.findings) ? [...(report.findings as string[])] : []
  )
  const [recommendations, setRecommendations] = useState<string[]>(
    Array.isArray(report.recommendations) ? [...(report.recommendations as string[])] : []
  )
  const [conditionAssessment, setConditionAssessment] = useState(
    (report.condition_assessment as string) || ''
  )
  const [nextSteps, setNextSteps] = useState((report.next_steps as string) || '')

  function updateListItem(
    list: string[],
    setList: (v: string[]) => void,
    index: number,
    value: string
  ) {
    const updated = [...list]
    updated[index] = value
    setList(updated)
  }

  function removeListItem(list: string[], setList: (v: string[]) => void, index: number) {
    setList(list.filter((_, i) => i !== index))
  }

  function addListItem(list: string[], setList: (v: string[]) => void) {
    setList([...list, ''])
  }

  function handleSave() {
    // Filter out empty items
    const cleaned = {
      ...report,
      summary,
      work_performed: workPerformed.filter((s) => s.trim()),
      findings: findings.filter((s) => s.trim()),
      recommendations: recommendations.filter((s) => s.trim()),
      condition_assessment: conditionAssessment,
      next_steps: nextSteps,
    }
    onSave(cleaned)
  }

  function renderListEditor(
    label: string,
    items: string[],
    setItems: (v: string[]) => void
  ) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{label}</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => addListItem(items, setItems)}
          >
            <Plus className="h-3 w-3 mr-1" /> Add
          </Button>
        </div>
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={item}
              onChange={(e) => updateListItem(items, setItems, i, e.target.value)}
              placeholder={`${label} item...`}
              className="text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-red-400 hover:text-red-600"
              onClick={() => removeListItem(items, setItems, i)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No items — click Add to start</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
        <Info className="h-4 w-4 shrink-0" />
        <span>You&apos;re editing this report manually. Changes will be tracked.</span>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Summary</Label>
        <Textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="min-h-[80px] text-sm"
        />
      </div>

      {renderListEditor('Work Performed', workPerformed, setWorkPerformed)}
      {renderListEditor('Findings', findings, setFindings)}
      {renderListEditor('Recommendations', recommendations, setRecommendations)}

      <div className="space-y-2">
        <Label className="text-sm font-medium">Condition Assessment</Label>
        <Textarea
          value={conditionAssessment}
          onChange={(e) => setConditionAssessment(e.target.value)}
          className="min-h-[60px] text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Next Steps</Label>
        <Textarea
          value={nextSteps}
          onChange={(e) => setNextSteps(e.target.value)}
          className="min-h-[60px] text-sm"
        />
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <Save className="h-3.5 w-3.5 mr-1" />
          )}
          Save Changes
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          <X className="h-3.5 w-3.5 mr-1" /> Cancel
        </Button>
      </div>
    </div>
  )
}

interface ServiceCatalogItem {
  id: string
  name: string
  code: string
  default_price: number
}

// ===== INVOICE EDIT COMPONENT =====
function InvoiceEditor({
  invoice,
  onSave,
  onCancel,
  saving,
  services = [],
}: {
  invoice: Record<string, unknown>
  onSave: (updated: Record<string, unknown>) => void
  onCancel: () => void
  saving: boolean
  services?: ServiceCatalogItem[]
}) {
  const [lineItems, setLineItems] = useState<EditableLineItem[]>(() => {
    const items = (invoice.line_items as Array<Record<string, unknown>>) || []
    return items.map((item) => ({
      service: (item.service as string) || '',
      code: (item.code as string) || '',
      quantity: Number(item.quantity) || 1,
      unit_price: Number(item.unit_price) || 0,
      total: Number(item.total) || 0,
    }))
  })
  const taxRate = Number(invoice.tax_rate) || 8.875
  const [openDropdownIndex, setOpenDropdownIndex] = useState<number | null>(null)
  const [serviceSearches, setServiceSearches] = useState<Record<number, string>>({})

  function getFilteredServices(index: number): ServiceCatalogItem[] {
    const search = serviceSearches[index]?.toLowerCase() || ''
    if (!search) return services
    return services.filter((s) => s.name.toLowerCase().includes(search))
  }

  function selectService(index: number, service: ServiceCatalogItem) {
    updateItem(index, 'service', service.name)
    updateItem(index, 'code', service.code)
    updateItem(index, 'unit_price', service.default_price)
    setOpenDropdownIndex(null)
    setServiceSearches({ ...serviceSearches, [index]: '' })
  }

  function handleServiceInput(index: number, value: string) {
    updateItem(index, 'service', value)
    setServiceSearches({ ...serviceSearches, [index]: value })
    setOpenDropdownIndex(index)
  }

  function recalcItem(item: EditableLineItem): EditableLineItem {
    return { ...item, total: item.quantity * item.unit_price }
  }

  function updateItem(index: number, field: keyof EditableLineItem, value: string | number) {
    setLineItems((prev) => {
      const updated = [...prev]
      updated[index] = recalcItem({ ...updated[index], [field]: value })
      return updated
    })
  }

  function addItem() {
    setLineItems((prev) => [
      ...prev,
      { service: '', code: 'CUSTOM', quantity: 1, unit_price: 0, total: 0 },
    ])
  }

  function removeItem(index: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== index))
  }

  const subtotal = lineItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
  const taxAmount = subtotal * (taxRate / 100)
  const totalAmount = subtotal + taxAmount

  function handleSave() {
    const validItems = lineItems.filter((item) => item.service.trim() && item.unit_price > 0)
    if (validItems.length === 0) {
      toast.error('Invoice must have at least one line item')
      return
    }
    const recalculated = validItems.map((item) => recalcItem(item))
    const newSubtotal = recalculated.reduce((sum, item) => sum + item.total, 0)
    const newTax = newSubtotal * (taxRate / 100)

    onSave({
      ...invoice,
      line_items: recalculated,
      subtotal: newSubtotal,
      tax_rate: taxRate,
      tax_amount: newTax,
      total_amount: newSubtotal + newTax,
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
        <Info className="h-4 w-4 shrink-0" />
        <span>You&apos;re editing this invoice manually. Changes will be tracked.</span>
      </div>

      {/* Editable line items */}
      <div className="space-y-2">
        {lineItems.map((item, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-end relative">
            <div className="col-span-4 relative">
              {i === 0 && <Label className="text-xs">Service</Label>}
              <Input
                value={item.service}
                onChange={(e) => handleServiceInput(i, e.target.value)}
                onFocus={() => setOpenDropdownIndex(i)}
                placeholder="Service name or search catalog"
                className="text-sm"
              />
              {openDropdownIndex === i && services.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-50 max-h-48 overflow-auto">
                  {getFilteredServices(i).map((service) => (
                    <button
                      key={service.id}
                      type="button"
                      onClick={() => selectService(i, service)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 transition-colors border-b last:border-0"
                    >
                      <div className="font-medium">{service.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {service.code} - ${service.default_price.toFixed(2)}
                      </div>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setOpenDropdownIndex(null)
                      setServiceSearches({ ...serviceSearches, [i]: '' })
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 transition-colors text-amber-700 font-medium border-t"
                  >
                    Custom Service
                  </button>
                </div>
              )}
            </div>
            <div className="col-span-2">
              {i === 0 && <Label className="text-xs">Code</Label>}
              <Input
                value={item.code}
                onChange={(e) => updateItem(i, 'code', e.target.value)}
                placeholder="Code"
                className="text-sm"
              />
            </div>
            <div className="col-span-1">
              {i === 0 && <Label className="text-xs">Qty</Label>}
              <Input
                type="number"
                min={1}
                value={item.quantity}
                onChange={(e) => updateItem(i, 'quantity', parseInt(e.target.value) || 1)}
                className="text-sm"
              />
            </div>
            <div className="col-span-2">
              {i === 0 && <Label className="text-xs">Unit Price</Label>}
              <Input
                type="number"
                min={0}
                step={0.01}
                value={item.unit_price}
                onChange={(e) => updateItem(i, 'unit_price', parseFloat(e.target.value) || 0)}
                className="text-sm"
              />
            </div>
            <div className="col-span-2 text-right text-sm font-medium pt-1">
              ${(item.quantity * item.unit_price).toFixed(2)}
            </div>
            <div className="col-span-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-red-400 hover:text-red-600 h-8 w-8"
                onClick={() => removeItem(i)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}

        <Button type="button" variant="outline" size="sm" onClick={addItem}>
          <Plus className="h-3 w-3 mr-1" /> Add Line Item
        </Button>
      </div>

      {/* Totals preview */}
      <div className="space-y-1 text-sm border-t pt-3">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span>${subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tax ({taxRate}%)</span>
          <span>${taxAmount.toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-semibold text-base pt-1 border-t">
          <span>Total</span>
          <span>${totalAmount.toFixed(2)}</span>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <Save className="h-3.5 w-3.5 mr-1" />
          )}
          Save Changes
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          <X className="h-3.5 w-3.5 mr-1" /> Cancel
        </Button>
      </div>
    </div>
  )
}

// ===== MAIN PAGE COMPONENT =====
export default function JobDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { user, organization } = useAuthStore()
  const jobId = params.id as string

  const canApprove = user?.role ? hasPermission(user.role, 'jobs:approve') : false
  const canReject = user?.role ? hasPermission(user.role, 'jobs:reject') : false
  const canEdit = user?.role ? hasPermission(user.role, 'jobs:edit_all') : false
  const canDelete = user?.role ? hasPermission(user.role, 'jobs:delete') : false

  const [job, setJob] = useState<JobDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [rejectionNotes, setRejectionNotes] = useState('')
  const [revisionRequest, setRevisionRequest] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [showRevisionForm, setShowRevisionForm] = useState(false)
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [services, setServices] = useState<ServiceCatalogItem[]>([])

  // Manual edit states
  const [editingReport, setEditingReport] = useState(false)
  const [editingInvoice, setEditingInvoice] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [showDownloadMenu, setShowDownloadMenu] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const refreshJob = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('jobs')
      .select(JOB_SELECT_QUERY)
      .eq('id', jobId)
      .single()
    if (data) setJob(data as JobDetail)
  }, [jobId])

  useEffect(() => {
    async function loadJob() {
      setLoading(true)
      const supabase = createClient()
      const { data, error } = await supabase
        .from('jobs')
        .select(JOB_SELECT_QUERY)
        .eq('id', jobId)
        .single()

      if (error) {
        console.error('Failed to load job:', error.message)
        toast.error('Failed to load job details')
      } else {
        setJob(data as JobDetail)

        // Load service catalog if we have org
        if (organization?.id) {
          const { data: servicesData } = await supabase
            .from('service_catalog')
            .select('id, name, code, default_price')
            .eq('organization_id', organization.id)
            .eq('is_active', true)
            .order('name')

          setServices((servicesData || []) as ServiceCatalogItem[])
        }
      }
      setLoading(false)
    }

    if (jobId) loadJob()
  }, [jobId, organization])

  // ===== SAVE REPORT EDIT =====
  async function handleSaveReport(updatedReport: Record<string, unknown>) {
    if (!job) return
    setSavingEdit(true)
    try {
      const supabase = createClient()

      // Add manual edit tracking metadata
      const editHistory = Array.isArray(updatedReport._edit_history)
        ? [...(updatedReport._edit_history as Array<Record<string, unknown>>)]
        : []
      editHistory.push({
        edited_by: user!.id,
        edited_by_name: user!.full_name,
        edited_at: new Date().toISOString(),
        type: 'manual_edit',
      })

      const reportWithMeta = {
        ...updatedReport,
        manually_edited: true,
        last_edited_by: user!.id,
        last_edited_at: new Date().toISOString(),
        _edit_history: editHistory,
      }

      const { error } = await supabase
        .from('jobs')
        .update({ ai_report_content: reportWithMeta })
        .eq('id', job.id)

      if (error) throw error

      // Log activity
      await supabase.from('activity_log').insert({
        organization_id: job.organization_id,
        user_id: user!.id,
        action: 'report_manually_edited',
        entity_type: 'job',
        entity_id: job.id,
      })

      toast.success('Report updated successfully')
      setEditingReport(false)
      await refreshJob()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error('Report save failed:', message)
      toast.error('Failed to save report changes')
    } finally {
      setSavingEdit(false)
    }
  }

  // ===== SAVE INVOICE EDIT =====
  async function handleSaveInvoice(updatedInvoice: Record<string, unknown>) {
    if (!job) return
    setSavingEdit(true)
    try {
      const supabase = createClient()

      // Add manual edit tracking metadata
      const editHistory = Array.isArray(updatedInvoice._edit_history)
        ? [...(updatedInvoice._edit_history as Array<Record<string, unknown>>)]
        : []
      editHistory.push({
        edited_by: user!.id,
        edited_by_name: user!.full_name,
        edited_at: new Date().toISOString(),
        type: 'manual_edit',
      })

      const invoiceWithMeta = {
        ...updatedInvoice,
        manually_edited: true,
        last_edited_by: user!.id,
        last_edited_at: new Date().toISOString(),
        _edit_history: editHistory,
      }

      const { error } = await supabase
        .from('jobs')
        .update({ ai_invoice_content: invoiceWithMeta })
        .eq('id', job.id)

      if (error) throw error

      // Also update the invoices table if an invoice record exists
      const newTotal = Number(updatedInvoice.total_amount) || 0
      const newTax = Number(updatedInvoice.tax_amount) || 0
      const newSubtotal = Number(updatedInvoice.subtotal) || 0

      await supabase
        .from('invoices')
        .update({
          amount: newSubtotal,
          tax_amount: newTax,
          total_amount: newTotal,
        })
        .eq('job_id', job.id)

      // Log activity
      await supabase.from('activity_log').insert({
        organization_id: job.organization_id,
        user_id: user!.id,
        action: 'invoice_manually_edited',
        entity_type: 'job',
        entity_id: job.id,
      })

      toast.success('Invoice updated successfully')
      setEditingInvoice(false)
      await refreshJob()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error('Invoice save failed:', message)
      toast.error('Failed to save invoice changes')
    } finally {
      setSavingEdit(false)
    }
  }

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

      // Guard: if job is already approved/sent, prevent duplicate approval
      if (newStatus === 'approved' && ['approved', 'sent', 'completed'].includes(job.status)) {
        toast.error('This job has already been approved.')
        setActionLoading(false)
        return
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

      // AUTO-SEND: When approved, automatically send report + invoice to client
      if (newStatus === 'approved') {
        toast.success('Approved! Sending report & invoice to client...')
        try {
          const sendRes = await fetch(`/api/jobs/${job.id}/send`, { method: 'POST' })
          const sendResult = await sendRes.json()
          if (sendResult.alreadySent) {
            toast.success('Already sent to client by another approver')
          } else if (sendRes.ok && sendResult.success) {
            toast.success(`Sent to ${sendResult.sentTo}`)
            await refreshJob()
            setShowRejectForm(false)
            setShowRevisionForm(false)
            setActionLoading(false)
            return
          } else {
            toast.error(sendResult.error || 'Email send failed — you can retry manually')
          }
        } catch {
          toast.error('Failed to send email — job is approved, email can be retried')
        }
      } else {
        toast.success(`Job ${newStatus.replace('_', ' ')}`)
      }

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

  async function handleRegenerate() {
    if (!job) return
    setRegenerating(true)
    try {
      const supabase = createClient()
      await supabase
        .from('jobs')
        .update({ status: 'submitted' })
        .eq('id', job.id)

      const res = await fetch(`/api/jobs/${job.id}/generate`, { method: 'POST' })
      if (!res.ok) throw new Error('Generation failed')
      toast.success('Report & invoice regenerated!')
      await refreshJob()
    } catch (err) {
      console.error('Regeneration failed:', err)
      toast.error('Failed to regenerate. Please try again.')
    } finally {
      setRegenerating(false)
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

  // ===== DELETE JOB (owner only) =====
  async function handleDeleteJob() {
    if (!job) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}/delete`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete job')
      toast.success('Job deleted and invoice voided')
      router.push('/jobs')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      toast.error(message)
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  const statusConf = STATUS_CONFIG[job.status]
  const priorityConf = PRIORITY_CONFIG[job.priority]
  // Statuses where manual editing is allowed
  const canManuallyEdit =
    canEdit &&
    ['pending_review', 'revision_requested', 'revised'].includes(job.status)

  // Check if report/invoice were manually edited (for badge display)
  const reportMeta = job.ai_report_content as Record<string, unknown> | null
  const invoiceMeta = job.ai_invoice_content as Record<string, unknown> | null
  const reportWasEdited = reportMeta?.manually_edited === true
  const invoiceWasEdited = invoiceMeta?.manually_edited === true

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
        {canDelete && job.status !== 'cancelled' && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Job
          </Button>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="font-semibold text-red-900">Delete this job?</h3>
                <p className="text-sm text-red-700 mt-1">
                  This will cancel the job and void its associated invoice.
                  The invoice number will be preserved but marked as void.
                  This action cannot be undone.
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteJob}
                    disabled={deleting}
                  >
                    {deleting ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting...</>
                    ) : (
                      'Yes, Delete Job'
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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

      {/* Services Selected */}
      {job.job_line_items && job.job_line_items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Wrench className="h-4 w-4" /> Services ({job.job_line_items.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
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
                  {job.job_line_items.map((li, idx) => {
                    const name = li.service_catalog?.name || li.description || 'Service'
                    const code = li.service_catalog?.code || ''
                    const qty = li.quantity || 1
                    const price = li.unit_price || 0
                    const total = li.total_price || qty * price
                    return (
                      <tr key={idx} className="border-t">
                        <td className="px-3 py-2">
                          <span className="font-medium">{name}</span>
                          {code && <span className="text-xs text-muted-foreground ml-2">{code}</span>}
                        </td>
                        <td className="px-3 py-2 text-center">{qty}</td>
                        <td className="px-3 py-2 text-right">${price.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-medium">${total.toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

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

      {/* AI Processing Status */}
      {job.status === 'ai_generating' && (
        <Card className="border-purple-200 bg-purple-50">
          <CardContent className="flex items-center gap-3 py-6">
            <Loader2 className="h-5 w-5 animate-spin text-purple-600" />
            <div>
              <p className="font-medium text-purple-700">AI is generating report & invoice...</p>
              <p className="text-sm text-purple-600">This usually takes 10-30 seconds. Refresh to check.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Generated Report */}
      {job.ai_report_content && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4" /> AI-Generated Report
                {reportWasEdited && (
                  <Badge variant="outline" className="text-[10px] ml-1 text-amber-600 border-amber-300">
                    Manually Edited
                  </Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-1">
                {canManuallyEdit && !editingReport && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingReport(true)
                      setEditingInvoice(false) // Close invoice editor if open
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit Report
                  </Button>
                )}
                {canApprove && !editingReport && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRegenerate}
                    disabled={regenerating}
                  >
                    {regenerating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                    )}
                    Regenerate
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {editingReport ? (
              <ReportEditor
                report={job.ai_report_content as Record<string, unknown>}
                onSave={handleSaveReport}
                onCancel={() => setEditingReport(false)}
                saving={savingEdit}
              />
            ) : (
              (() => {
                const report = job.ai_report_content as Record<string, unknown>
                return (
                  <>
                    {report.summary && (
                      <div>
                        <h4 className="text-sm font-medium mb-1">Summary</h4>
                        <p className="text-sm text-muted-foreground">{report.summary as string}</p>
                      </div>
                    )}

                    {Array.isArray(report.work_performed) && report.work_performed.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium mb-1">Work Performed</h4>
                        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                          {(report.work_performed as string[]).map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {Array.isArray(report.findings) && report.findings.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium mb-1">Findings</h4>
                        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                          {(report.findings as string[]).map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {Array.isArray(report.recommendations) && report.recommendations.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium mb-1">Recommendations</h4>
                        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                          {(report.recommendations as string[]).map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {report.condition_assessment && (
                      <div>
                        <h4 className="text-sm font-medium mb-1">Condition Assessment</h4>
                        <p className="text-sm text-muted-foreground">{report.condition_assessment as string}</p>
                      </div>
                    )}

                    {report.next_steps && (
                      <div>
                        <h4 className="text-sm font-medium mb-1">Next Steps</h4>
                        <p className="text-sm text-muted-foreground">{report.next_steps as string}</p>
                      </div>
                    )}

                    <div className="pt-2 border-t text-xs text-muted-foreground">
                      Generated by {(report.generated_by as string) || 'AI'} on{' '}
                      {report.generated_at
                        ? new Date(report.generated_at as string).toLocaleString()
                        : 'N/A'}
                      {report.manually_edited === true && (
                        <span className="ml-2 text-amber-600">
                          • Last edited by {report.last_edited_by ? String(report.last_edited_by).slice(0, 8) + '...' : 'unknown'}{' '}
                          on {report.last_edited_at ? new Date(report.last_edited_at as string).toLocaleString() : 'N/A'}
                        </span>
                      )}
                    </div>
                  </>
                )
              })()
            )}
          </CardContent>
        </Card>
      )}

      {/* AI Generated Invoice */}
      {job.ai_invoice_content && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Receipt className="h-4 w-4" /> Auto-Generated Invoice
                {invoiceWasEdited && (
                  <Badge variant="outline" className="text-[10px] ml-1 text-amber-600 border-amber-300">
                    Manually Edited
                  </Badge>
                )}
              </CardTitle>
              {canManuallyEdit && !editingInvoice && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditingInvoice(true)
                    setEditingReport(false) // Close report editor if open
                  }}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Edit Invoice
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {editingInvoice ? (
              <InvoiceEditor
                invoice={job.ai_invoice_content as Record<string, unknown>}
                onSave={handleSaveInvoice}
                onCancel={() => setEditingInvoice(false)}
                saving={savingEdit}
                services={services}
              />
            ) : (
              (() => {
                const inv = job.ai_invoice_content as Record<string, unknown>
                const lineItems = (inv.line_items as Array<Record<string, unknown>>) || []
                return (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <div>
                        <span className="text-muted-foreground">Invoice #:</span>{' '}
                        <span className="font-mono font-medium">{inv.invoice_number as string}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Due:</span>{' '}
                        {inv.due_date
                          ? new Date(inv.due_date as string).toLocaleDateString()
                          : 'N/A'}
                      </div>
                    </div>

                    {/* Line items table */}
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-zinc-50">
                          <tr>
                            <th className="text-left p-2 font-medium">Service</th>
                            <th className="text-center p-2 font-medium">Qty</th>
                            <th className="text-right p-2 font-medium">Price</th>
                            <th className="text-right p-2 font-medium">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lineItems.map((item, i) => (
                            <tr key={i} className="border-t">
                              <td className="p-2">
                                <div className="font-medium">{item.service as string}</div>
                                <div className="text-xs text-muted-foreground">{item.code as string}</div>
                              </td>
                              <td className="p-2 text-center">{item.quantity as number}</td>
                              <td className="p-2 text-right">${Number(item.unit_price).toFixed(2)}</td>
                              <td className="p-2 text-right">${Number(item.total).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Totals */}
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span>${Number(inv.subtotal).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tax ({inv.tax_rate as number}%)</span>
                        <span>${Number(inv.tax_amount).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-base pt-1 border-t">
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-4 w-4" />
                          Total
                        </span>
                        <span>${Number(inv.total_amount).toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      Payment terms: {(inv.payment_terms as string || 'net_30').replace('_', ' ')}
                      {inv.manually_edited === true && (
                        <span className="ml-2 text-amber-600">
                          • Last edited by {inv.last_edited_by ? String(inv.last_edited_by).slice(0, 8) + '...' : 'unknown'}{' '}
                          on {inv.last_edited_at ? new Date(inv.last_edited_at as string).toLocaleString() : 'N/A'}
                        </span>
                      )}
                    </div>
                  </>
                )
              })()
            )}
          </CardContent>
        </Card>
      )}

      {/* Download Documents */}
      {job.ai_report_content && job.ai_invoice_content && organization && (
        <div className="relative">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDownloadMenu(!showDownloadMenu)}
              disabled={downloading}
            >
              {downloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Download className="h-3.5 w-3.5 mr-1" />
              )}
              Download PDFs
              <ChevronDown className="h-3 w-3 ml-1" />
            </Button>
          </div>

          {showDownloadMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white border rounded-lg shadow-lg z-50 py-1 w-56">
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 flex items-center gap-2"
                onClick={() => {
                  setShowDownloadMenu(false)
                  const dlData = {
                    invoiceContent: job.ai_invoice_content as Record<string, unknown>,
                    reportContent: job.ai_report_content as Record<string, unknown>,
                    clientName: job.clients?.company_name || 'Client',
                    clientContact: job.clients?.primary_contact_name || '',
                    siteName: job.sites?.name || '',
                    siteAddress: job.sites?.address || '',
                    serviceDate: job.service_date,
                    techName: job.submitter?.full_name || '',
                    jobId: job.id,
                  }
                  downloadInvoicePdf(dlData, organization)
                  toast.success('Invoice PDF downloaded')
                }}
              >
                <Receipt className="h-4 w-4 text-muted-foreground" />
                Download Invoice
              </button>
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 flex items-center gap-2"
                onClick={async () => {
                  setShowDownloadMenu(false)
                  setDownloading(true)
                  try {
                    // Merge job photos into report content so they appear in the PDF
                    const reportContent = { ...(job.ai_report_content as Record<string, unknown>) }
                    if (!reportContent.photos && job.photos && (job.photos as string[]).length > 0) {
                      reportContent.photos = job.photos
                    }
                    const dlData = {
                      invoiceContent: job.ai_invoice_content as Record<string, unknown>,
                      reportContent,
                      clientName: job.clients?.company_name || 'Client',
                      clientContact: job.clients?.primary_contact_name || '',
                      siteName: job.sites?.name || '',
                      siteAddress: job.sites?.address || '',
                      serviceDate: job.service_date,
                      techName: job.submitter?.full_name || '',
                      jobId: job.id,
                    }
                    await downloadReportPdf(dlData, organization)
                    toast.success('Report PDF downloaded')
                  } catch {
                    toast.error('Failed to generate report PDF')
                  } finally {
                    setDownloading(false)
                  }
                }}
              >
                <FileText className="h-4 w-4 text-muted-foreground" />
                Download Report
              </button>
              <div className="border-t my-1" />
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 flex items-center gap-2"
                onClick={async () => {
                  setShowDownloadMenu(false)
                  setDownloading(true)
                  try {
                    // Merge job photos into report content so they appear in the PDF
                    const reportContent = { ...(job.ai_report_content as Record<string, unknown>) }
                    if (!reportContent.photos && job.photos && (job.photos as string[]).length > 0) {
                      reportContent.photos = job.photos
                    }
                    const dlData = {
                      invoiceContent: job.ai_invoice_content as Record<string, unknown>,
                      reportContent,
                      clientName: job.clients?.company_name || 'Client',
                      clientContact: job.clients?.primary_contact_name || '',
                      siteName: job.sites?.name || '',
                      siteAddress: job.sites?.address || '',
                      serviceDate: job.service_date,
                      techName: job.submitter?.full_name || '',
                      jobId: job.id,
                    }
                    await downloadBothAsZip(dlData, organization)
                    toast.success('ZIP downloaded with both documents')
                  } catch {
                    toast.error('Failed to generate ZIP')
                  } finally {
                    setDownloading(false)
                  }
                }}
              >
                <FileArchive className="h-4 w-4 text-muted-foreground" />
                Download Both (ZIP)
              </button>
            </div>
          )}
        </div>
      )}

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

      {/* Sent confirmation */}
      {job.status === 'sent' && (
        <Card className="border-teal-200 bg-teal-50">
          <CardContent className="flex items-center gap-3 py-6">
            <CheckCircle2 className="h-5 w-5 text-teal-600" />
            <div>
              <p className="font-medium text-teal-700">Report & invoice sent to client</p>
              <p className="text-sm text-teal-600">
                Sent on {job.sent_at ? new Date(job.sent_at).toLocaleString() : 'N/A'}
                {job.approver && ` — Approved by ${job.approver.full_name}`}
              </p>
            </div>
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
