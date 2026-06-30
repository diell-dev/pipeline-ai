'use client'

/**
 * Books → Invoices list.
 *
 * The bookkeeping-grade replacement for /invoices. Same status palette
 * but driven by the *_cents columns, server-side pagination via
 * /api/books/invoices, and "New invoice" / row drilldown into the books
 * detail pages.
 */
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonList } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/ui/status-badge'
import { toast } from 'sonner'
import {
  FileText, Plus, ChevronLeft, ChevronRight, Search,
} from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/books/format'
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh'
import type { InvoiceStatus } from '@/types/database'

interface InvoiceRow {
  id: string
  invoice_number: string
  invoice_date: string
  due_date: string | null
  status: InvoiceStatus
  total_cents: number
  amount_paid_cents: number
  balance_due_cents: number
  clients: { company_name: string } | null
}

const PAGE_SIZE = 20

export default function BooksInvoicesListPage() {
  const router = useRouter()
  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string>('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(page * PAGE_SIZE))
      if (status) params.set('status', status)
      const res = await fetch(`/api/books/invoices?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setRows(data.invoices as InvoiceRow[])
      setTotal(data.total ?? 0)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [page, status])

  useEffect(() => { load() }, [load])

  // Native-feeling pull-to-refresh on touch devices; no-op on desktop.
  const { PullIndicator } = usePullToRefresh({ onRefresh: load })

  const filtered = search.trim()
    ? rows.filter((r) => {
        const q = search.toLowerCase()
        return (
          r.invoice_number.toLowerCase().includes(q) ||
          (r.clients?.company_name ?? '').toLowerCase().includes(q)
        )
      })
    : rows

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="relative space-y-4">
      <PullIndicator />
      <PageHeader
        title="Invoices"
        subtitle="Operational invoice list — drill in for the journal entry, payments applied, and audit history."
        actions={
          <Link href="/books/invoices/new">
            <Button><Plus className="mr-1 h-4 w-4" />New invoice</Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search invoice # or client"
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
          <option value="sent">Sent</option>
          <option value="partially_paid">Partially paid</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
          <option value="unpaid">Unpaid (any)</option>
          <option value="void">Void</option>
        </select>
        <span className="text-xs text-muted-foreground">{total} total</span>
      </div>

      {loading ? (
        <SkeletonList rows={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No invoices yet"
          description="Create your first books-grade invoice — it'll auto-post to the GL when you mark it as sent."
          action={
            <Link href="/books/invoices/new">
              <Button>Create invoice</Button>
            </Link>
          }
        />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map((r) => (
              <button
                key={r.id}
                onClick={() => router.push(`/books/invoices/${r.id}`)}
                className="w-full text-left rounded-lg border bg-card p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-medium">{r.invoice_number}</span>
                  <StatusBadge status={r.status} type="invoice" />
                </div>
                <p className="text-sm truncate">{r.clients?.company_name ?? '—'}</p>
                <div className="grid grid-cols-2 text-xs text-muted-foreground">
                  <div>Date: {formatDate(r.invoice_date)}</div>
                  <div>Due: {r.due_date ? formatDate(r.due_date) : '—'}</div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>Total: <span className="font-medium">{formatCurrency(r.total_cents)}</span></span>
                  <span className="text-muted-foreground">Bal: {formatCurrency(r.balance_due_cents)}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left font-medium px-3 py-2">Invoice #</th>
                  <th className="text-left font-medium px-3 py-2">Client</th>
                  <th className="text-left font-medium px-3 py-2">Date</th>
                  <th className="text-left font-medium px-3 py-2">Due</th>
                  <th className="text-right font-medium px-3 py-2">Total</th>
                  <th className="text-right font-medium px-3 py-2">Balance</th>
                  <th className="text-center font-medium px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b last:border-0 hover:bg-muted cursor-pointer"
                    onClick={() => router.push(`/books/invoices/${r.id}`)}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{r.invoice_number}</td>
                    <td className="px-3 py-2">{r.clients?.company_name ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(r.invoice_date)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.due_date ? formatDate(r.due_date) : '—'}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(r.total_cents)}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{formatCurrency(r.balance_due_cents)}</td>
                    <td className="px-3 py-2 text-center"><StatusBadge status={r.status} type="invoice" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Page {page + 1} of {totalPages}
              </p>
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
