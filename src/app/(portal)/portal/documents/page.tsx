'use client'

/** Documents — download all invoices (PDF). Reports live on each service visit. */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonList } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { formatCurrency, formatDate } from '@/lib/books/format'
import { FolderOpen, ReceiptText, ChevronRight } from 'lucide-react'

interface InvRow { id: string; invoice_number: string; invoice_date: string | null; total_cents: number }

export default function PortalDocumentsPage() {
  const { user } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [invoices, setInvoices] = useState<InvRow[]>([])

  useEffect(() => {
    if (!user?.client_id) return
    ;(async () => {
      setLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('invoices')
        .select('id, invoice_number, invoice_date, total_cents')
        .eq('client_id', user.client_id as string)
        .order('invoice_date', { ascending: false })
      setInvoices((data as InvRow[]) ?? [])
      setLoading(false)
    })()
  }, [user?.client_id])

  return (
    <div className="space-y-4">
      <PageHeader title="Documents" subtitle="Download your invoices. Service reports are on each visit." />
      {loading ? (
        <SkeletonList />
      ) : invoices.length === 0 ? (
        <EmptyState icon={FolderOpen} title="No documents yet" description="Your invoices and reports will collect here." />
      ) : (
        <div className="space-y-2">
          {invoices.map((inv) => (
            <Link key={inv.id} href={`/portal/invoices/${inv.id}`}>
              <Card className="transition-shadow hover:shadow-md">
                <CardContent className="flex items-center gap-3 p-4">
                  <ReceiptText className="h-5 w-5 flex-shrink-0 text-brand-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">Invoice {inv.invoice_number}</p>
                    <p className="text-xs text-muted-foreground">{inv.invoice_date ? formatDate(inv.invoice_date) : ''} · {formatCurrency(inv.total_cents)}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
