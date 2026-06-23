'use client'

/**
 * Shared item form used by /books/items/new and /books/items/[id].
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'

export interface ItemFormValues {
  name: string
  description: string
  type: 'service' | 'product' | 'bundle'
  sku: string
  default_unit_price: string  // dollars text
  default_income_account_id: string
  default_expense_account_id: string
}

const empty: ItemFormValues = {
  name: '', description: '', type: 'service', sku: '',
  default_unit_price: '0.00',
  default_income_account_id: '', default_expense_account_id: '',
}

interface Account { id: string; code: string; name: string; type: string }

interface Props {
  initial?: Partial<ItemFormValues>
  accounts: Account[]
  onSubmit: (v: ItemFormValues) => Promise<void>
  submitLabel?: string
}

export function ItemForm({ initial, accounts, onSubmit, submitLabel = 'Save item' }: Props) {
  const [values, setValues] = useState<ItemFormValues>({ ...empty, ...initial })
  const [saving, setSaving] = useState(false)
  const income = accounts.filter((a) => a.type === 'income')
  const expense = accounts.filter((a) => a.type === 'expense')

  function update<K extends keyof ItemFormValues>(k: K, v: ItemFormValues[K]) {
    setValues((s) => ({ ...s, [k]: v }))
  }

  async function submit() {
    if (!values.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    try { await onSubmit(values) } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Item</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="i-name" required>Name</Label>
            <Input id="i-name" value={values.name} onChange={(e) => update('name', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="i-type">Type</Label>
            <select id="i-type" value={values.type}
              onChange={(e) => update('type', e.target.value as 'service' | 'product' | 'bundle')}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm">
              <option value="service">Service</option>
              <option value="product">Product</option>
              <option value="bundle">Bundle</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="i-sku">SKU</Label>
            <Input id="i-sku" value={values.sku} onChange={(e) => update('sku', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="i-price">Default unit price</Label>
            <Input id="i-price" value={values.default_unit_price}
              onChange={(e) => update('default_unit_price', e.target.value)}
              inputMode="decimal" />
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label htmlFor="i-desc">Description</Label>
            <Textarea id="i-desc" value={values.description} onChange={(e) => update('description', e.target.value)} rows={2} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Accounting defaults</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="i-inc">Default income account</Label>
            <select id="i-inc" value={values.default_income_account_id}
              onChange={(e) => update('default_income_account_id', e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm">
              <option value="">— pick —</option>
              {income.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="i-exp">Default expense account</Label>
            <select id="i-exp" value={values.default_expense_account_id}
              onChange={(e) => update('default_expense_account_id', e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm">
              <option value="">— pick —</option>
              {expense.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
