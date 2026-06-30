'use client'

/**
 * Books → Bills list. Mirrors invoices list but for AP.
 */
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonList } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/ui/status-badge'
import { toast } from 'sonner'
import { ReceiptText, Plus, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/books/format'
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh'

interface BillRow {
  id: string
  internal_number: string
  bill_number: string | null
  bill_date: string
  due_date: string | null
  status: 'draft' | 'open' | 'partially_paid' | 'paid' | 'void'
  total_cents: number
  balance_due_cents: number
  vendor: { id: string; name: string } | null
}

const PAGE_SIZE = 20

export default function BooksBillsListPage() {
  const router = useRouter()
  const [rows, setRows] = useState<BillRow[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(page * PAGE_SIZE))
      if (status) params.set('status', status)
      const res = await fetch(`/api/books/bills?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setRows(data.bills as BillRow[])
      setTotal(data.total ?? 0)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [page, status])

  useEffect(() => { load() }, [load])

  const { PullIndicator } = usePullToRefresh({ onRefresh: load })

  const filtered = search.trim()
    ? rows.filter((r) => {
        const q = search.toLowerCase()
        return (
          r.internal_number.toLowerCase().includes(q) ||
          (r.bill_number ?? '').toLowerCase().includes(q) ||
          (r.vendor?.name ?? '').toLowerCase().includes(q)
        )
      })
    : rows

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="relative space-y-4">
      <PullIndicator />
      <PageHeader
        title="Bills"
        subtitle="Vendor bills (AP). Posts a debit to expense + credit to Accounts Payable on save."
        actions={
          <Link href="/books/bills/new">
            <Button><Plus className="mr-1 h-4 w-4" />New bill</Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search bill # or vendor"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(0) }}
          className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="open">Open</option>
          <option value="partially_paid">Partially paid</option>
          <option value="paid">Paid</option>
          <option value="void">Void</option>
        </select>
        <span className="text-xs text-muted-foreground">{total} total</span>
      </div>

      {loading ? (
        <SkeletonList rows={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="No bills yet"
          description="Record vendor invoices here. They show up on cash-flow forecasts and the AP aging report."
          action={<Link href="/books/bills/new"><Button>Record bill</Button></Link>}
        />
      ) : (
        <>
          {/* Mobile */}
          <div className="md:hidden space-y-2">
            {filtered.map((r) => (
              <button
                key={r.id}
                onClick={() => router.push(`/books/bills/${r.id}`)}
                className="w-full text-left rounded-lg border bg-card p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-medium">{r.internal_number}</span>
                  <StatusBadge status={r.status} type="bill" />
                </div>
                <p className="text-sm truncate">{r.vendor?.name ?? '—'}</p>
                <div className="flex items-center justify-between text-sm">
                  <span>Total: <span className="font-medium">{formatCurrency(r.total_cents)}</span></span>
                  <span className="text-muted-foreground">Bal: {formatCurrency(r.balance_due_cents)}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden md:block border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-3 py-2 font-medium">Internal #</th>
                  <th className="text-left px-3 py-2 font-medium">Vendor #</th>
                  <th className="text-left px-3 py-2 font-medium">Vendor</th>
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Due</th>
                  <th className="text-right px-3 py-2 font-medium">Total</th>
                  <th className="text-right px-3 py-2 font-medium">Balance</th>
                  <th className="text-center px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b last:border-0 hover:bg-muted cursor-pointer"
                    onClick={() => router.push(`/books/bills/${r.id}`)}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{r.internal_number}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.bill_number ?? '—'}</td>
                    <td className="px-3 py-2">{r.vendor?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(r.bill_date)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.due_date ? formatDate(r.due_date) : '—'}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(r.total_cents)}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{formatCurrency(r.balance_due_cents)}</td>
                    <td className="px-3 py-2 text-center">
                      <StatusBadge status={r.status} type="bill" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm"
                  disabled={page >= totalPages - 1}
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
