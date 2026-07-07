'use client'

/** Invoices — outstanding and paid, RLS-scoped to the client. */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonList } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { formatCurrency, formatDate } from '@/lib/books/format'
import { ReceiptText, ChevronRight } from 'lucide-react'

interface InvRow {
  id: string; invoice_number: string; invoice_date: string | null; due_date: string | null
  status: string; total_cents: number; amount_paid_cents: number; balance_due_cents: number
}

function InvoiceRow({ inv }: { inv: InvRow }) {
  return (
    <Link href={`/portal/invoices/${inv.id}`}>
      <Card className="transition-shadow hover:shadow-md">
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{inv.invoice_number}</p>
            <p className="text-xs text-muted-foreground">
              {inv.invoice_date ? formatDate(inv.invoice_date) : '—'}
              {inv.due_date ? ` · due ${formatDate(inv.due_date)}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-semibold text-foreground">{formatCurrency(inv.total_cents)}</p>
              {inv.balance_due_cents > 0
                ? <p className="text-xs text-red-600">{formatCurrency(inv.balance_due_cents)} due</p>
                : <StatusBadge status={inv.status} type="invoice" />}
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export default function PortalInvoicesPage() {
  const { user } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<InvRow[]>([])

  useEffect(() => {
    if (!user?.client_id) return
    ;(async () => {
      setLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('invoices')
        .select('id, invoice_number, invoice_date, due_date, status, total_cents, amount_paid_cents, balance_due_cents')
        .eq('client_id', user.client_id as string)
        .order('invoice_date', { ascending: false })
      setRows((data as InvRow[]) ?? [])
      setLoading(false)
    })()
  }, [user?.client_id])

  const outstanding = rows.filter((r) => r.balance_due_cents > 0)
  const paid = rows.filter((r) => r.balance_due_cents <= 0)
  const totalDue = outstanding.reduce((s, r) => s + r.balance_due_cents, 0)

  return (
    <div className="space-y-5">
      <PageHeader title="Invoices" subtitle="View and pay your invoices." />

      {loading ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <EmptyState icon={ReceiptText} title="No invoices yet" description="Your invoices will appear here once work is billed." />
      ) : (
        <>
          {outstanding.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Outstanding</h2>
                <span className="text-sm font-semibold text-red-600">{formatCurrency(totalDue)} due</span>
              </div>
              {outstanding.map((inv) => <InvoiceRow key={inv.id} inv={inv} />)}
            </div>
          )}
          {paid.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">Paid</h2>
              {paid.map((inv) => <InvoiceRow key={inv.id} inv={inv} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
