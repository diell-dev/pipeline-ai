'use client'

/**
 * Books → Payment detail. Read-only summary with a Void button.
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
  notes: string | null
  deposit_account: { id: string; code: string; name: string } | null
}

export default function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [payment, setPayment] = useState<Payment | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/books/payments/${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setPayment(data.payment as Payment)
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
      const res = await fetch(`/api/books/payments/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success('Payment voided & reversed')
      router.push('/books/payments')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (loading) return <Skeleton className="h-64 w-full" />
  if (!payment) return <p className="text-sm text-muted-foreground">Payment not found.</p>

  const sourceLink =
    payment.source_type === 'invoice' && payment.source_id
      ? `/books/invoices/${payment.source_id}`
      : payment.source_type === 'bill' && payment.source_id
        ? `/books/bills/${payment.source_id}`
        : null

  return (
    <div className="space-y-4">
      <PageHeader
        title={payment.payment_number}
        subtitle={`${formatCurrency(payment.amount_cents)} · ${payment.payment_method}`}
        breadcrumb={[
          { label: 'Books', href: '/books' },
          { label: 'Payments', href: '/books/payments' },
          { label: payment.payment_number },
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
          <KV label="Date" value={formatDate(payment.payment_date)} />
          <KV label="Type"><Badge variant="outline">{payment.type}</Badge></KV>
          <KV label="Method" value={payment.payment_method} />
          <KV label="Amount" value={formatCurrency(payment.amount_cents)} strong />
          <KV label="Reference" value={payment.reference ?? '—'} />
          <KV label="Deposit account" value={
            payment.deposit_account
              ? `${payment.deposit_account.code} · ${payment.deposit_account.name}`
              : '—'
          } />
          <KV label="Source">
            {sourceLink ? (
              <Link className="text-brand-primary hover:underline" href={sourceLink}>
                Open {payment.source_type}
              </Link>
            ) : (
              <span className="capitalize">{payment.source_type}</span>
            )}
          </KV>
        </CardContent>
      </Card>

      {payment.notes && (
        <Card>
          <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
          <CardContent><p className="text-sm whitespace-pre-wrap">{payment.notes}</p></CardContent>
        </Card>
      )}

      <Dialog open={confirmDelete} onOpenChange={(o) => !deleting && setConfirmDelete(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void payment {payment.payment_number}?</DialogTitle>
            <DialogDescription>Posts a reversing journal entry.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleVoid} disabled={deleting}>
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
