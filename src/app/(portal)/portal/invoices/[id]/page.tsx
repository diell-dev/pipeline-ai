'use client'

/** Invoice detail — stands on the invoice's OWN data (never the job, which
 *  RLS may hide). Line items from invoice_line_items; PDF assembled from the
 *  invoice header + lines + org branding; Pay-by-card via the Stripe checkout. */
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { PortalStatus } from '@/components/portal/portal-status'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrency, formatDate } from '@/lib/books/format'
import { downloadInvoicePdf } from '@/lib/pdf/download'
import { toast } from 'sonner'
import { ArrowLeft, CreditCard, Download } from 'lucide-react'

interface Invoice {
  id: string; invoice_number: string; invoice_date: string | null; due_date: string | null
  status: string; total_cents: number; amount_paid_cents: number; balance_due_cents: number
  tax_amount_cents: number; subtotal_cents: number
}
interface Line { description: string | null; quantity: number; unit_price_cents: number; total_cents: number; tax_amount_cents: number }

export default function PortalInvoiceDetail() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { user, organization } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [inv, setInv] = useState<Invoice | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [company, setCompany] = useState('')
  const [paying, setPaying] = useState(false)

  useEffect(() => {
    if (!user?.client_id) return
    ;(async () => {
      setLoading(true)
      const supabase = createClient()
      const [{ data: invoice }, { data: lineRows }, { data: c }] = await Promise.all([
        supabase.from('invoices')
          .select('id, invoice_number, invoice_date, due_date, status, total_cents, amount_paid_cents, balance_due_cents, tax_amount_cents, subtotal_cents')
          .eq('id', params.id).maybeSingle<Invoice>(),
        supabase.from('invoice_line_items')
          .select('description, quantity, unit_price_cents, total_cents, tax_amount_cents')
          .eq('invoice_id', params.id).order('line_number', { ascending: true }),
        supabase.from('clients').select('company_name').eq('id', user.client_id as string).maybeSingle<{ company_name: string }>(),
      ])
      setInv(invoice ?? null)
      setLines((lineRows as Line[]) ?? [])
      setCompany(c?.company_name ?? '')
      setLoading(false)
    })()
  }, [params.id, user?.client_id])

  async function pay() {
    if (!inv) return
    setPaying(true)
    try {
      const res = await fetch('/api/stripe/checkout/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: inv.id }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start payment')
      window.location.href = data.url
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start payment')
      setPaying(false)
    }
  }

  async function download() {
    if (!inv || !organization) { toast.error('Could not generate the PDF right now.'); return }
    const subtotal = inv.subtotal_cents / 100
    const taxRate = inv.subtotal_cents > 0 ? Number(((inv.tax_amount_cents / inv.subtotal_cents) * 100).toFixed(3)) : 8.875
    try {
      await downloadInvoicePdf(
        {
          invoiceContent: {
            invoice_number: inv.invoice_number,
            due_date: inv.due_date || inv.invoice_date || new Date().toISOString(),
            line_items: lines.map((l) => ({
              service: l.description || 'Service',
              code: '',
              quantity: Number(l.quantity) || 1,
              unit_price: l.unit_price_cents / 100,
              total: (l.total_cents - (l.tax_amount_cents || 0)) / 100,
            })),
            subtotal,
            tax_rate: taxRate,
            tax_amount: inv.tax_amount_cents / 100,
            total_amount: inv.total_cents / 100,
            payment_terms: 'net_30',
          },
          reportContent: {},
          clientName: company || 'Customer',
          clientContact: '',
          siteName: '',
          siteAddress: '',
          serviceDate: inv.invoice_date || new Date().toISOString(),
          techName: '',
          jobId: inv.id,
        } as Parameters<typeof downloadInvoicePdf>[0],
        organization
      )
    } catch {
      toast.error('Could not generate the PDF.')
    }
  }

  if (loading) return <div className="space-y-4"><Skeleton className="h-8 w-40" /><Skeleton className="h-64 w-full" /></div>
  if (!inv) return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={() => router.push('/portal/invoices')}><ArrowLeft className="mr-1.5 h-4 w-4" />Back</Button>
      <p className="text-sm text-muted-foreground">This invoice isn&apos;t available.</p>
    </div>
  )

  const stripeReady = !!organization?.stripe_charges_enabled
  const hasBalance = inv.balance_due_cents > 0 && !['void', 'paid', 'cancelled'].includes(inv.status)
  const canPay = hasBalance && stripeReady

  return (
    <div className="space-y-5 pb-24">
      <Button variant="ghost" size="sm" onClick={() => router.push('/portal/invoices')} className="-ml-2">
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Invoices
      </Button>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{inv.invoice_number}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {inv.invoice_date ? formatDate(inv.invoice_date) : ''}{inv.due_date ? ` · due ${formatDate(inv.due_date)}` : ''}
          </p>
        </div>
        <PortalStatus kind="invoice" status={inv.status} />
      </div>

      <Card>
        <CardContent className="p-4">
          {lines.length > 0 && (
            <div className="mb-4 divide-y">
              {lines.map((l, i) => {
                const net = (l.total_cents - (l.tax_amount_cents || 0)) / 100
                return (
                  <div key={i} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="text-foreground">{l.description || 'Service'}</p>
                      {Number(l.quantity) > 1 ? <p className="text-xs text-muted-foreground">Qty {Number(l.quantity)} × {formatCurrency(l.unit_price_cents)}</p> : null}
                    </div>
                    <p className="whitespace-nowrap font-medium text-foreground">{formatCurrency(Math.round(net * 100))}</p>
                  </div>
                )
              })}
            </div>
          )}
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{formatCurrency(inv.subtotal_cents)}</span></div>
            {inv.tax_amount_cents > 0 && <div className="flex justify-between text-muted-foreground"><span>Tax</span><span>{formatCurrency(inv.tax_amount_cents)}</span></div>}
            <div className="flex justify-between border-t pt-1 font-semibold text-foreground"><span>Total</span><span>{formatCurrency(inv.total_cents)}</span></div>
            {inv.amount_paid_cents > 0 && <div className="flex justify-between text-emerald-600"><span>Paid</span><span>{formatCurrency(inv.amount_paid_cents)}</span></div>}
            {inv.balance_due_cents > 0 && <div className="flex justify-between font-semibold text-red-600"><span>Balance due</span><span>{formatCurrency(inv.balance_due_cents)}</span></div>}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="outline" onClick={download} className="h-11">
          <Download className="mr-2 h-4 w-4" /> Download PDF
        </Button>
      </div>

      {hasBalance && !stripeReady && (
        <p className="text-sm text-muted-foreground">
          To settle this balance, please contact us — online card payment isn&apos;t set up yet.
        </p>
      )}

      {canPay && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0 dark:bg-zinc-900/95"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}>
          <div className="mx-auto max-w-3xl">
            <Button onClick={pay} disabled={paying} className="h-12 w-full text-base">
              <CreditCard className="mr-2 h-5 w-5" />
              {paying ? 'Starting checkout…' : `Pay ${formatCurrency(inv.balance_due_cents)} by card`}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
