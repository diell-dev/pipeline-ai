'use client'

/**
 * Books → Expenses list. Quick one-off costs.
 */
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonList } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { CreditCard, Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/books/format'

interface Expense {
  id: string
  expense_date: string
  description: string | null
  total_cents: number
  is_reimbursable: boolean
  is_reimbursed: boolean
  vendor: { id: string; name: string } | null
  category: { id: string; name: string } | null
  expense_account: { id: string; code: string; name: string } | null
}

const PAGE_SIZE = 20

export default function ExpensesListPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(page * PAGE_SIZE))
      const res = await fetch(`/api/books/expenses?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setRows(data.expenses as Expense[])
      setTotal(data.total ?? 0)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [page])
  useEffect(() => { load() }, [load])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Expenses"
        subtitle="One-off receipts. Snap a photo on mobile and it lands here."
        actions={
          <Link href="/books/expenses/new">
            <Button><Plus className="mr-1 h-4 w-4" />Add expense</Button>
          </Link>
        }
      />

      {loading ? (
        <SkeletonList rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No expenses yet"
          description="Track gas, supplies, parking — anything paid right from a card or cash."
          action={<Link href="/books/expenses/new"><Button>Add expense</Button></Link>}
        />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {rows.map((r) => (
              <button
                key={r.id}
                onClick={() => router.push(`/books/expenses/${r.id}`)}
                className="w-full text-left rounded-lg border bg-card p-3 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{r.description ?? '—'}</p>
                  <span className="font-medium tabular-nums">{formatCurrency(r.total_cents)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDate(r.expense_date)} · {r.vendor?.name ?? r.expense_account?.name ?? '—'}
                </p>
                {r.is_reimbursable && (
                  <Badge variant="outline" className="text-[10px]">
                    {r.is_reimbursed ? 'reimbursed' : 'reimbursable'}
                  </Badge>
                )}
              </button>
            ))}
          </div>
          {/* Desktop */}
          <div className="hidden md:block border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Description</th>
                  <th className="text-left px-3 py-2 font-medium">Vendor / Account</th>
                  <th className="text-center px-3 py-2 font-medium">Flags</th>
                  <th className="text-right px-3 py-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b last:border-0 hover:bg-muted cursor-pointer"
                    onClick={() => router.push(`/books/expenses/${r.id}`)}
                  >
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(r.expense_date)}</td>
                    <td className="px-3 py-2">{r.description ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.vendor?.name ?? r.expense_account?.name ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.is_reimbursable && (
                        <Badge variant="outline" className="text-[10px]">
                          {r.is_reimbursed ? 'reimbursed' : 'reimbursable'}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{formatCurrency(r.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
