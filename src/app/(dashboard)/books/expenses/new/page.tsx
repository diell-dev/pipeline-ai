'use client'

/**
 * Books → New expense. Quick form — category + amount + receipt URL.
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
import { ChevronLeft, Loader2, Save } from 'lucide-react'
import { todayIso } from '@/lib/books/format-helpers'

interface Account { id: string; code: string; name: string; type: string }
interface Vendor { id: string; name: string }

export default function NewExpensePage() {
  const router = useRouter()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [expenseDate, setExpenseDate] = useState(todayIso())
  const [description, setDescription] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [expenseAccountId, setExpenseAccountId] = useState('')
  const [paymentAccountId, setPaymentAccountId] = useState('')
  const [amount, setAmount] = useState('0.00')
  const [taxAmount, setTaxAmount] = useState('0.00')
  const [receiptUrl, setReceiptUrl] = useState('')
  const [reimbursable, setReimbursable] = useState(false)

  useEffect(() => {
    let cancel = false
    async function load() {
      const [a, v] = await Promise.all([
        fetch('/api/books/accounts').then((r) => r.json()),
        fetch('/api/books/vendors').then((r) => r.json()),
      ])
      if (cancel) return
      setAccounts((a.accounts ?? []) as Account[])
      setVendors((v.vendors ?? []) as Vendor[])
      setLoading(false)
    }
    load()
    return () => { cancel = true }
  }, [])

  const expenseAccounts = accounts.filter((a) => a.type === 'expense')
  const payAccounts = accounts.filter((a) =>
    a.type === 'asset' && ['1000', '1010', '1020', '2100'].includes(a.code)
  )

  async function submit() {
    setSaving(true)
    try {
      const res = await fetch('/api/books/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expense_date: expenseDate,
          description: description || null,
          vendor_id: vendorId || null,
          expense_account_id: expenseAccountId || null,
          payment_account_id: paymentAccountId || null,
          amount,
          tax_amount: taxAmount,
          receipt_url: receiptUrl || null,
          is_reimbursable: reimbursable,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success('Expense recorded')
      router.push(`/books/expenses/${data.expense.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="New expense"
        breadcrumb={[
          { label: 'Books', href: '/books' },
          { label: 'Expenses', href: '/books/expenses' },
          { label: 'New' },
        ]}
      />

      <Card>
        <CardHeader><CardTitle>Expense</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="e-date">Date</Label>
            <Input id="e-date" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-vendor">Vendor (optional)</Label>
            <select id="e-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm">
              <option value="">— none —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label htmlFor="e-desc">Description</Label>
            <Input id="e-desc" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What was this for?" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-acct">Expense account</Label>
            <select id="e-acct" value={expenseAccountId} onChange={(e) => setExpenseAccountId(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm">
              <option value="">— default (Misc) —</option>
              {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-pay">Paid from</Label>
            <select id="e-pay" value={paymentAccountId} onChange={(e) => setPaymentAccountId(e.target.value)}
              disabled={reimbursable}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm">
              <option value="">— default operating bank —</option>
              {payAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-amount">Amount</Label>
            <Input id="e-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-tax">Tax amount (recoverable)</Label>
            <Input id="e-tax" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} inputMode="decimal" />
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label htmlFor="e-receipt">Receipt URL (paste link or upload to storage)</Label>
            <Input id="e-receipt" value={receiptUrl} onChange={(e) => setReceiptUrl(e.target.value)}
              placeholder="https://…" />
            {/* Mobile camera capture: use the system file picker which on
                iOS / Android exposes the camera as a source. */}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="text-xs text-muted-foreground"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  toast.message('Receipt selected — upload-to-storage wiring is part of B5.')
                }
              }}
            />
          </div>
          <div className="md:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={reimbursable} onChange={(e) => setReimbursable(e.target.checked)} />
              I paid this out of pocket — reimburse me later
            </label>
          </div>
        </CardContent>
      </Card>

      <Textarea placeholder="Internal notes…" />

      <div className="flex justify-between gap-2">
        <Link href="/books/expenses">
          <Button variant="outline" disabled={saving}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Cancel
          </Button>
        </Link>
        <Button onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          Save expense
        </Button>
      </div>
    </div>
  )
}
