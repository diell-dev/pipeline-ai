'use client'

/**
 * Books → New invoice. Books-mode standalone invoice (no backing job).
 *
 * "Save draft" stores without posting a GL entry. "Save & send" stores
 * and calls POST /api/books/invoices with status='sent', which in turn
 * calls B2's postInvoice helper.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { ChevronLeft, Loader2, Save, Send } from 'lucide-react'
import { LineItemsEditor, emptyLine, type LineRow, computeLineTotalsCents } from '@/components/books/line-items-editor'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/books/format'
import { todayIso, isoOffset } from '@/lib/books/format-helpers'

interface ClientRow { id: string; company_name: string }
interface Account { id: string; code: string; name: string; type: string }

export default function NewBooksInvoicePage() {
  const router = useRouter()
  const { organization } = useAuthStore()

  const [clients, setClients] = useState<ClientRow[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<null | 'draft' | 'sent'>(null)

  const [clientId, setClientId] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(todayIso())
  const [dueDate, setDueDate] = useState(isoOffset(30))
  const [notes, setNotes] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [lines, setLines] = useState<LineRow[]>([emptyLine()])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!organization) return
      const supabase = createClient()
      const [c, a] = await Promise.all([
        supabase
          .from('clients')
          .select('id, company_name')
          .eq('organization_id', organization.id)
          .is('deleted_at', null)
          .order('company_name'),
        fetch('/api/books/accounts').then((r) => r.json()),
      ])
      if (cancelled) return
      setClients((c.data ?? []) as ClientRow[])
      setAccounts(((a.accounts ?? []) as Account[]).filter((x: Account) => x.type === 'income'))
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [organization])

  const totals = lines.reduce(
    (acc, l) => {
      const { subtotalCents, taxCents, totalCents } = computeLineTotalsCents(l)
      acc.subtotal += subtotalCents
      acc.tax += taxCents
      acc.total += totalCents
      return acc
    },
    { subtotal: 0, tax: 0, total: 0 }
  )

  async function save(status: 'draft' | 'sent') {
    if (!clientId) { toast.error('Pick a client'); return }
    const usableLines = lines.filter((l) => {
      const { totalCents } = computeLineTotalsCents(l)
      return totalCents > 0 || l.description.trim() || l.account_id
    })
    if (usableLines.length === 0) { toast.error('Add at least one line item'); return }
    for (const l of usableLines) {
      if (!l.account_id) { toast.error('Every line needs an income account'); return }
    }

    setSaving(status)
    try {
      const res = await fetch('/api/books/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          invoice_date: invoiceDate,
          due_date: dueDate,
          status,
          notes_for_customer: notes || null,
          po_number: poNumber || null,
          lines: usableLines.map((l) => ({
            description: l.description,
            account_id: l.account_id,
            quantity: Number.parseFloat(l.quantity) || 1,
            unit_price: l.unit_price,
            tax_amount_cents: computeLineTotalsCents(l).taxCents,
            is_taxable: l.is_taxable,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      toast.success(`Invoice ${data.invoice.invoice_number} ${status === 'draft' ? 'saved' : 'created & posted'}`)
      router.push(`/books/invoices/${data.invoice.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="New invoice"
        subtitle="Create a books-grade invoice. When you save & send, it auto-posts to the ledger."
        breadcrumb={[
          { label: 'Books', href: '/books' },
          { label: 'Invoices', href: '/books/invoices' },
          { label: 'New' },
        ]}
      />

      <Card>
        <CardHeader><CardTitle>Header</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="client" required>Client</Label>
            <select
              id="client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
            >
              <option value="">— pick a client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="po">PO number</Label>
            <Input id="po" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invDate">Invoice date</Label>
            <Input id="invDate" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dueDate">Due date</Label>
            <Input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Line items</CardTitle></CardHeader>
        <CardContent>
          <LineItemsEditor
            lines={lines}
            onChange={setLines}
            accounts={accounts}
            accountTypeFilter="income"
            disabled={!!saving}
          />
          <div className="mt-4 space-y-1 max-w-xs ml-auto text-sm">
            <Row label="Subtotal" value={formatCurrency(totals.subtotal)} />
            <Row label="Tax" value={formatCurrency(totals.tax)} />
            <Row label="Total" value={formatCurrency(totals.total)} strong />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes shown to the customer on the invoice…"
            rows={3}
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-between gap-2">
        <Link href="/books/invoices">
          <Button variant="outline" disabled={!!saving}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Cancel
          </Button>
        </Link>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => save('draft')} disabled={!!saving}>
            {saving === 'draft' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Save draft
          </Button>
          <Button onClick={() => save('sent')} disabled={!!saving}>
            {saving === 'sent' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
            Save &amp; send
          </Button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between border-b last:border-0 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'font-semibold' : ''}>{value}</span>
    </div>
  )
}
