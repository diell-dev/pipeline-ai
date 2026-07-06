'use client'

/**
 * Books → Invoice → Edit (header fields).
 *
 * Edits the safe header fields the PATCH /api/books/invoices/[id] route
 * accepts (dates, terms, PO, customer/internal notes). Line-item edits go
 * through the invoice builder; this page intentionally does not touch them.
 * Fixes the previously-dead "Edit" button that routed to a 404. (M2)
 */
import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/ui/page-header'
import { SkeletonList } from '@/components/ui/skeleton'
import { toast } from 'sonner'

interface InvoiceHeader {
  id: string
  invoice_number: string
  status: string
  invoice_date: string | null
  due_date: string | null
  po_number: string | null
  payment_terms_text: string | null
  payment_terms_days: number | null
  notes_for_customer: string | null
  notes_internal: string | null
  locked_at: string | null
}

export default function EditInvoicePage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params.id

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [inv, setInv] = useState<InvoiceHeader | null>(null)

  const [form, setForm] = useState({
    invoice_date: '',
    due_date: '',
    po_number: '',
    payment_terms_text: '',
    payment_terms_days: '',
    notes_for_customer: '',
    notes_internal: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/books/invoices/${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load invoice')
      const i = data.invoice as InvoiceHeader
      setInv(i)
      setForm({
        invoice_date: i.invoice_date ?? '',
        due_date: i.due_date ?? '',
        po_number: i.po_number ?? '',
        payment_terms_text: i.payment_terms_text ?? '',
        payment_terms_days: i.payment_terms_days != null ? String(i.payment_terms_days) : '',
        notes_for_customer: i.notes_for_customer ?? '',
        notes_internal: i.notes_internal ?? '',
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load invoice')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function save() {
    if (!inv) return
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        invoice_date: form.invoice_date || null,
        due_date: form.due_date || null,
        po_number: form.po_number || null,
        payment_terms_text: form.payment_terms_text || null,
        payment_terms_days: form.payment_terms_days ? Number(form.payment_terms_days) : null,
        notes_for_customer: form.notes_for_customer || null,
        notes_internal: form.notes_internal || null,
      }
      const res = await fetch(`/api/books/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      toast.success('Invoice updated')
      router.push(`/books/invoices/${id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-4"><SkeletonList /></div>
  if (!inv) return null

  const locked = !!inv.locked_at

  return (
    <div className="mx-auto max-w-2xl p-4 space-y-6">
      <PageHeader
        title={`Edit ${inv.invoice_number}`}
        subtitle="Update invoice header details. Line items are edited from the invoice builder."
      />

      {locked && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This invoice is locked and can&apos;t be edited.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="invoice_date">Invoice date</Label>
          <Input id="invoice_date" type="date" value={form.invoice_date}
            onChange={(e) => setForm((f) => ({ ...f, invoice_date: e.target.value }))} disabled={locked} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="due_date">Due date</Label>
          <Input id="due_date" type="date" value={form.due_date}
            onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} disabled={locked} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="po_number">PO number</Label>
          <Input id="po_number" value={form.po_number}
            onChange={(e) => setForm((f) => ({ ...f, po_number: e.target.value }))} disabled={locked} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="payment_terms_days">Payment terms (days)</Label>
          <Input id="payment_terms_days" type="number" min="0" value={form.payment_terms_days}
            onChange={(e) => setForm((f) => ({ ...f, payment_terms_days: e.target.value }))} disabled={locked} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="payment_terms_text">Payment terms (text)</Label>
          <Input id="payment_terms_text" value={form.payment_terms_text}
            onChange={(e) => setForm((f) => ({ ...f, payment_terms_text: e.target.value }))} disabled={locked} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="notes_for_customer">Notes for customer</Label>
          <Textarea id="notes_for_customer" rows={3} value={form.notes_for_customer}
            onChange={(e) => setForm((f) => ({ ...f, notes_for_customer: e.target.value }))} disabled={locked} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="notes_internal">Internal notes</Label>
          <Textarea id="notes_internal" rows={3} value={form.notes_internal}
            onChange={(e) => setForm((f) => ({ ...f, notes_internal: e.target.value }))} disabled={locked} />
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={() => router.push(`/books/invoices/${id}`)} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving || locked}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}
