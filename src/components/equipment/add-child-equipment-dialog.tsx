'use client'

/**
 * AddChildEquipmentDialog
 *
 * Compact registration form for adding a sub-unit underneath an existing
 * parent piece of equipment. Sub-units don't have their own QR sticker —
 * they're part of a larger system — so this hits POST /api/equipment
 * (the no-QR variant) rather than POST /api/equipment/register.
 *
 * The parent and site are pre-filled and displayed read-only; the user
 * only fills in category + the optional descriptive fields.
 */
import { useEffect, useState } from 'react'
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

interface EquipmentCategory {
  id: string
  name: string
  icon?: string | null
}

interface AddChildEquipmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  parentId: string
  parentLabel: string
  siteId: string
  siteName?: string | null
  onCreated: () => void
}

const STRING_MAX = 200

export function AddChildEquipmentDialog({
  open,
  onOpenChange,
  parentId,
  parentLabel,
  siteId,
  siteName,
  onCreated,
}: AddChildEquipmentDialogProps) {
  const [categories, setCategories] = useState<EquipmentCategory[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(false)
  const [form, setForm] = useState({
    category_id: '',
    unit_number: '',
    common_area_name: '',
    make: '',
    model: '',
    serial_number: '',
  })
  const [saving, setSaving] = useState(false)

  // Reset form whenever the dialog (re-)opens.
  useEffect(() => {
    if (!open) return
    setForm({
      category_id: '',
      unit_number: '',
      common_area_name: '',
      make: '',
      model: '',
      serial_number: '',
    })
  }, [open, parentId])

  // Load categories on first open.
  useEffect(() => {
    if (!open || categories.length > 0) return
    let cancelled = false
    setCategoriesLoading(true)
    ;(async () => {
      try {
        const res = await fetch('/api/equipment/categories', { cache: 'no-store' })
        if (!res.ok) throw new Error('Failed to load categories')
        const json = await res.json()
        if (cancelled) return
        const list: EquipmentCategory[] = Array.isArray(json)
          ? json
          : json?.categories || []
        setCategories(list)
      } catch (err) {
        console.error(err)
        if (!cancelled) toast.error('Could not load categories')
      } finally {
        if (!cancelled) setCategoriesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, categories.length])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.category_id) {
      toast.error('Pick a category')
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        category_id: form.category_id,
        site_id: siteId,
        parent_equipment_id: parentId,
      }
      const optional: Array<keyof typeof form> = [
        'unit_number',
        'common_area_name',
        'make',
        'model',
        'serial_number',
      ]
      for (const k of optional) {
        const v = form[k].trim()
        if (v) payload[k] = v.slice(0, STRING_MAX)
      }

      const res = await fetch('/api/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || 'Failed to create sub-unit')
      }
      toast.success('Sub-unit added')
      onCreated()
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'Failed to create sub-unit')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add sub-unit</DialogTitle>
          <DialogDescription>
            Register a piece of equipment that&apos;s part of a larger system.
            Sub-units inherit the parent&apos;s site and don&apos;t need their
            own QR sticker.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSave}
          id="add-child-equipment-form"
          className="contents"
        >
          <DialogBody className="space-y-5">
            {/* Read-only context */}
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Parent: </span>
                <span className="font-medium break-words">{parentLabel}</span>
              </p>
              {siteName && (
                <p>
                  <span className="text-muted-foreground">Site: </span>
                  <span className="break-words">{siteName}</span>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="child_category" required>
                Category
              </Label>
              <Select
                value={form.category_id}
                onValueChange={(v) =>
                  setForm({ ...form, category_id: v || '' })
                }
              >
                <SelectTrigger id="child_category">
                  <SelectValue
                    placeholder={
                      categoriesLoading ? 'Loading…' : 'Pick a category'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.icon ? `${c.icon} ` : ''}
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="child_unit_number">Unit number</Label>
                <Input
                  id="child_unit_number"
                  value={form.unit_number}
                  onChange={(e) =>
                    setForm({ ...form, unit_number: e.target.value })
                  }
                  placeholder="e.g. Compressor #2"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="child_common_area_name">Common area name</Label>
                <Input
                  id="child_common_area_name"
                  value={form.common_area_name}
                  onChange={(e) =>
                    setForm({ ...form, common_area_name: e.target.value })
                  }
                  placeholder="e.g. Inside chiller"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="child_make">Make</Label>
                <Input
                  id="child_make"
                  value={form.make}
                  onChange={(e) => setForm({ ...form, make: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="child_model">Model</Label>
                <Input
                  id="child_model"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="child_serial">Serial number</Label>
              <Input
                id="child_serial"
                value={form.serial_number}
                onChange={(e) =>
                  setForm({ ...form, serial_number: e.target.value })
                }
                className="font-mono"
              />
            </div>
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
            <Button type="submit" disabled={saving || !form.category_id}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add sub-unit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
