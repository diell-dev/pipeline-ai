'use client'

/**
 * Books → Payments list (all sources: Stripe + manual + check + ACH).
 * Read-only here. To record a new payment, open an invoice/bill detail
 * page and use the "Record payment" action — that's the path that knows
 * which source row to apply against.
 */
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonList } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { Wallet, ChevronLeft, ChevronRight } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/books/format'

interface Payment {
  id: string
  payment_number: string
  payment_date: string
  type: string
  source_type: string
  source_id: string | null
  amount_cents: number
  payment_method: string
  reference: string | null
}

const PAGE_SIZE = 20

export default function PaymentsListPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(page * PAGE_SIZE))
      const res = await fetch(`/api/books/payments?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setRows(data.payments as Payment[])
      setTotal(data.total ?? 0)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [page])
  useEffect(() => { load() }, [load])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function rowLink(r: Payment): string {
    return `/books/payments/${r.id}`
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payments"
        subtitle="Every payment — Stripe, manual, ACH, check. To record a new one, open an invoice or bill."
      />

      {loading ? (
        <SkeletonList rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No payments yet"
          description="Record one against an invoice or bill — it shows up here once posted."
        />
      ) : (
        <>
          <div className="border rounded-lg overflow-hidden hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-3 py-2 font-medium">Payment #</th>
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                  <th className="text-left px-3 py-2 font-medium">Method</th>
                  <th className="text-left px-3 py-2 font-medium">Reference</th>
                  <th className="text-right px-3 py-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b last:border-0 hover:bg-muted cursor-pointer"
                    onClick={() => router.push(rowLink(r))}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{r.payment_number}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(r.payment_date)}</td>
                    <td className="px-3 py-2"><Badge variant="outline">{r.type}</Badge></td>
                    <td className="px-3 py-2 text-muted-foreground">{r.payment_method}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.reference ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{formatCurrency(r.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-2">
            {rows.map((r) => (
              <button
                key={r.id}
                onClick={() => router.push(rowLink(r))}
                className="w-full text-left rounded-lg border bg-card p-3 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{r.payment_number}</span>
                  <span className="font-medium">{formatCurrency(r.amount_cents)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{formatDate(r.payment_date)} · {r.payment_method}</p>
                <Badge variant="outline" className="text-[10px]">{r.type}</Badge>
              </button>
            ))}
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
