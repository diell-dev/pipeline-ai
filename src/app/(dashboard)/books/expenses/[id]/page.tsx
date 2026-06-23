'use client'

/**
 * Books → Expense detail. Minimal — show the captured fields and a
 * Void button. Editing existing expenses isn't supported in this pass
 * (delete + re-enter keeps the audit trail clean).
 */
import { useEffect, useState, use, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Loader2, Trash2 } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/books/format'

interface Expense {
  id: string
  expense_date: string
  description: string | null
  amount_cents: number
  tax_amount_cents: number
  total_cents: number
  receipt_url: string | null
  is_reimbursable: boolean
  is_reimbursed: boolean
  vendor: { id: string; name: string } | null
  category: { id: string; name: string } | null
  expense_account: { id: string; code: string; name: string } | null
  payment_account: { id: string; code: string; name: string } | null
}

export default function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [expense, setExpense] = useState<Expense | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/books/expenses/${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setExpense(data.expense as Expense)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [id])
  useEffect(() => { load() }, [load])

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/books/expenses/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success('Expense voided & reversed')
      router.push('/books/expenses')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (loading) return <Skeleton className="h-64 w-full" />
  if (!expense) return <p className="text-sm text-muted-foreground">Expense not found.</p>

  return (
    <div className="space-y-4">
      <PageHeader
        title={expense.description ?? 'Expense'}
        subtitle={formatDate(expense.expense_date)}
        breadcrumb={[
          { label: 'Books', href: '/books' },
          { label: 'Expenses', href: '/books/expenses' },
          { label: 'Detail' },
        ]}
        actions={
          <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="mr-1 h-4 w-4" /> Void
          </Button>
        }
      />

      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-y-2 gap-x-6 text-sm">
          <KV label="Vendor" value={expense.vendor?.name ?? '—'} />
          <KV label="Category" value={expense.category?.name ?? '—'} />
          <KV label="Expense account" value={
            expense.expense_account
              ? `${expense.expense_account.code} · ${expense.expense_account.name}`
              : '—'
          } />
          <KV label="Paid from" value={
            expense.payment_account
              ? `${expense.payment_account.code} · ${expense.payment_account.name}`
              : '—'
          } />
          <KV label="Amount" value={formatCurrency(expense.amount_cents)} />
          <KV label="Tax" value={formatCurrency(expense.tax_amount_cents)} />
          <KV label="Total" value={formatCurrency(expense.total_cents)} strong />
          <KV label="Reimbursable">
            {expense.is_reimbursable
              ? <Badge variant="outline">{expense.is_reimbursed ? 'reimbursed' : 'pending'}</Badge>
              : '—'}
          </KV>
        </CardContent>
      </Card>

      {expense.receipt_url && (
        <Card>
          <CardHeader><CardTitle>Receipt</CardTitle></CardHeader>
          <CardContent>
            <Link href={expense.receipt_url} target="_blank" className="text-brand-primary hover:underline text-sm">
              Open receipt
            </Link>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmDelete} onOpenChange={(o) => !deleting && setConfirmDelete(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void this expense?</DialogTitle>
            <DialogDescription>Posts a reversing journal entry.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Voiding…</> : 'Void'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
