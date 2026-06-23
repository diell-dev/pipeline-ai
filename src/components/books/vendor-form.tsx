'use client'

/**
 * Shared vendor form used by both /books/vendors/new and /books/vendors/[id].
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'

export interface VendorFormValues {
  name: string
  contact_name: string
  email: string
  phone: string
  address_line1: string
  city: string
  state: string
  postal_code: string
  tax_id: string
  payment_terms_days: number
  default_expense_account_id: string
  notes: string
}

interface Account { id: string; code: string; name: string; type: string }

interface Props {
  initial?: Partial<VendorFormValues>
  accounts: Account[]
  onSubmit: (values: VendorFormValues) => Promise<void>
  submitLabel?: string
}

const empty: VendorFormValues = {
  name: '', contact_name: '', email: '', phone: '',
  address_line1: '', city: '', state: '', postal_code: '',
  tax_id: '', payment_terms_days: 30,
  default_expense_account_id: '', notes: '',
}

export function VendorForm({ initial, accounts, onSubmit, submitLabel = 'Save vendor' }: Props) {
  const [values, setValues] = useState<VendorFormValues>({ ...empty, ...initial })
  const [saving, setSaving] = useState(false)
  const expenseAccts = accounts.filter((a) => a.type === 'expense')

  function update<K extends keyof VendorFormValues>(k: K, v: VendorFormValues[K]) {
    setValues((s) => ({ ...s, [k]: v }))
  }

  async function handleSubmit() {
    if (!values.name.trim()) {
      toast.error('Name is required')
      return
    }
    setSaving(true)
    try {
      await onSubmit(values)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Vendor</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="v-name" required>Name</Label>
            <Input id="v-name" value={values.name} onChange={(e) => update('name', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-contact">Contact name</Label>
            <Input id="v-contact" value={values.contact_name} onChange={(e) => update('contact_name', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-email">Email</Label>
            <Input id="v-email" type="email" value={values.email} onChange={(e) => update('email', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-phone">Phone</Label>
            <Input id="v-phone" value={values.phone} onChange={(e) => update('phone', e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Address</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-4 gap-3">
          <div className="md:col-span-4 space-y-1.5">
            <Label htmlFor="v-addr">Street</Label>
            <Input id="v-addr" value={values.address_line1} onChange={(e) => update('address_line1', e.target.value)} />
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label htmlFor="v-city">City</Label>
            <Input id="v-city" value={values.city} onChange={(e) => update('city', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-state">State</Label>
            <Input id="v-state" value={values.state} onChange={(e) => update('state', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-zip">ZIP</Label>
            <Input id="v-zip" value={values.postal_code} onChange={(e) => update('postal_code', e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Tax &amp; payment</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="v-tax">Tax ID (EIN/SSN)</Label>
            <Input id="v-tax" value={values.tax_id} onChange={(e) => update('tax_id', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-terms">Payment terms (days)</Label>
            <Input
              id="v-terms"
              type="number"
              value={values.payment_terms_days}
              onChange={(e) => update('payment_terms_days', Number.parseInt(e.target.value, 10) || 0)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-acct">Default expense account</Label>
            <select id="v-acct"
              value={values.default_expense_account_id}
              onChange={(e) => update('default_expense_account_id', e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
            >
              <option value="">— pick —</option>
              {expenseAccts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
        <CardContent>
          <Textarea value={values.notes} onChange={(e) => update('notes', e.target.value)} rows={3} />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button onClick={handleSubmit} disabled={saving}>
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
