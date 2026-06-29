'use client'

/**
 * Books → Bill detail. Mirrors the invoice detail page (header, lines,
 * payments, journal-entry link, void action).
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
import { Loader2, Lock, Printer, Receipt, Trash2 } from 'lucide-react'
import { formatCurrency, formatDate, dollarsToCents } from '@/lib/books/format'
import { todayIso } from '@/lib/books/format-helpers'

interface Bill {
  id: string
  organization_id: string
  internal_number: string
  bill_number: string | null
  bill_date: string
  due_date: string | null
  status: 'draft' | 'open' | 'partially_paid' | 'paid' | 'void'
  subtotal_cents: number
  tax_amount_cents: number
  total_cents: number
  amount_paid_cents: number
  balance_due_cents: number
  locked_at: string | null
  notes: string | null
  vendor: { id: string; name: string; email: string | null } | null
}

interface Line {
  id: string
  description: string | null
  quantity: number
  unit_price_cents: number
  total_cents: number
  account?: { code: string; name: string } | null
}

interface Account { id: string; code: string; name: string; type: string }

export default function BookBillDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [bill, setBill] = useState<Bill | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [journal, setJournal] = useState<{ entry_number: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [confirmVoid, setConfirmVoid] = useState(false)
  const [payOpen, setPayOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/books/bills/${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setBill(data.bill as Bill)
      setLines(data.lines as Line[])
      setJournal(data.journal as { entry_number: string } | null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function handleVoid() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/books/bills/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success('Bill voided & reversed in GL')
      router.push('/books/bills')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setDeleting(false)
      setConfirmVoid(false)
    }
  }

  if (loading) return <Skeleton className="h-64 w-full" />
  if (!bill) return <p className="text-sm text-muted-foreground">Bill not found.</p>

  const canPay = bill.balance_due_cents > 0 && bill.status !== 'void' && bill.status !== 'draft'

  return (
    <div className="space-y-4 print:space-y-2">
      <PageHeader
        title={bill.internal_number}
        subtitle={bill.vendor?.name ?? undefined}
        breadcrumb={[
          { label: 'Books', href: '/books' },
          { label: 'Bills', href: '/books/bills' },
          { label: bill.internal_number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <StatusBadge status={bill.status} type="bill" />
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1 h-4 w-4" /> Print
            </Button>
            {canPay && (
              <Button onClick={() => setPayOpen(true)}>
                <Receipt className="mr-1 h-4 w-4" /> Pay bill
              </Button>
            )}
            {bill.status !== 'void' && (
              <Button variant="destructive" onClick={() => setConfirmVoid(true)}>
                <Trash2 className="mr-1 h-4 w-4" /> Void
              </Button>
            )}
          </div>
        }
      />

      {bill.locked_at && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200 print:hidden">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            This period was locked on {formatDate(bill.locked_at)}. Unlock in{' '}
            <a href="/books/settings" className="underline underline-offset-2">Books → Settings</a>{' '}
            to edit.
          </p>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Header</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-y-2 gap-x-6 text-sm">
          <KV label="Vendor" value={bill.vendor?.name ?? '—'} />
          <KV label="Vendor bill #" value={bill.bill_number ?? '—'} />
          <KV label="Date" value={formatDate(bill.bill_date)} />
          <KV label="Due" value={bill.due_date ? formatDate(bill.due_date) : '—'} />
          {journal && <KV label="Journal entry"><span className="font-mono">{journal.entry_number}</span></KV>}
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
                  <td className="py-2 text-right tabular-nums font-medium">{formatCurrency(l.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 max-w-xs ml-auto space-y-1 text-sm">
            <KV label="Subtotal" value={formatCurrency(bill.subtotal_cents)} />
            <KV label="Tax" value={formatCurrency(bill.tax_amount_cents)} />
            <KV label="Total" value={formatCurrency(bill.total_cents)} strong />
            <KV label="Paid" value={formatCurrency(bill.amount_paid_cents)} />
            <KV label="Balance due" value={formatCurrency(bill.balance_due_cents)} strong />
          </div>
        </CardContent>
      </Card>

      {bill.notes && (
        <Card>
          <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{bill.notes}</p>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmVoid} onOpenChange={(o) => !deleting && setConfirmVoid(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void bill {bill.internal_number}?</DialogTitle>
            <DialogDescription>
              Posts a reversing journal entry to keep the ledger balanced.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmVoid(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleVoid} disabled={deleting}>
              {deleting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Voiding…</> : 'Void bill'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PayBillDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        bill={bill}
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

function PayBillDialog({
  open, onOpenChange, bill, onSuccess,
}: { open: boolean; onOpenChange: (b: boolean) => void; bill: Bill; onSuccess: () => void }) {
  const [submitting, setSubmitting] = useState(false)
  const [amount, setAmount] = useState((bill.balance_due_cents / 100).toFixed(2))
  const [date, setDate] = useState(todayIso())
  const [method, setMethod] = useState('check')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState('')

  useEffect(() => {
    if (!open) return
    fetch('/api/books/accounts').then((r) => r.json()).then((data) => {
      const banks = (data.accounts as Account[]).filter(
        (a) => a.type === 'asset' && ['1000', '1010', '1020', '2100'].includes(a.code)
      )
      setAccounts(banks)
      if (banks[0]) setAccountId(banks[0].id)
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
          type: 'bill_payment',
          source_type: 'bill',
          source_id: bill.id,
          amount_cents: cents,
          payment_method: method,
          deposit_to_account_id: accountId || null,
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
          <DialogTitle>Pay bill</DialogTitle>
          <DialogDescription>For bill {bill.internal_number}.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="b-amt">Amount</Label>
            <Input id="b-amt" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-date">Date</Label>
            <Input id="b-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-method">Method</Label>
            <select id="b-method" value={method} onChange={(e) => setMethod(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm">
              {['cash', 'check', 'ach', 'wire', 'credit_card', 'debit_card', 'other'].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-account">Pay from</Label>
            <select id="b-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm">
              <option value="">— default operating bank —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Saving…</> : 'Pay bill'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
