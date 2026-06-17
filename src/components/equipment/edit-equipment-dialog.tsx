'use client'

/**
 * EditEquipmentDialog
 *
 * Modal for editing a piece of equipment. Calls PATCH /api/equipment/[id]
 * with whatever fields actually changed.
 *
 * Pre-fills from the current equipment row. The list of fields here MUST
 * match the EDITABLE_FIELDS whitelist on the API route.
 *
 * Phase C polish:
 *  - Fields grouped into labeled sections (Identification → Classification →
 *    Details → Dates → Service → Notes) instead of a flat 13-input wall.
 *  - DialogBody + sticky DialogFooter so Cancel / Save are always reachable
 *    on long forms, even on phones.
 *  - Required fields use the new <Label required> indicator.
 *  - Helper text trimmed (e.g. removed the cycle-prevention paragraph on
 *    the parent picker — it's an edge-case detail that hurts scan-ability).
 *  - Section subheaders use a quiet, uppercase tracking treatment so the
 *    user reads them as structure, not content.
 */
import { useEffect, useMemo, useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export interface EditableEquipment {
  id: string
  site_id?: string | null
  unit_number: string | null
  common_area_name: string | null
  make: string | null
  model: string | null
  serial_number: string | null
  manufacture_date: string | null
  installed_date: string | null
  next_service_due_date: string | null
  service_interval_months?: number | null
  notes?: string | null
  status?: string | null
  category_id?: string | null
  parent_equipment_id?: string | null
}

interface ParentCandidate {
  id: string
  unit_number: string | null
  common_area_name: string | null
  make: string | null
  model: string | null
  parent_equipment_id: string | null
  category_id: string | null
}

interface CategoryLite {
  id: string
  name: string
  icon?: string | null
}

const NO_PARENT = '__none__'

interface EditEquipmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  equipment: EditableEquipment
  onSaved: () => void
}

/** Strip the time portion off an ISO date so <input type=date> is happy. */
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  // Already YYYY-MM-DD? Use as-is.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'replaced', label: 'Replaced' },
  { value: 'removed', label: 'Removed' },
]

// Client-side length limits — keep in sync with the API validator.
const NOTES_MAX = 4000
const STRING_MAX = 200

function over(s: string, max: number): boolean {
  return s.length > max
}

function lenError(s: string, max: number): string {
  return `Max ${max} characters (you've written ${s.length})`
}

/**
 * Lightweight section header used inside the dialog body. Keeps the
 * vertical rhythm: group fields tightly (`gap-3`) within a section,
 * larger gaps (`gap-6`) between sections, subheaders sit just above.
 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  )
}

export function EditEquipmentDialog({
  open,
  onOpenChange,
  equipment,
  onSaved,
}: EditEquipmentDialogProps) {
  const [form, setForm] = useState({
    unit_number: equipment.unit_number || '',
    common_area_name: equipment.common_area_name || '',
    make: equipment.make || '',
    model: equipment.model || '',
    serial_number: equipment.serial_number || '',
    manufacture_date: toDateInput(equipment.manufacture_date),
    installed_date: toDateInput(equipment.installed_date),
    next_service_due_date: toDateInput(equipment.next_service_due_date),
    service_interval_months:
      equipment.service_interval_months != null
        ? String(equipment.service_interval_months)
        : '',
    notes: equipment.notes || '',
    status: equipment.status || 'active',
    parent_equipment_id: equipment.parent_equipment_id || '',
    category_id: equipment.category_id || '',
  })
  const [saving, setSaving] = useState(false)

  // Parent picker state
  const [parentCandidates, setParentCandidates] = useState<ParentCandidate[]>([])
  const [categoriesById, setCategoriesById] = useState<Map<string, CategoryLite>>(
    new Map()
  )
  const [parentLoading, setParentLoading] = useState(false)

  // Reset form when the equipment changes (e.g. dialog re-opens after edit)
  useEffect(() => {
    if (!open) return
    setForm({
      unit_number: equipment.unit_number || '',
      common_area_name: equipment.common_area_name || '',
      make: equipment.make || '',
      model: equipment.model || '',
      serial_number: equipment.serial_number || '',
      manufacture_date: toDateInput(equipment.manufacture_date),
      installed_date: toDateInput(equipment.installed_date),
      next_service_due_date: toDateInput(equipment.next_service_due_date),
      service_interval_months:
        equipment.service_interval_months != null
          ? String(equipment.service_interval_months)
          : '',
      notes: equipment.notes || '',
      status: equipment.status || 'active',
      parent_equipment_id: equipment.parent_equipment_id || '',
      category_id: equipment.category_id || '',
    })
    // Use equipment.id (not the whole object) so an unrelated parent re-render
    // with the same row doesn't clobber unsaved edits mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment.id, open])

  // Load categories — runs whenever the dialog opens, regardless of whether
  // the equipment has a site. Used for both the category picker and the
  // parent-candidate label rendering below.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/equipment/categories', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json()
        if (cancelled) return
        const cats = (json.categories || []) as CategoryLite[]
        const map = new Map<string, CategoryLite>()
        for (const c of cats) map.set(c.id, c)
        setCategoriesById(map)
      } catch (err) {
        console.error('Categories load failed', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // Load parent candidates: all equipment at the same site EXCEPT this one
  // and its descendants.
  useEffect(() => {
    if (!open || !equipment.site_id) return
    let cancelled = false
    setParentLoading(true)
    ;(async () => {
      try {
        const eqRes = await fetch(
          `/api/equipment?site_id=${equipment.site_id}&limit=200`,
          { cache: 'no-store' }
        )
        if (!eqRes.ok) throw new Error('Failed to load equipment list')
        const eqJson = await eqRes.json()
        if (cancelled) return

        const list = (eqJson.equipment || []) as Array<{
          id: string
          unit_number: string | null
          common_area_name: string | null
          make: string | null
          model: string | null
          parent_equipment_id: string | null
          category_id: string | null
          status?: string | null
          deleted_at?: string | null
        }>

        // Filter: only active rows. (API already excludes soft-deleted.)
        const active = list.filter(
          (e) => !e.status || e.status === 'active'
        )

        // Build a children-by-parent map so we can walk descendants of the
        // current equipment and exclude them (would create a cycle).
        const childrenOf = new Map<string, string[]>()
        for (const row of active) {
          if (!row.parent_equipment_id) continue
          const arr = childrenOf.get(row.parent_equipment_id) || []
          arr.push(row.id)
          childrenOf.set(row.parent_equipment_id, arr)
        }
        const excluded = new Set<string>([equipment.id])
        const queue: string[] = [equipment.id]
        while (queue.length > 0) {
          const cur = queue.shift() as string
          const kids = childrenOf.get(cur) || []
          for (const k of kids) {
            if (!excluded.has(k)) {
              excluded.add(k)
              queue.push(k)
            }
          }
        }

        const candidates: ParentCandidate[] = active
          .filter((e) => !excluded.has(e.id))
          .map((e) => ({
            id: e.id,
            unit_number: e.unit_number,
            common_area_name: e.common_area_name,
            make: e.make,
            model: e.model,
            parent_equipment_id: e.parent_equipment_id,
            category_id: e.category_id,
          }))
        setParentCandidates(candidates)
      } catch (err) {
        console.error('Parent picker load failed', err)
      } finally {
        if (!cancelled) setParentLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, equipment.site_id, equipment.id])

  // Sorted category options for the Category Select picker.
  const categoryOptions = useMemo(() => {
    return Array.from(categoriesById.values())
      .map((c) => ({
        id: c.id,
        label: `${c.icon ? `${c.icon} ` : ''}${c.name}`,
        name: c.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [categoriesById])

  // Display label for the currently-selected category. We pass this explicitly
  // as SelectValue children because the Select trigger doesn't always resolve
  // the value to the matched SelectItem's text when options load asynchronously.
  const selectedCategoryLabel = useMemo(() => {
    if (!form.category_id) return null
    const c = categoriesById.get(form.category_id)
    if (!c) return null
    return `${c.icon ? `${c.icon} ` : ''}${c.name}`
  }, [form.category_id, categoriesById])

  const parentOptions = useMemo(() => {
    return parentCandidates.map((c) => {
      const cat = c.category_id ? categoriesById.get(c.category_id) : null
      const trailer =
        c.unit_number ||
        c.common_area_name ||
        c.id.slice(0, 8)
      const makeModel = [c.make, c.model].filter(Boolean).join(' ')
      const lead = cat ? `${cat.icon ? `${cat.icon} ` : ''}${cat.name}` : 'Equipment'
      const middle = makeModel ? ` — ${makeModel}` : ''
      return {
        id: c.id,
        label: `${lead}${middle} (${trailer})`,
      }
    })
  }, [parentCandidates, categoriesById])

  // Same SelectValue-children trick for the parent picker.
  const selectedParentLabel = useMemo(() => {
    if (!form.parent_equipment_id) return 'None (top-level unit)'
    const opt = parentOptions.find((o) => o.id === form.parent_equipment_id)
    return opt?.label ?? null
  }, [form.parent_equipment_id, parentOptions])

  // Track over-limit state per field — used to show inline errors and to
  // gate the Save button.
  const overFlags = {
    unit_number: over(form.unit_number, STRING_MAX),
    common_area_name: over(form.common_area_name, STRING_MAX),
    make: over(form.make, STRING_MAX),
    model: over(form.model, STRING_MAX),
    serial_number: over(form.serial_number, STRING_MAX),
    notes: over(form.notes, NOTES_MAX),
  }
  const anyOver = Object.values(overFlags).some(Boolean)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (anyOver) {
      toast.error('Please shorten the over-limit fields')
      return
    }
    setSaving(true)
    try {
      // Build only-the-changed payload so we don't trip validators with
      // unchanged-but-blank fields.
      const payload: Record<string, unknown> = {}
      const orig = {
        unit_number: equipment.unit_number || '',
        common_area_name: equipment.common_area_name || '',
        make: equipment.make || '',
        model: equipment.model || '',
        serial_number: equipment.serial_number || '',
        manufacture_date: toDateInput(equipment.manufacture_date),
        installed_date: toDateInput(equipment.installed_date),
        next_service_due_date: toDateInput(equipment.next_service_due_date),
        service_interval_months:
          equipment.service_interval_months != null
            ? String(equipment.service_interval_months)
            : '',
        notes: equipment.notes || '',
        status: equipment.status || 'active',
        parent_equipment_id: equipment.parent_equipment_id || '',
        category_id: equipment.category_id || '',
      }

      for (const [k, v] of Object.entries(form)) {
        if ((orig as Record<string, string>)[k] !== v) {
          if (k === 'service_interval_months') {
            payload[k] = v === '' ? null : Number(v)
          } else {
            payload[k] = v === '' ? null : v
          }
        }
      }

      if (Object.keys(payload).length === 0) {
        toast.info('No changes to save')
        onOpenChange(false)
        return
      }

      const res = await fetch(`/api/equipment/${equipment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || 'Failed to save')
      }
      toast.success('Equipment updated')
      onSaved()
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      // M2.2 — long-form drawer opens at 85% height with the option to
      // expand to full-screen or peek at 40%. Ignored on desktop.
      snapPoints={[0.4, 0.85, 1]}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit equipment</DialogTitle>
          <DialogDescription>
            Update this unit&apos;s details. Only changed fields are saved.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSave}
          id="edit-equipment-form"
          className="contents"
        >
          <DialogBody className="space-y-6">
            {/* ── Identification ───────────────────────────────────── */}
            <section className="space-y-3">
              <SectionLabel>Identification</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="unit_number">Unit number</Label>
                  <Input
                    id="unit_number"
                    value={form.unit_number}
                    onChange={(e) =>
                      setForm({ ...form, unit_number: e.target.value })
                    }
                    placeholder="e.g. 3A"
                    aria-invalid={overFlags.unit_number || undefined}
                  />
                  {overFlags.unit_number && (
                    <p className="text-xs text-destructive">
                      {lenError(form.unit_number, STRING_MAX)}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="common_area_name">Common area name</Label>
                  <Input
                    id="common_area_name"
                    value={form.common_area_name}
                    onChange={(e) =>
                      setForm({ ...form, common_area_name: e.target.value })
                    }
                    placeholder="e.g. Roof, Boiler room"
                    aria-invalid={overFlags.common_area_name || undefined}
                  />
                  {overFlags.common_area_name && (
                    <p className="text-xs text-destructive">
                      {lenError(form.common_area_name, STRING_MAX)}
                    </p>
                  )}
                </div>
              </div>
            </section>

            {/* ── Classification ──────────────────────────────────── */}
            <section className="space-y-3">
              <SectionLabel>Classification</SectionLabel>
              <div className="space-y-1.5">
                <Label htmlFor="category_id">Equipment type</Label>
                <Select
                  value={form.category_id || ''}
                  onValueChange={(v) =>
                    setForm({ ...form, category_id: v || '' })
                  }
                >
                  <SelectTrigger id="category_id">
                    <SelectValue
                      placeholder={
                        categoryOptions.length === 0
                          ? 'Loading types…'
                          : 'Pick a type'
                      }
                    >
                      {selectedCategoryLabel}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {equipment.site_id && (
                <div className="space-y-1.5">
                  <Label htmlFor="parent_equipment_id">
                    Part of (parent unit)
                  </Label>
                  <Select
                    value={form.parent_equipment_id || NO_PARENT}
                    onValueChange={(v) =>
                      setForm({
                        ...form,
                        parent_equipment_id:
                          !v || v === NO_PARENT ? '' : v,
                      })
                    }
                  >
                    <SelectTrigger id="parent_equipment_id">
                      <SelectValue
                        placeholder={
                          parentLoading ? 'Loading…' : 'None (top-level unit)'
                        }
                      >
                        {selectedParentLabel}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PARENT}>
                        None (top-level unit)
                      </SelectItem>
                      {parentOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </section>

            {/* ── Details ─────────────────────────────────────────── */}
            <section className="space-y-3">
              <SectionLabel>Details</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="make">Make</Label>
                  <Input
                    id="make"
                    value={form.make}
                    onChange={(e) => setForm({ ...form, make: e.target.value })}
                    placeholder="e.g. Carrier"
                    aria-invalid={overFlags.make || undefined}
                  />
                  {overFlags.make && (
                    <p className="text-xs text-destructive">
                      {lenError(form.make, STRING_MAX)}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="model">Model</Label>
                  <Input
                    id="model"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    aria-invalid={overFlags.model || undefined}
                  />
                  {overFlags.model && (
                    <p className="text-xs text-destructive">
                      {lenError(form.model, STRING_MAX)}
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="serial_number">Serial number</Label>
                <Input
                  id="serial_number"
                  value={form.serial_number}
                  onChange={(e) =>
                    setForm({ ...form, serial_number: e.target.value })
                  }
                  className="font-mono"
                  aria-invalid={overFlags.serial_number || undefined}
                />
                {overFlags.serial_number && (
                  <p className="text-xs text-destructive">
                    {lenError(form.serial_number, STRING_MAX)}
                  </p>
                )}
              </div>
            </section>

            {/* ── Dates ────────────────────────────────────────────── */}
            <section className="space-y-3">
              <SectionLabel>Dates</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="manufacture_date">Manufactured</Label>
                  <Input
                    id="manufacture_date"
                    type="date"
                    value={form.manufacture_date}
                    onChange={(e) =>
                      setForm({ ...form, manufacture_date: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="installed_date">Installed</Label>
                  <Input
                    id="installed_date"
                    type="date"
                    value={form.installed_date}
                    onChange={(e) =>
                      setForm({ ...form, installed_date: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="next_service_due_date">Next service due</Label>
                  <Input
                    id="next_service_due_date"
                    type="date"
                    value={form.next_service_due_date}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        next_service_due_date: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
            </section>

            {/* ── Service ──────────────────────────────────────────── */}
            <section className="space-y-3">
              <SectionLabel>Service</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="service_interval_months">
                    Service interval (months)
                  </Label>
                  <Input
                    id="service_interval_months"
                    type="number"
                    min={0}
                    max={240}
                    value={form.service_interval_months}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        service_interval_months: e.target.value,
                      })
                    }
                    placeholder="e.g. 6"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="status">Status</Label>
                  <Select
                    value={form.status}
                    onValueChange={(v) =>
                      setForm({ ...form, status: v || 'active' })
                    }
                  >
                    <SelectTrigger id="status">
                      <SelectValue placeholder="Select a status" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            {/* ── Notes ────────────────────────────────────────────── */}
            <section className="space-y-3">
              <SectionLabel>Notes</SectionLabel>
              <div className="space-y-1.5">
                <Label htmlFor="notes" className="sr-only">
                  Notes
                </Label>
                <Textarea
                  id="notes"
                  rows={4}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Anything the next tech should know about this unit…"
                  aria-invalid={overFlags.notes || undefined}
                />
                {overFlags.notes && (
                  <p className="text-xs text-destructive">
                    {lenError(form.notes, NOTES_MAX)}
                  </p>
                )}
              </div>
            </section>
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || anyOver}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
