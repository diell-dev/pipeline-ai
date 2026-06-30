'use client'

/**
 * Books → New bill. Sister of /books/invoices/new but for AP.
 * Line accounts are filtered to expense accounts.
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
import { formatCurrency } from '@/lib/books/format'
import { todayIso, isoOffset } from '@/lib/books/format-helpers'

interface Vendor { id: string; name: string; payment_terms_days: number; default_expense_account_id: string | null }
interface Account { id: string; code: string; name: string; type: string }

export default function NewBillPage() {
  const router = useRouter()
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<null | 'draft' | 'open'>(null)

  const [vendorId, setVendorId] = useState('')
  const [billNumber, setBillNumber] = useState('')
  const [billDate, setBillDate] = useState(todayIso())
  const [dueDate, setDueDate] = useState(isoOffset(30))
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineRow[]>([emptyLine()])

  useEffect(() => {
    let cancel = false
    async function load() {
      const [v, a] = await Promise.all([
        fetch('/api/books/vendors').then((r) => r.json()),
        fetch('/api/books/accounts').then((r) => r.json()),
      ])
      if (cancel) return
      setVendors((v.vendors ?? []) as Vendor[])
      setAccounts(((a.accounts ?? []) as Account[]).filter((x: Account) => x.type === 'expense'))
      setLoading(false)
    }
    load()
    return () => { cancel = true }
  }, [])

  function onVendorChange(id: string) {
    setVendorId(id)
    const v = vendors.find((x) => x.id === id)
    if (v) {
      const terms = v.payment_terms_days ?? 30
      setDueDate(isoOffset(terms))
      if (v.default_expense_account_id && lines.length > 0 && !lines[0].account_id) {
        setLines((prev) => prev.map((l, i) =>
          i === 0 ? { ...l, account_id: v.default_expense_account_id! } : l
        ))
      }
    }
  }

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

  async function save(status: 'draft' | 'open') {
    if (!vendorId) { toast.error('Pick a vendor'); return }
    const usable = lines.filter((l) => {
      const { totalCents } = computeLineTotalsCents(l)
      return totalCents > 0 || l.description.trim() || l.account_id
    })
    if (usable.length === 0) { toast.error('Add at least one line item'); return }
    for (const l of usable) {
      if (!l.account_id) { toast.error('Every line needs an expense account'); return }
    }

    setSaving(status)
    try {
      const res = await fetch('/api/books/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_id: vendorId,
          bill_number: billNumber || null,
          bill_date: billDate,
          due_date: dueDate,
          notes: notes || null,
          status,
          lines: usable.map((l) => ({
            description: l.description,
            account_id: l.account_id,
            tax_rate_id: l.tax_rate_id || null,
            quantity: Number.parseFloat(l.quantity) || 1,
            unit_price: l.unit_price,
            tax_amount_cents: computeLineTotalsCents(l).taxCents,
            is_taxable: l.is_taxable,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success(`Bill ${data.bill.internal_number} ${status === 'draft' ? 'saved' : 'posted'}`)
      router.push(`/books/bills/${data.bill.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="New bill"
        subtitle="Record a vendor bill. Auto-posts to AP when you save & post."
        breadcrumb={[
          { label: 'Books', href: '/books' },
          { label: 'Bills', href: '/books/bills' },
          { label: 'New' },
        ]}
      />

      <Card>
        <CardHeader><CardTitle>Header</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="vendor" required>Vendor</Label>
            <select
              id="vendor"
              value={vendorId}
              onChange={(e) => onVendorChange(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
            >
              <option value="">— pick vendor —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">
              Need a new vendor? <Link href="/books/vendors/new" className="underline">Add one</Link>.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="billnum">Vendor&rsquo;s bill #</Label>
            <Input id="billnum" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} placeholder="e.g. their invoice number" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="billDate" required>Bill date</Label>
            <Input id="billDate" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
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
            accountTypeFilter="expense"
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
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Internal notes…" />
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-between gap-2">
        <Link href="/books/bills">
          <Button variant="outline" disabled={!!saving}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Cancel
          </Button>
        </Link>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => save('draft')} disabled={!!saving}>
            {saving === 'draft' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Save draft
          </Button>
          <Button onClick={() => save('open')} disabled={!!saving}>
            {saving === 'open' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
            Save &amp; post
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
