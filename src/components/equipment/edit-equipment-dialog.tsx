'use client'

/**
 * EditEquipmentDialog
 *
 * Modal for editing a piece of equipment. Calls PATCH /api/equipment/[id]
 * with whatever fields actually changed.
 *
 * Pre-fills from the current equipment row. The list of fields here MUST
 * match the EDITABLE_FIELDS whitelist on the API route.
 */
import { useEffect, useState } from 'react'
import {
  Dialog,
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
}

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
  })
  const [saving, setSaving] = useState(false)

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
    })
    // Use equipment.id (not the whole object) so an unrelated parent re-render
    // with the same row doesn't clobber unsaved edits mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment.id, open])

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Equipment</DialogTitle>
          <DialogDescription>
            Update the equipment&apos;s details. Only changed fields are saved.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="unit_number">Unit number</Label>
              <Input
                id="unit_number"
                value={form.unit_number}
                onChange={(e) => setForm({ ...form, unit_number: e.target.value })}
                placeholder="e.g. 3A"
              />
              {overFlags.unit_number && (
                <p className="text-xs text-red-600 mt-1">
                  {lenError(form.unit_number, STRING_MAX)}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="common_area_name">Common area name</Label>
              <Input
                id="common_area_name"
                value={form.common_area_name}
                onChange={(e) =>
                  setForm({ ...form, common_area_name: e.target.value })
                }
                placeholder="e.g. Roof, Boiler room"
              />
              {overFlags.common_area_name && (
                <p className="text-xs text-red-600 mt-1">
                  {lenError(form.common_area_name, STRING_MAX)}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="make">Make</Label>
              <Input
                id="make"
                value={form.make}
                onChange={(e) => setForm({ ...form, make: e.target.value })}
                placeholder="e.g. Carrier"
              />
              {overFlags.make && (
                <p className="text-xs text-red-600 mt-1">
                  {lenError(form.make, STRING_MAX)}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
              {overFlags.model && (
                <p className="text-xs text-red-600 mt-1">
                  {lenError(form.model, STRING_MAX)}
                </p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="serial_number">Serial number</Label>
            <Input
              id="serial_number"
              value={form.serial_number}
              onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
              className="font-mono"
            />
            {overFlags.serial_number && (
              <p className="text-xs text-red-600 mt-1">
                {lenError(form.serial_number, STRING_MAX)}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
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
            <div>
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
            <div>
              <Label htmlFor="next_service_due_date">Next service due</Label>
              <Input
                id="next_service_due_date"
                type="date"
                value={form.next_service_due_date}
                onChange={(e) =>
                  setForm({ ...form, next_service_due_date: e.target.value })
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="service_interval_months">Service interval (months)</Label>
              <Input
                id="service_interval_months"
                type="number"
                min={0}
                max={240}
                value={form.service_interval_months}
                onChange={(e) =>
                  setForm({ ...form, service_interval_months: e.target.value })
                }
                placeholder="e.g. 6"
              />
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v || 'active' })}
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

          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              rows={4}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Anything the next tech should know about this unit…"
            />
            {overFlags.notes && (
              <p className="text-xs text-red-600 mt-1">
                {lenError(form.notes, NOTES_MAX)}
              </p>
            )}
          </div>

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
