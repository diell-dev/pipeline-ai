'use client'

/**
 * Proposal Form — Shared between /proposals/new and /proposals/[id]/edit
 *
 * Three sections:
 *   1. Client + site
 *   2. Internal (measurements, materials, hours/days/techs, equipment, internal notes)
 *   3. Client-facing (issue, solution, line items, discount, valid_until)
 */
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { ClientCombobox } from '@/components/clients/client-combobox'
import { Plus, Trash2, Wrench } from 'lucide-react'
import type {
  Site,
  ServiceCatalogItem,
  ProposalMaterial,
} from '@/types/database'

const DEFAULT_EQUIPMENT = [
  'Camera',
  'Jet',
  'Snake',
  'Plunger',
  'Jackhammer',
  'Auger',
  'Hydro-Jet',
]

export interface ProposalFormValues {
  client_id: string
  site_id: string
  // internal
  measurements: string
  material_list: ProposalMaterial[]
  estimated_hours: string // input string
  num_techs_needed: number
  estimated_days: number
  equipment_list: string[]
  internal_notes: string
  // client-facing
  issue_description: string
  proposed_solution: string
  line_items: Array<{
    service_catalog_id: string | null
    service_name: string
    description: string
    quantity: number
    unit: string
    unit_price: number
  }>
  discount_enabled: boolean
  discount_amount: number
  discount_reason: string
  tax_rate: number
  valid_until: string
}

export const emptyProposalForm: ProposalFormValues = {
  client_id: '',
  site_id: '',
  measurements: '',
  material_list: [],
  estimated_hours: '',
  num_techs_needed: 1,
  estimated_days: 1,
  equipment_list: [],
  internal_notes: '',
  issue_description: '',
  proposed_solution: '',
  line_items: [],
  discount_enabled: false,
  discount_amount: 0,
  discount_reason: '',
  tax_rate: 8.875,
  valid_until: '',
}

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

interface Props {
  initial?: ProposalFormValues
  submitLabel?: string
  submitting: boolean
  onSubmit: (values: ProposalFormValues) => Promise<void> | void
  // Restrict client/site editing (e.g. once proposal is created)
  lockLocation?: boolean
}

export function ProposalForm({
  initial,
  submitLabel = 'Save Proposal',
  submitting,
  onSubmit,
  lockLocation,
}: Props) {
  const { organization } = useAuthStore()
  const supabase = useMemo(() => createClient(), [])

  const [values, setValues] = useState<ProposalFormValues>(initial || emptyProposalForm)
  const [sites, setSites] = useState<Site[]>([])
  const [services, setServices] = useState<ServiceCatalogItem[]>([])
  const [equipmentOptions, setEquipmentOptions] = useState<string[]>(() => {
    const merged = new Set<string>(DEFAULT_EQUIPMENT)
    initial?.equipment_list.forEach((e) => merged.add(e))
    return Array.from(merged)
  })
  const [newEquipment, setNewEquipment] = useState('')

  // Load services (clients are loaded inside ClientCombobox)
  useEffect(() => {
    if (!organization) return
    supabase
      .from('service_catalog')
      .select('*')
      .eq('organization_id', organization.id)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        setServices(data || [])
      })
  }, [organization, supabase])

  // Load sites when client changes
  useEffect(() => {
    if (!values.client_id) {
      setSites([])
      return
    }
    supabase
      .from('sites')
      .select('*')
      .eq('client_id', values.client_id)
      .is('deleted_at', null)
      .order('name')
      .then(({ data }) => setSites(data || []))
  }, [values.client_id, supabase])

  // ── Helpers ──
  function update<K extends keyof ProposalFormValues>(key: K, val: ProposalFormValues[K]) {
    setValues((p) => ({ ...p, [key]: val }))
  }

  // Materials
  function addMaterial() {
    update('material_list', [...values.material_list, { name: '', qty: 1, cost: 0 }])
  }
  function updateMaterial(idx: number, patch: Partial<ProposalMaterial>) {
    const next = values.material_list.map((m, i) => (i === idx ? { ...m, ...patch } : m))
    update('material_list', next)
  }
  function removeMaterial(idx: number) {
    update('material_list', values.material_list.filter((_, i) => i !== idx))
  }
  const materialTotal = values.material_list.reduce(
    (sum, m) => sum + (Number(m.qty) || 0) * (Number(m.cost) || 0),
    0
  )

  // Equipment
  function toggleEquipment(item: string, on: boolean) {
    if (on) update('equipment_list', [...new Set([...values.equipment_list, item])])
    else update('equipment_list', values.equipment_list.filter((e) => e !== item))
  }
  function addCustomEquipment() {
    const trimmed = newEquipment.trim()
    if (!trimmed) return
    if (!equipmentOptions.includes(trimmed)) {
      setEquipmentOptions([...equipmentOptions, trimmed])
    }
    if (!values.equipment_list.includes(trimmed)) {
      update('equipment_list', [...values.equipment_list, trimmed])
    }
    setNewEquipment('')
  }

  // Line items
  function addLineItem() {
    update('line_items', [
      ...values.line_items,
      {
        service_catalog_id: null,
        service_name: '',
        description: '',
        quantity: 1,
        unit: 'flat_rate',
        unit_price: 0,
      },
    ])
  }
  function updateLineItem(idx: number, patch: Partial<ProposalFormValues['line_items'][number]>) {
    const next = values.line_items.map((li, i) => (i === idx ? { ...li, ...patch } : li))
    update('line_items', next)
  }
  function removeLineItem(idx: number) {
    update('line_items', values.line_items.filter((_, i) => i !== idx))
  }
  function pickService(idx: number, serviceId: string) {
    if (!serviceId) {
      updateLineItem(idx, {
        service_catalog_id: null,
        service_name: '',
        unit_price: 0,
        unit: 'flat_rate',
      })
      return
    }
    const svc = services.find((s) => s.id === serviceId)
    if (!svc) return
    updateLineItem(idx, {
      service_catalog_id: svc.id,
      service_name: svc.name,
      unit_price: svc.default_price,
      unit: svc.unit,
    })
  }

  // Totals
  const subtotal = values.line_items.reduce(
    (sum, li) => sum + (Number(li.quantity) || 0) * (Number(li.unit_price) || 0),
    0
  )
  const discount = values.discount_enabled
    ? Math.max(0, Math.min(Number(values.discount_amount) || 0, subtotal))
    : 0
  const taxedBase = Math.max(0, subtotal - discount)
  const taxAmount = taxedBase * (Number(values.tax_rate) / 100)
  const total = taxedBase + taxAmount

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit(values)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Section 1: Location */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Client &amp; Site</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="client">Client *</Label>
            <ClientCombobox
              id="client"
              value={values.client_id}
              onChange={(newId) => {
                update('client_id', newId)
                update('site_id', '')
              }}
              placeholder="Select or add a client"
              required
              disabled={lockLocation}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="site">Site</Label>
            <select
              id="site"
              value={values.site_id}
              onChange={(e) => update('site_id', e.target.value)}
              disabled={!values.client_id || lockLocation}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">
                {!values.client_id ? 'Select a client first' : 'Select a site (optional)'}
              </option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.address}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Internal */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Internal Notes (not shown to client)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="measurements">Measurements</Label>
            <Textarea
              id="measurements"
              value={values.measurements}
              onChange={(e) => update('measurements', e.target.value)}
              placeholder="Pipe diameter, run lengths, drop height, etc."
              className="min-h-[60px]"
            />
          </div>

          {/* Materials */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Material List</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addMaterial}>
                <Plus className="h-3 w-3 mr-1" /> Add Material
              </Button>
            </div>
            {values.material_list.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No materials added yet.</p>
            )}
            {values.material_list.map((m, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-6">
                  {i === 0 && <Label className="text-xs">Item</Label>}
                  <Input
                    value={m.name}
                    onChange={(e) => updateMaterial(i, { name: e.target.value })}
                    placeholder="e.g. 4-inch PVC pipe"
                  />
                </div>
                <div className="col-span-2">
                  {i === 0 && <Label className="text-xs">Qty</Label>}
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={m.qty}
                    onChange={(e) => updateMaterial(i, { qty: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="col-span-3">
                  {i === 0 && <Label className="text-xs">Unit Cost</Label>}
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={m.cost}
                    onChange={(e) => updateMaterial(i, { cost: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="col-span-1 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeMaterial(i)}
                    className="text-red-400 hover:text-red-600 h-8 w-8"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            {values.material_list.length > 0 && (
              <p className="text-xs text-muted-foreground text-right">
                Material cost: <strong>{fmtUSD(materialTotal)}</strong>
              </p>
            )}
          </div>

          {/* Hours / techs / days */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="hours">Estimated Hours</Label>
              <Input
                id="hours"
                type="number"
                min={0}
                step="0.5"
                value={values.estimated_hours}
                onChange={(e) => update('estimated_hours', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="techs">Techs Needed</Label>
              <Input
                id="techs"
                type="number"
                min={1}
                value={values.num_techs_needed}
                onChange={(e) => update('num_techs_needed', parseInt(e.target.value) || 1)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="days">Days</Label>
              <Input
                id="days"
                type="number"
                min={1}
                value={values.estimated_days}
                onChange={(e) => update('estimated_days', parseInt(e.target.value) || 1)}
              />
            </div>
          </div>

          {/* Equipment */}
          <div className="space-y-2">
            <Label>Equipment</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {equipmentOptions.map((opt) => {
                const checked = values.equipment_list.includes(opt)
                return (
                  <label
                    key={opt}
                    className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2 cursor-pointer hover:bg-zinc-50"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => toggleEquipment(opt, !!v)}
                    />
                    {opt}
                  </label>
                )
              })}
            </div>
            <div className="flex gap-2 pt-1">
              <Input
                value={newEquipment}
                onChange={(e) => setNewEquipment(e.target.value)}
                placeholder="Add custom equipment"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCustomEquipment()
                  }
                }}
              />
              <Button type="button" variant="outline" size="sm" onClick={addCustomEquipment}>
                Add
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="internal_notes">Internal Notes</Label>
            <Textarea
              id="internal_notes"
              value={values.internal_notes}
              onChange={(e) => update('internal_notes', e.target.value)}
              placeholder="Anything for the office to keep in mind"
              className="min-h-[60px]"
            />
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Client-facing */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">3. Client-Facing Estimate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="issue">Issue Description *</Label>
            <Textarea
              id="issue"
              value={values.issue_description}
              onChange={(e) => update('issue_description', e.target.value)}
              required
              placeholder="What's wrong at the property? What did you find on-site?"
              className="min-h-[80px]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="solution">Proposed Solution *</Label>
            <Textarea
              id="solution"
              value={values.proposed_solution}
              onChange={(e) => update('proposed_solution', e.target.value)}
              required
              placeholder="The work we propose to do, in clear language for the client."
              className="min-h-[120px]"
            />
          </div>

          {/* Line items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Wrench className="h-4 w-4" /> Services / Line Items
              </Label>
              <Button type="button" variant="ghost" size="sm" onClick={addLineItem}>
                <Plus className="h-3 w-3 mr-1" /> Add Line
              </Button>
            </div>
            {values.line_items.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No line items yet.</p>
            )}
            {values.line_items.map((li, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-5">
                  {i === 0 && <Label className="text-xs">Service</Label>}
                  <select
                    value={li.service_catalog_id || ''}
                    onChange={(e) => pickService(i, e.target.value)}
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-2 py-1 text-sm"
                  >
                    <option value="">— Custom —</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    value={li.service_name}
                    onChange={(e) => updateLineItem(i, { service_name: e.target.value })}
                    placeholder="Service name"
                    className="mt-1 text-sm"
                    required
                  />
                </div>
                <div className="col-span-2">
                  {i === 0 && <Label className="text-xs">Qty</Label>}
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={li.quantity}
                    onChange={(e) => updateLineItem(i, { quantity: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="col-span-2">
                  {i === 0 && <Label className="text-xs">Unit Price</Label>}
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={li.unit_price}
                    onChange={(e) => updateLineItem(i, { unit_price: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="col-span-2 text-right pt-1 text-sm font-medium">
                  {fmtUSD((Number(li.quantity) || 0) * (Number(li.unit_price) || 0))}
                </div>
                <div className="col-span-1 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-red-400 hover:text-red-600 h-8 w-8"
                    onClick={() => removeLineItem(i)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Discount */}
          <div className="border rounded-lg p-3 space-y-3 bg-zinc-50">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Apply discount?</Label>
              <Switch
                checked={values.discount_enabled}
                onCheckedChange={(v) => update('discount_enabled', v)}
              />
            </div>
            {values.discount_enabled && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Discount Amount ($)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={values.discount_amount}
                    onChange={(e) => update('discount_amount', parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Reason</Label>
                  <Input
                    value={values.discount_reason}
                    onChange={(e) => update('discount_reason', e.target.value)}
                    placeholder="e.g. loyal customer"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Tax + valid until */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tax">Tax Rate (%)</Label>
              <Input
                id="tax"
                type="number"
                min={0}
                step="0.001"
                value={values.tax_rate}
                onChange={(e) => update('tax_rate', parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="valid">Valid Until</Label>
              <Input
                id="valid"
                type="date"
                value={values.valid_until}
                onChange={(e) => update('valid_until', e.target.value)}
              />
            </div>
          </div>

          {/* Totals */}
          <div className="border-t pt-3 text-right space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Subtotal:</span>{' '}
              <strong>{fmtUSD(subtotal)}</strong>
            </p>
            {values.discount_enabled && discount > 0 && (
              <p className="text-muted-foreground">
                Discount: <strong className="text-red-600">−{fmtUSD(discount)}</strong>
              </p>
            )}
            <p>
              <span className="text-muted-foreground">
                Tax ({values.tax_rate}%):
              </span>{' '}
              <strong>{fmtUSD(taxAmount)}</strong>
            </p>
            <p className="text-lg font-bold pt-1 border-t">
              Total: {fmtUSD(total)}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={submitting} size="lg">
          {submitting ? 'Saving...' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
