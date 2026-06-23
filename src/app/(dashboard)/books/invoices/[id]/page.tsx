'use client'

/**
 * Books → Invoice detail. Shows header, line items, applied payments,
 * journal-entry link, and the lifecycle action buttons.
 *
 * The "Record payment" button opens a Dialog (responsive bottom sheet on
 * mobile) and POSTs to /api/books/payments. The "Void" button calls the
 * soft-delete-and-reverse path on /api/books/invoices/[id] DELETE.
 */
import { useEffect, useState, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/ui/status-badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogBody,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Loader2, Printer, Receipt, Trash2 } from 'lucide-react'
import { formatCurrency, formatDate, dollarsToCents } from '@/lib/books/format'
import { todayIso } from '@/lib/books/format-helpers'
import type { InvoiceStatus } from '@/types/database'

interface Invoice {
  id: string
  organization_id: string
  invoice_number: string
  invoice_date: string
  due_date: string | null
  status: InvoiceStatus
  total_cents: number
  subtotal_cents: number
  tax_amount_cents: number
  amount_paid_cents: number
  balance_due_cents: number
  notes_for_customer: string | null
  notes_internal: string | null
  po_number: string | null
  locked_at: string | null
  clients: {
    id: string
    company_name: string
    billing_contact_email: string | null
    primary_contact_email: string | null
  } | null
}

interface Line {
  id: string
  description: string | null
  quantity: number
  unit_price_cents: number
  total_cents: number
  account?: { code: string; name: string } | null
}

interface Payment {
  id: string
  payment_number: string
  payment_date: string
  amount_cents: number
  payment_method: string
}

interface Journal {
  id: string
  entry_number: string
  entry_date: string
}

interface Account { id: string; code: string; name: string; type: string }

export default function BooksInvoiceDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [journal, setJournal] = useState<Journal | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [confirmVoid, setConfirmVoid] = useState(false)
  const [payOpen, setPayOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/books/invoices/${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setInvoice(data.invoice as Invoice)
      setLines(data.lines as Line[])
      setPayments(data.payments as Payment[])
      setJournal(data.journal as Journal | null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function handleVoid() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/books/invoices/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to void')
      toast.success('Invoice voided & reversed in GL')
      router.push('/books/invoices')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to void')
    } finally {
      setDeleting(false)
      setConfirmVoid(false)
    }
  }

  if (loading) {
    return <Skeleton className="h-64 w-full" />
  }
  if (!invoice) {
    return <p className="text-sm text-muted-foreground">Invoice not found.</p>
  }

  const canEdit = !invoice.locked_at && invoice.status !== 'void' && invoice.status !== 'paid'
  const canPay = invoice.balance_due_cents > 0 && invoice.status !== 'void' && invoice.status !== 'draft'

  return (
    <div className="space-y-4 print:space-y-2">
      <PageHeader
        title={invoice.invoice_number}
        subtitle={invoice.clients?.company_name ?? undefined}
        breadcrumb={[
          { label: 'Books', href: '/books' },
          { label: 'Invoices', href: '/books/invoices' },
          { label: invoice.invoice_number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <StatusBadge status={invoice.status} type="invoice" />
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1 h-4 w-4" /> Print
            </Button>
            {canPay && (
              <Button onClick={() => setPayOpen(true)}>
                <Receipt className="mr-1 h-4 w-4" /> Record payment
              </Button>
            )}
            {canEdit && (
              <Button variant="destructive" onClick={() => setConfirmVoid(true)}>
                <Trash2 className="mr-1 h-4 w-4" /> Void
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <CardHeader><CardTitle>Header</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-y-2 gap-x-6 text-sm">
          <KV label="Client" value={invoice.clients?.company_name ?? '—'} />
          <KV label="Status"><StatusBadge status={invoice.status} type="invoice" /></KV>
          <KV label="Date" value={formatDate(invoice.invoice_date)} />
          <KV label="Due" value={invoice.due_date ? formatDate(invoice.due_date) : '—'} />
          {invoice.po_number && <KV label="PO #" value={invoice.po_number} />}
          {journal && (
            <KV label="Journal entry"><span className="font-mono">{journal.entry_number}</span></KV>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Line items</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 font-medium">Description</th>
                <th className="py-2 font-medium">Account</th>
                <th className="py-2 font-medium text-right">Qty</th>
                <th className="py-2 font-medium text-right">Unit</th>
                <th className="py-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="py-2">{l.description ?? '—'}</td>
                  <td className="py-2 text-muted-foreground">
                    {l.account ? `${l.account.code} · ${l.account.name}` : '—'}
                  </td>
                  <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                  <td className="py-2 text-right tabular-nums">{formatCurrency(l.unit_price_cents)}</td>
                  <td className="py-2 text-right tabular-nums font-medium">
                    {formatCurrency(l.total_cents)}
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-muted-foreground text-xs">No lines.</td></tr>
              )}
            </tbody>
          </table>

          <div className="mt-4 max-w-xs ml-auto space-y-1 text-sm">
            <KV label="Subtotal" value={formatCurrency(invoice.subtotal_cents)} />
            <KV label="Tax" value={formatCurrency(invoice.tax_amount_cents)} />
            <KV label="Total" value={formatCurrency(invoice.total_cents)} strong />
            <KV label="Paid" value={formatCurrency(invoice.amount_paid_cents)} />
            <KV label="Balance due" value={formatCurrency(invoice.balance_due_cents)} strong />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Payments applied</CardTitle></CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <ul className="divide-y">
              {payments.map((p) => (
                <li key={p.id} className="py-2 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-mono">{p.payment_number}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(p.payment_date)} · {p.payment_method}</p>
                  </div>
                  <span className="text-sm font-medium">{formatCurrency(p.amount_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {invoice.notes_for_customer && (
        <Card>
          <CardHeader><CardTitle>Notes for customer</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{invoice.notes_for_customer}</p>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmVoid} onOpenChange={(o) => !deleting && setConfirmVoid(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void invoice {invoice.invoice_number}?</DialogTitle>
            <DialogDescription>
              Marks the invoice as void and posts a reversing journal entry so the ledger stays balanced. The invoice number is preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmVoid(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleVoid} disabled={deleting}>
              {deleting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Voiding…</> : 'Void invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecordPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        invoice={invoice}
        onSuccess={() => { setPayOpen(false); load() }}
      />
    </div>
  )
}

function KV({ label, value, children, strong }: {
  label: string; value?: React.ReactNode; children?: React.ReactNode; strong?: boolean
}) {
  return (
    <div className="flex justify-between border-b last:border-0 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'font-semibold' : ''}>{children ?? value}</span>
    </div>
  )
}

function RecordPaymentDialog({
  open, onOpenChange, invoice, onSuccess,
}: {
  open: boolean; onOpenChange: (b: boolean) => void
  invoice: Invoice; onSuccess: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [amount, setAmount] = useState((invoice.balance_due_cents / 100).toFixed(2))
  const [date, setDate] = useState(todayIso())
  const [method, setMethod] = useState('check')
  const [reference, setReference] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [depositAccountId, setDepositAccountId] = useState('')

  useEffect(() => {
    if (!open) return
    fetch('/api/books/accounts').then((r) => r.json()).then((data) => {
      const banks = (data.accounts as Account[]).filter(
        (a) => a.type === 'asset' && ['1000', '1010', '1020'].includes(a.code)
      )
      setAccounts(banks)
      if (banks[0]) setDepositAccountId(banks[0].id)
    })
  }, [open])

  async function submit() {
    setSubmitting(true)
    try {
      const cents = dollarsToCents(amount)
      if (cents <= 0) throw new Error('Amount must be > 0')
      const res = await fetch('/api/books/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_date: date,
          type: 'invoice_payment',
          source_type: 'invoice',
          source_id: invoice.id,
          amount_cents: cents,
          payment_method: method,
          deposit_to_account_id: depositAccountId || null,
          reference: reference || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success(`Payment ${data.payment.payment_number} recorded`)
      onSuccess()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            For invoice {invoice.invoice_number}. Posts to the GL on save.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Amount</Label>
            <Input id="pay-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-date">Date</Label>
            <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-method">Method</Label>
            <select
              id="pay-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
            >
              {['cash', 'check', 'ach', 'wire', 'credit_card', 'debit_card', 'other'].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-account">Deposit to</Label>
            <select
              id="pay-account"
              value={depositAccountId}
              onChange={(e) => setDepositAccountId(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
            >
              <option value="">— default operating bank —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-ref">Reference (optional)</Label>
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Check #4521, txn id, etc." />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Saving…</> : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
