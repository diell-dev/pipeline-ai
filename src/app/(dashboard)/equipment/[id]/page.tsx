'use client'

/**
 * Equipment Detail Page
 *
 * Renders one piece of equipment with:
 *   - identity + location + QR code
 *   - action bar (start work order, edit, delete, re-run AI lookup)
 *   - equipment info (make/model/serial/dates)
 *   - AI manufacturer data (collapsible)
 *   - photos (data plate + unit, with lightbox)
 *   - system hierarchy (parent + children)
 *   - service history (linked jobs)
 *   - inspection history
 *   - scan log
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission, type Permission } from '@/lib/permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { ScheduleWorkOrderDialog } from '@/components/equipment/schedule-work-order-dialog'
import { EditEquipmentDialog } from '@/components/equipment/edit-equipment-dialog'
import { AddChildEquipmentDialog } from '@/components/equipment/add-child-equipment-dialog'
import {
  ArrowLeft,
  Loader2,
  QrCode,
  MapPin,
  Wrench,
  Sparkles,
  Calendar,
  Trash2,
  Pencil,
  PlayCircle,
  Plus,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  History,
  ClipboardCheck,
  AlertTriangle,
  Layers,
} from 'lucide-react'

// ============================================================
// Types — loose since the backend agent is still finalising
// the equipment types in database.ts. We rely on the API shape.
// ============================================================

interface EquipmentCategory {
  id: string
  code: string
  name: string
  icon?: string | null
  inspection_checklist?: unknown
}

interface EquipmentDetail {
  id: string
  organization_id: string
  site_id: string | null
  category_id: string | null
  unit_number: string | null
  common_area_name: string | null
  make: string | null
  model: string | null
  serial_number: string | null
  manufacture_date: string | null
  installed_date: string | null
  last_serviced_date: string | null
  next_service_due_date: string | null
  service_interval_months?: number | null
  parent_equipment_id: string | null
  qr_code?: string | null
  unit_photo_url?: string | null
  data_plate_photo_url?: string | null
  ai_metadata?: Record<string, unknown> | null
  status?: string | null
  notes?: string | null
}

interface SiteSummary {
  id: string
  name: string
  address?: string | null
}

interface ScanRow {
  id: string
  scanned_at: string
  scanned_by_name?: string | null
  action?: string | null
}

interface InspectionItemResult {
  label: string
  result?: 'pass' | 'fail' | 'na' | null
  notes?: string | null
}

interface InspectionRow {
  id: string
  inspected_at: string
  inspected_by_name?: string | null
  items: InspectionItemResult[]
  notes?: string | null
}

interface LinkedJob {
  id: string
  service_date: string
  status: string
  tech_name?: string | null
}

interface ChildEquipment {
  id: string
  unit_number: string | null
  make: string | null
  model: string | null
  category_name?: string | null
}

interface ParentEquipment {
  id: string
  unit_number: string | null
  make: string | null
  model: string | null
  category_name?: string | null
}

interface EquipmentDetailResponse {
  equipment: EquipmentDetail
  category?: EquipmentCategory | null
  site?: SiteSummary | null
  scans?: ScanRow[]
  jobs?: LinkedJob[]
  children?: ChildEquipment[]
  parent?: ParentEquipment | null
  inspections?: InspectionRow[]
}

// ============================================================
// Helpers
// ============================================================

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString()
}

function dueChip(iso: string | null | undefined): { className: string; label: string } | null {
  if (!iso) return null
  const due = new Date(iso).getTime()
  if (Number.isNaN(due)) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((due - today.getTime()) / (1000 * 60 * 60 * 24))
  if (days < 0)
    return { className: 'bg-red-100 text-red-700 border-red-200', label: `${Math.abs(days)}d overdue` }
  if (days <= 30)
    return { className: 'bg-amber-100 text-amber-700 border-amber-200', label: `Due in ${days}d` }
  return { className: 'bg-zinc-100 text-zinc-600 border-zinc-200', label: `Due in ${days}d` }
}

// ============================================================
// Page
// ============================================================

export default function EquipmentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuthStore()
  const equipmentId = params.id as string

  const canEdit = user?.role ? hasPermission(user.role, 'equipment:edit' as Permission) : false
  const canDelete = user?.role ? hasPermission(user.role, 'equipment:delete' as Permission) : false
  const canSchedule = user?.role ? hasPermission(user.role, 'jobs:create' as Permission) : false
  const canRegister = user?.role ? hasPermission(user.role, 'equipment:register' as Permission) : false

  const [data, setData] = useState<EquipmentDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [aiLookupLoading, setAiLookupLoading] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(true)
  const [scansOpen, setScansOpen] = useState(false)
  const [expandedInspections, setExpandedInspections] = useState<Set<string>>(new Set())
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [addChildOpen, setAddChildOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/equipment/${equipmentId}`, { cache: 'no-store' })
      if (!res.ok) {
        setData(null)
        return
      }
      const json = (await res.json()) as EquipmentDetailResponse
      setData(json)
    } catch (err) {
      console.error('Equipment fetch failed', err)
      setData(null)
    }
  }, [equipmentId])

  useEffect(() => {
    setLoading(true)
    refresh().finally(() => setLoading(false))
  }, [refresh])

  // ---- Actions ----

  async function handleDelete() {
    if (!data) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/equipment/${data.equipment.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      toast.success('Equipment deleted')
      router.push('/equipment')
    } catch (err) {
      console.error(err)
      toast.error('Failed to delete equipment')
    } finally {
      setActionLoading(false)
      setShowDeleteConfirm(false)
    }
  }

  async function handleRerunAiLookup() {
    if (!data) return
    setAiLookupLoading(true)
    try {
      const res = await fetch(`/api/equipment/${data.equipment.id}/ai-lookup`, { method: 'POST' })
      if (!res.ok) throw new Error('AI lookup failed')
      toast.success('AI lookup complete')
      await refresh()
    } catch (err) {
      console.error(err)
      toast.error('Failed to run AI lookup')
    } finally {
      setAiLookupLoading(false)
    }
  }

  function toggleInspection(id: string) {
    setExpandedInspections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const aiMetadata = useMemo<Record<string, unknown> | null>(() => {
    return data?.equipment?.ai_metadata && typeof data.equipment.ai_metadata === 'object'
      ? data.equipment.ai_metadata
      : null
  }, [data])

  // ============================================================
  // Render
  // ============================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <h3 className="text-lg font-semibold mb-1">Equipment not found</h3>
            <p className="text-sm text-muted-foreground">
              It may have been deleted or you don&apos;t have access.
            </p>
            <Button className="mt-4" variant="outline" onClick={() => router.push('/equipment')}>
              Back to Equipment
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { equipment, category, site, scans = [], jobs = [], children = [], parent, inspections = [] } = data
  const chip = dueChip(equipment.next_service_due_date)
  const icon = (category?.icon as string | undefined) || '🛠️'
  const unitLabel = equipment.unit_number || equipment.common_area_name || 'No unit number'

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-2 sm:gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          onClick={() => router.push('/equipment')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-2xl">{icon}</span>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight break-words">
              {category?.name || 'Equipment'}
            </h1>
            {equipment.status === 'replaced' && (
              <Badge variant="outline" className="bg-zinc-100 text-zinc-600">Replaced</Badge>
            )}
            {equipment.status === 'inactive' && (
              <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200">
                Inactive
              </Badge>
            )}
            {equipment.status === 'removed' && (
              <Badge variant="outline" className="bg-red-100 text-red-700 border-red-200">
                Removed
              </Badge>
            )}
            {chip && (
              <Badge variant="outline" className={chip.className}>
                <Calendar className="h-3 w-3 mr-1" />
                {chip.label}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1 flex items-start gap-1 break-words">
            <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">
              {site?.name || 'Unknown site'} — {unitLabel}
            </span>
          </p>
          {equipment.qr_code && (
            <Badge variant="outline" className="mt-2 font-mono text-[11px] break-all">
              <QrCode className="h-3 w-3 mr-1 shrink-0" />
              {equipment.qr_code}
            </Badge>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
        {canSchedule && (
          <Button
            className="h-10 col-span-2 sm:col-auto"
            onClick={() => setScheduleOpen(true)}
            disabled={actionLoading}
          >
            <PlayCircle className="mr-2 h-4 w-4" />
            Start Work Order
          </Button>
        )}
        {canEdit && (
          <Button
            variant="outline"
            className="h-10"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
        )}
        <Button
          variant="outline"
          className="h-10"
          onClick={handleRerunAiLookup}
          disabled={aiLookupLoading}
        >
          {aiLookupLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          <span className="truncate">Re-run AI Lookup</span>
        </Button>
        {canDelete && (
          <Button
            variant="destructive"
            className="h-10"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={actionLoading}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        )}
      </div>

      {/* Delete confirm */}
      {showDeleteConfirm && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="font-semibold text-red-900">Delete this equipment?</h3>
                <p className="text-sm text-red-700 mt-1">
                  Service history will be preserved but the unit will no longer appear in lists.
                </p>
                <div className="flex gap-2 mt-3">
                  <Button variant="destructive" size="sm" onClick={handleDelete} disabled={actionLoading}>
                    {actionLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Yes, delete
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Equipment Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Wrench className="h-4 w-4" /> Equipment Info
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[7rem_1fr] sm:grid-cols-[8rem_1fr_8rem_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Make</dt>
            <dd className="font-medium break-words">{equipment.make || '—'}</dd>
            <dt className="text-muted-foreground">Model</dt>
            <dd className="font-medium break-words">{equipment.model || '—'}</dd>
            <dt className="text-muted-foreground">Serial</dt>
            <dd className="font-mono break-all">{equipment.serial_number || '—'}</dd>
            <dt className="text-muted-foreground">Manufactured</dt>
            <dd>{fmtDate(equipment.manufacture_date)}</dd>
            <dt className="text-muted-foreground">Installed</dt>
            <dd>{fmtDate(equipment.installed_date)}</dd>
            <dt className="text-muted-foreground">Last serviced</dt>
            <dd>{fmtDate(equipment.last_serviced_date)}</dd>
            <dt className="text-muted-foreground">Next service due</dt>
            <dd className="flex flex-wrap items-center gap-2">
              {fmtDate(equipment.next_service_due_date)}
              {chip && (
                <Badge variant="outline" className={chip.className}>
                  {chip.label}
                </Badge>
              )}
            </dd>
          </dl>
        </CardContent>
      </Card>

      {/* AI Manufacturer Data */}
      <Card>
        <CardHeader>
          <button
            type="button"
            onClick={() => setAiOpen(!aiOpen)}
            className="w-full flex items-center justify-between min-h-10 -my-1.5"
          >
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> AI Manufacturer Data
            </CardTitle>
            {aiOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </CardHeader>
        {aiOpen && (
          <CardContent className="space-y-3 text-sm">
            {!aiMetadata ? (
              <div className="text-center py-6">
                <p className="text-muted-foreground mb-3">No AI data yet.</p>
                <Button size="sm" variant="outline" onClick={handleRerunAiLookup} disabled={aiLookupLoading}>
                  {aiLookupLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  Run AI Lookup
                </Button>
              </div>
            ) : (
              <>
                {Array.isArray(aiMetadata.common_failure_modes) &&
                  (aiMetadata.common_failure_modes as string[]).length > 0 && (
                    <div>
                      <h4 className="font-medium mb-1">Common failure modes</h4>
                      <ul className="text-muted-foreground space-y-1 pl-4 list-disc">
                        {(aiMetadata.common_failure_modes as string[]).map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                {Array.isArray(aiMetadata.recommended_parts) &&
                  (aiMetadata.recommended_parts as string[]).length > 0 && (
                    <div>
                      <h4 className="font-medium mb-1">Recommended parts</h4>
                      <ul className="text-muted-foreground space-y-1 pl-4 list-disc">
                        {(aiMetadata.recommended_parts as string[]).map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                {aiMetadata.recall_notice && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3">
                    <h4 className="font-medium text-red-700 mb-1 flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4" /> Recall notice
                    </h4>
                    <p className="text-sm text-red-700">{String(aiMetadata.recall_notice)}</p>
                  </div>
                )}
                {aiMetadata.lifespan_estimate && (
                  <p>
                    <span className="text-muted-foreground">Expected lifespan: </span>
                    <span className="font-medium">{String(aiMetadata.lifespan_estimate)}</span>
                  </p>
                )}
                {aiMetadata.notes && (
                  <p className="text-muted-foreground italic">{String(aiMetadata.notes)}</p>
                )}
              </>
            )}
          </CardContent>
        )}
      </Card>

      {/* Photos */}
      {(equipment.unit_photo_url || equipment.data_plate_photo_url) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <ImageIcon className="h-4 w-4" /> Photos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {equipment.unit_photo_url && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Unit</p>
                  <button
                    type="button"
                    onClick={() => setLightbox(equipment.unit_photo_url!)}
                    className="aspect-square rounded-lg overflow-hidden border bg-zinc-100 w-full"
                  >
                    <img
                      src={equipment.unit_photo_url}
                      alt="Unit"
                      className="h-full w-full object-cover"
                    />
                  </button>
                </div>
              )}
              {equipment.data_plate_photo_url && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Data plate</p>
                  <button
                    type="button"
                    onClick={() => setLightbox(equipment.data_plate_photo_url!)}
                    className="aspect-square rounded-lg overflow-hidden border bg-zinc-100 w-full"
                  >
                    <img
                      src={equipment.data_plate_photo_url}
                      alt="Data plate"
                      className="h-full w-full object-cover"
                    />
                  </button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* System hierarchy */}
      {(parent || children.length > 0 || (canRegister && equipment.site_id)) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="h-4 w-4" /> System Hierarchy
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            {parent && (
              <p>
                <span className="text-muted-foreground">Part of: </span>
                <Link
                  href={`/equipment/${parent.id}`}
                  className="text-blue-600 hover:underline font-medium"
                >
                  {parent.category_name || 'Equipment'} —{' '}
                  {[parent.make, parent.model, parent.unit_number].filter(Boolean).join(' ')}
                </Link>
              </p>
            )}
            {children.length > 0 ? (
              <div>
                <p className="text-muted-foreground mb-1">Sub-units:</p>
                <ul className="space-y-1">
                  {children.map((c) => (
                    <li key={c.id}>
                      <Link href={`/equipment/${c.id}`} className="text-blue-600 hover:underline">
                        {c.category_name || 'Equipment'} —{' '}
                        {[c.make, c.model, c.unit_number].filter(Boolean).join(' ') || c.id.slice(0, 8)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              !parent && (
                <p className="text-muted-foreground italic">
                  No sub-units yet. Add a child unit to model multi-component systems.
                </p>
              )
            )}
            {canRegister && equipment.site_id && (
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAddChildOpen(true)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add sub-unit
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Service history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4" /> Service History ({jobs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No service history yet.</p>
          ) : (
            <ul className="divide-y">
              {jobs.map((j) => (
                <li
                  key={j.id}
                  className="py-2 flex items-center justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{fmtDate(j.service_date)}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {j.tech_name || 'Unknown tech'} • {j.status.replace(/_/g, ' ')}
                    </p>
                  </div>
                  <Link
                    href={`/jobs/${j.id}`}
                    className="text-blue-600 hover:underline text-xs shrink-0 min-h-10 flex items-center px-2"
                  >
                    View report
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Inspection history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" /> Inspection History ({inspections.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {inspections.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No inspections yet.</p>
          ) : (
            <ul className="divide-y">
              {inspections.map((insp) => {
                const expanded = expandedInspections.has(insp.id)
                const passes = insp.items.filter((i) => i.result === 'pass').length
                const fails = insp.items.filter((i) => i.result === 'fail').length
                return (
                  <li key={insp.id} className="py-2">
                    <button
                      type="button"
                      onClick={() => toggleInspection(insp.id)}
                      className="w-full flex items-center justify-between gap-3 text-sm min-h-10"
                    >
                      <div className="text-left">
                        <p className="font-medium">{fmtDate(insp.inspected_at)}</p>
                        <p className="text-xs text-muted-foreground">
                          {insp.inspected_by_name || 'Unknown'} •{' '}
                          <span className="text-emerald-600">{passes} pass</span>
                          {fails > 0 && (
                            <>
                              {' • '}
                              <span className="text-red-600">{fails} fail</span>
                            </>
                          )}
                        </p>
                      </div>
                      {expanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                    {expanded && (
                      <ul className="mt-2 ml-3 space-y-1 text-xs">
                        {insp.items.map((it, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span
                              className={`inline-block w-12 text-center rounded-full font-medium ${
                                it.result === 'pass'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : it.result === 'fail'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-zinc-100 text-zinc-500'
                              }`}
                            >
                              {it.result?.toUpperCase() || 'N/A'}
                            </span>
                            <div className="flex-1">
                              <p>{it.label}</p>
                              {it.notes && (
                                <p className="text-muted-foreground italic">{it.notes}</p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Scan log (collapsible) */}
      <Card>
        <CardHeader>
          <button
            type="button"
            onClick={() => setScansOpen(!scansOpen)}
            className="w-full flex items-center justify-between min-h-10 -my-1.5"
          >
            <CardTitle className="text-sm flex items-center gap-2">
              <QrCode className="h-4 w-4" /> Recent Scans ({scans.length})
            </CardTitle>
            {scansOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </CardHeader>
        {scansOpen && (
          <CardContent>
            {scans.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No scans recorded.</p>
            ) : (
              <ul className="divide-y text-sm">
                {scans.slice(0, 10).map((s) => (
                  <li key={s.id} className="py-2 flex items-center justify-between">
                    <span>{s.scanned_by_name || 'Unknown'}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(s.scanned_at).toLocaleString()}
                      {s.action ? ` • ${s.action}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        )}
      </Card>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="Full size"
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
          />
        </div>
      )}

      {/* Schedule work order */}
      {canSchedule && (
        <ScheduleWorkOrderDialog
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          equipmentId={equipment.id}
          equipmentLabel={
            `${category?.name || 'Equipment'} — ${unitLabel}` +
            (site?.name ? ` @ ${site.name}` : '')
          }
        />
      )}

      {/* Edit equipment */}
      {canEdit && (
        <EditEquipmentDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          equipment={{
            id: equipment.id,
            site_id: equipment.site_id,
            unit_number: equipment.unit_number,
            common_area_name: equipment.common_area_name,
            make: equipment.make,
            model: equipment.model,
            serial_number: equipment.serial_number,
            manufacture_date: equipment.manufacture_date,
            installed_date: equipment.installed_date,
            next_service_due_date: equipment.next_service_due_date,
            service_interval_months: equipment.service_interval_months ?? null,
            notes: equipment.notes ?? null,
            status: equipment.status ?? 'active',
            category_id: equipment.category_id,
            parent_equipment_id: equipment.parent_equipment_id,
          }}
          onSaved={() => {
            refresh()
          }}
        />
      )}

      {/* Add child equipment */}
      {canRegister && equipment.site_id && (
        <AddChildEquipmentDialog
          open={addChildOpen}
          onOpenChange={setAddChildOpen}
          parentId={equipment.id}
          parentLabel={`${category?.name || 'Equipment'} — ${unitLabel}`}
          siteId={equipment.site_id}
          siteName={site?.name}
          onCreated={() => {
            refresh()
          }}
        />
      )}
    </div>
  )
}
