'use client'

/**
 * Books → Invoice detail. PBAccounting-parity view.
 *
 *   [ EDIT | SEND | MARK SENT | + RECORD PAYMENT | EXPORT PDF | MORE ▼ ]  ‹ ›
 *   ┌─ What's next? — contextual nudge (draft → send, sent → collect) ─┐
 *   ├─ Paper invoice preview (brand-colored table, DRAFT ribbon, etc.) ─┤
 *   └─ Payments applied + Journal entry (compact secondary cards)     ─┘
 *
 * Existing Void / Record-Payment dialogs stay as-is — the new action bar
 * just re-wires them. The paper preview is a print-friendly rendering:
 * `@media print` hides the action bar + banner and drops the shadow so
 * users get a clean print-to-PDF fallback.
 */
import { useEffect, useState, useCallback, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/ui/status-badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogBody,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  Printer,
  Receipt,
  Send,
  Trash2,
} from 'lucide-react'
import { formatCurrency, formatDate, dollarsToCents } from '@/lib/books/format'
import { todayIso } from '@/lib/books/format-helpers'
import type { InvoiceStatus } from '@/types/database'
import { WhatsNextBanner } from '@/components/books/whats-next-banner'
import {
  InvoicePreview,
  type InvoicePreviewInvoice,
  type InvoicePreviewLine,
  type InvoicePreviewOrg,
} from '@/components/books/invoice-preview'
import { generateInvoicePdf } from '@/lib/pdf/generate-invoice'
import type { Organization, OrganizationSettings } from '@/types/database'
import type { OrgBrand } from '@/app/api/books/org-brand/route'

interface Invoice extends InvoicePreviewInvoice {
  organization_id: string
  notes_internal: string | null
  locked_at: string | null
  job_id: string | null
  sent_at: string | null
  send_count: number | null
}

interface Line extends InvoicePreviewLine {
  account?: { code: string; name: string } | null
}

interface Payment {
  id: string
  payment_number: string
  payment_date: string
  amount_cents: number
  payment_method: string
}

interface Journal {
  id: string
  entry_number: string
  entry_date: string
}

interface Account { id: string; code: string; name: string; type: string }

interface Adjacent {
  id: string
  invoice_number: string
}

export default function BooksInvoiceDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [journal, setJournal] = useState<Journal | null>(null)
  const [prev, setPrev] = useState<Adjacent | null>(null)
  const [next, setNext] = useState<Adjacent | null>(null)
  const [org, setOrg] = useState<InvoicePreviewOrg | null>(null)
  // Full org-brand payload (includes accent/secondary colors + settings)
  // — needed by the PDF generator to honour theme + logo + header/footer
  // layout. Preview only cares about the subset in `InvoicePreviewOrg`.
  const [orgBrand, setOrgBrand] = useState<OrgBrand | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [confirmVoid, setConfirmVoid] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [confirmSend, setConfirmSend] = useState(false)
  const [sending, setSending] = useState(false)
  const [markingSent, setMarkingSent] = useState(false)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [invRes, orgRes] = await Promise.all([
        fetch(`/api/books/invoices/${id}`),
        fetch('/api/books/org-brand'),
      ])
      const invData = await invRes.json()
      if (!invRes.ok) throw new Error(invData.error || 'Failed to load')
      setInvoice(invData.invoice as Invoice)
      setLines(invData.lines as Line[])
      setPayments(invData.payments as Payment[])
      setJournal(invData.journal as Journal | null)
      setPrev((invData.prev as Adjacent | null) ?? null)
      setNext((invData.next as Adjacent | null) ?? null)

      // Org branding is a soft dependency — if the call fails, we still
      // render the preview with a name-only fallback so the page never
      // stalls behind branding.
      if (orgRes.ok) {
        const orgJson = await orgRes.json()
        const brand = orgJson.org as OrgBrand
        setOrgBrand(brand)
        // The preview only reads the subset defined by InvoicePreviewOrg
        // — the extra fields (accent_color, settings) are for the PDF.
        setOrg({
          id: brand.id,
          name: brand.name,
          logo_url: brand.logo_url,
          primary_color: brand.primary_color,
          company_phone: brand.company_phone,
          company_email: brand.company_email,
          company_website: brand.company_website,
          company_address: brand.company_address,
        })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function handleVoid() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/books/invoices/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to void')
      toast.success('Invoice voided & reversed in GL')
      router.push('/books/invoices')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to void')
    } finally {
      setDeleting(false)
      setConfirmVoid(false)
    }
  }

  // "Send" — draft → sent, emailing when we have a backing job.
  async function handleSend() {
    if (!invoice) return
    setSending(true)
    try {
      const endpoint = invoice.job_id
        ? `/api/jobs/${invoice.job_id}/send`
        : `/api/books/invoices/${invoice.id}/send`
      const res = await fetch(endpoint, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send')
      if (data.alreadySent) {
        toast.success('Invoice was already sent — no email re-sent.')
      } else if (invoice.job_id) {
        toast.success('Invoice sent to client.')
      } else {
        toast.success('Invoice marked sent and posted to the GL.')
      }
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSending(false)
      setConfirmSend(false)
    }
  }

  // "Mark sent" — flip status without sending an email. Both routes
  // (books-only and legacy jobs/send) handle this identically today
  // because there's no email wired for standalone books invoices yet.
  // We PATCH straight to the invoice endpoint to make the "no email"
  // semantic explicit even when we do wire email in the future.
  async function handleMarkSent() {
    if (!invoice) return
    setMarkingSent(true)
    try {
      const res = await fetch(`/api/books/invoices/${invoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'sent' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to mark sent')
      toast.success('Invoice marked as sent and posted to the GL.')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark sent')
    } finally {
      setMarkingSent(false)
    }
  }

  async function handleExportPdf() {
    if (!invoice) return
    setExporting(true)
    try {
      // Build the shapes the shared /lib/pdf/generate-invoice.ts expects
      // — it was designed for the field-ops job flow (dollars, not cents;
      // job-based site info), so we adapt the books-mode invoice here.
      // The generator honours org.settings.invoice_theme and paints the
      // logo + brand-colored header for us.

      const subtotalDollars = invoice.subtotal_cents / 100
      const taxAmountDollars = invoice.tax_amount_cents / 100
      const taxRatePct =
        invoice.subtotal_cents > 0
          ? Number(
              ((invoice.tax_amount_cents / invoice.subtotal_cents) * 100).toFixed(3)
            )
          : 0

      const invoiceData = {
        invoice_number: invoice.invoice_number,
        due_date:
          invoice.due_date ?? invoice.invoice_date ?? new Date().toISOString(),
        line_items: lines.map((l) => ({
          service: l.description ?? 'Service',
          code: l.account?.code ?? '',
          quantity: Number(l.quantity) || 1,
          unit_price: l.unit_price_cents / 100,
          total: l.total_cents / 100,
        })),
        subtotal: subtotalDollars,
        tax_rate: taxRatePct,
        tax_amount: taxAmountDollars,
        total_amount: invoice.total_cents / 100,
        payment_terms:
          invoice.payment_terms_text ??
          (invoice.due_date ? 'due_on_date' : 'due_on_receipt'),
        thank_you: invoice.notes_for_customer ?? undefined,
      }

      // Books-mode invoices may not have a backing job. We synthesize a
      // JobContext from the client record so the generator still has
      // sensible bill-to / service-location values to render. When a
      // job exists we could enrich this later; for now the client's
      // billing address stands in for both.
      const clientAddress = invoice.clients?.billing_address ?? ''
      const contactEmail =
        invoice.clients?.billing_contact_email ??
        invoice.clients?.primary_contact_email ??
        ''

      const jobContext = {
        clientName: invoice.clients?.company_name ?? '—',
        clientContact: contactEmail,
        clientAddress: clientAddress || undefined,
        siteName: invoice.clients?.company_name ?? '',
        siteAddress: clientAddress,
        serviceDate: invoice.invoice_date,
        jobId: invoice.job_id ?? '',
      }

      // Build a full Organization from the /api/books/org-brand payload.
      // The generator only reads the fields listed here — we cast the
      // rest of the Organization shape (limits, Stripe, timestamps) as
      // zero-value defaults so TypeScript stays happy without pulling
      // the whole row from the server.
      const brand = orgBrand
      const settings: OrganizationSettings = brand?.settings ?? {}
      const org: Organization = {
        id: brand?.id ?? invoice.organization_id,
        name: brand?.name ?? invoice.clients?.company_name ?? 'Invoice',
        slug: '',
        tier: 'basic',
        logo_url: brand?.logo_url ?? null,
        primary_color: brand?.primary_color ?? '#05093d',
        accent_color: brand?.accent_color ?? '#2563eb',
        secondary_color: brand?.secondary_color ?? null,
        company_phone: brand?.company_phone ?? null,
        company_email: brand?.company_email ?? null,
        company_website: brand?.company_website ?? null,
        company_address: brand?.company_address ?? null,
        settings,
        max_users: 0,
        max_ai_generations_per_month: 0,
        storage_limit_gb: 0,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        stripe_account_id: null,
        stripe_account_status: null,
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
        books_enabled_at: null,
        created_at: '',
        updated_at: '',
      }

      const doc = await generateInvoicePdf(invoiceData, jobContext, org)
      const blob = doc.output('blob')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${invoice.invoice_number}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('PDF exported.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export PDF')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return <Skeleton className="h-64 w-full" />
  }
  if (!invoice) {
    return <p className="text-sm text-muted-foreground">Invoice not found.</p>
  }

  const status: InvoiceStatus = invoice.status
  const canEdit = !invoice.locked_at && status !== 'void' && status !== 'paid'
  const canPay = invoice.balance_due_cents > 0 && status !== 'void' && status !== 'draft'
  const canSendDraft = status === 'draft' && invoice.balance_due_cents > 0 && !invoice.locked_at
  const canResend =
    (status === 'sent' || status === 'partially_paid' || status === 'overdue') &&
    !!invoice.job_id

  // Preview data (org falls back to a minimal card if the brand endpoint
  // failed — the preview still renders a name-only letterhead).
  const previewOrg: InvoicePreviewOrg =
    org ??
    {
      id: invoice.organization_id,
      name: invoice.clients?.company_name ?? '—',
      logo_url: null,
      primary_color: '#05093d',
      company_phone: null,
      company_email: null,
      company_website: null,
      company_address: null,
    }

  return (
    <div className="space-y-4 print:space-y-2">
      <PageHeader
        title={invoice.invoice_number}
        subtitle={invoice.clients?.company_name ?? undefined}
        breadcrumb={[
          { label: 'Books', href: '/books' },
          { label: 'Invoices', href: '/books/invoices' },
          { label: invoice.invoice_number },
        ]}
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <StatusBadge status={invoice.status} type="invoice" />
          </div>
        }
      />

      {invoice.locked_at && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200 print:hidden">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            This period was locked on {formatDate(invoice.locked_at)}. Unlock in{' '}
            <a href="/books/settings" className="underline underline-offset-2">Books → Settings</a>{' '}
            to edit.
          </p>
        </div>
      )}

      {/* Action bar */}
      <ActionBar
        canEdit={canEdit}
        canSendDraft={canSendDraft}
        canResend={canResend}
        canPay={canPay}
        onEdit={() => router.push(`/books/invoices/${invoice.id}/edit`)}
        onSend={() => setConfirmSend(true)}
        onMarkSent={handleMarkSent}
        onRecordPayment={() => setPayOpen(true)}
        onExportPdf={handleExportPdf}
        onDuplicate={() => toast.info('Duplicate — coming soon.')}
        onPrint={() => window.print()}
        onVoid={() => setConfirmVoid(true)}
        onNavigate={(href) => router.push(href)}
        prev={prev}
        next={next}
        sending={sending}
        markingSent={markingSent}
        exporting={exporting}
      />

      {/* Contextual nudge */}
      <WhatsNextBanner
        status={invoice.status}
        balanceDueCents={invoice.balance_due_cents}
        dueDate={invoice.due_date}
        onSend={() => setConfirmSend(true)}
        onMarkSent={handleMarkSent}
        onRecordPayment={() => setPayOpen(true)}
      />

      {/* Paper preview */}
      <InvoicePreview invoice={invoice} lines={lines} org={previewOrg} />

      {/* Secondary — payments applied + JE link */}
      <div className="grid gap-4 md:grid-cols-2 print:hidden">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Payments applied</CardTitle>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <p className="text-xs text-muted-foreground">No payments yet.</p>
            ) : (
              <ul className="divide-y">
                {payments.map((p) => (
                  <li key={p.id} className="py-1.5 flex items-center justify-between text-sm">
                    <div className="min-w-0">
                      <p className="font-mono text-xs">{p.payment_number}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(p.payment_date)} · {p.payment_method}
                      </p>
                    </div>
                    <span className="tabular-nums font-medium">
                      {formatCurrency(p.amount_cents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Journal entry</CardTitle>
          </CardHeader>
          <CardContent>
            {journal ? (
              <Link
                href={`/books/journal/${journal.id}`}
                className="inline-flex items-center gap-2 text-sm hover:underline"
              >
                <span className="font-mono">{journal.entry_number}</span>
                <span className="text-muted-foreground">
                  · {formatDate(journal.entry_date)}
                </span>
              </Link>
            ) : (
              <p className="text-xs text-muted-foreground">
                {invoice.status === 'draft'
                  ? 'No GL entry yet — draft invoices post when marked sent.'
                  : 'No journal entry linked.'}
              </p>
            )}
            {(invoice.send_count ?? 0) > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Last sent {invoice.sent_at ? formatDate(invoice.sent_at) : '—'} ·{' '}
                {invoice.send_count} time{invoice.send_count === 1 ? '' : 's'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmSend} onOpenChange={(o) => !sending && setConfirmSend(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {invoice.status === 'draft'
                ? invoice.job_id
                  ? `Send invoice ${invoice.invoice_number}?`
                  : `Send invoice ${invoice.invoice_number}?`
                : `Resend invoice ${invoice.invoice_number}?`}
            </DialogTitle>
            <DialogDescription>
              {invoice.job_id
                ? 'This will post the invoice to the GL (if not already) and email the client the service report + invoice.'
                : 'This will mark the invoice as sent and post it to your books.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSend(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={handleSend} disabled={sending}>
              {sending
                ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Saving…</>
                : invoice.status === 'draft'
                  ? invoice.job_id ? 'Send invoice' : 'Send'
                  : 'Resend'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmVoid} onOpenChange={(o) => !deleting && setConfirmVoid(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void invoice {invoice.invoice_number}?</DialogTitle>
            <DialogDescription>
              This cancels the invoice and undoes any journal entries automatically. The invoice number stays in your books for the audit trail.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmVoid(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleVoid} disabled={deleting}>
              {deleting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Voiding…</> : 'Void invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecordPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        invoice={invoice}
        onSuccess={() => { setPayOpen(false); load() }}
      />

      <style jsx global>{`
        @media print {
          /* Strip page chrome so the paper preview prints as-is. */
          body { background: #fff !important; }
          .invoice-preview {
            box-shadow: none !important;
            border-radius: 0 !important;
            max-width: none !important;
            width: 100% !important;
          }
        }
      `}</style>
    </div>
  )
}

interface ActionBarProps {
  canEdit: boolean
  canSendDraft: boolean
  canResend: boolean
  canPay: boolean
  onEdit: () => void
  onSend: () => void
  onMarkSent: () => void
  onRecordPayment: () => void
  onExportPdf: () => void
  onDuplicate: () => void
  onPrint: () => void
  onVoid: () => void
  onNavigate: (href: string) => void
  prev: Adjacent | null
  next: Adjacent | null
  sending: boolean
  markingSent: boolean
  exporting: boolean
}

/**
 * Six-button action row, PBAccounting-style. On <md we collapse to
 * "Actions ▾" + prev/next arrows so it stays finger-friendly.
 */
function ActionBar({
  canEdit, canSendDraft, canResend, canPay,
  onEdit, onSend, onMarkSent, onRecordPayment, onExportPdf,
  onDuplicate, onPrint, onVoid, onNavigate,
  prev, next, sending, markingSent, exporting,
}: ActionBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {/* Desktop: individual buttons */}
      <div className="hidden md:flex md:flex-wrap md:items-center md:gap-2">
        {canEdit && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="mr-1 h-4 w-4" />
            Edit
          </Button>
        )}
        {canSendDraft && (
          <Button size="sm" onClick={onSend} disabled={sending}>
            <Send className="mr-1 h-4 w-4" />
            Send
          </Button>
        )}
        {canSendDraft && (
          <Button
            variant="outline"
            size="sm"
            onClick={onMarkSent}
            disabled={markingSent}
          >
            {markingSent
              ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              : null}
            Mark sent
          </Button>
        )}
        {canResend && (
          <Button variant="outline" size="sm" onClick={onSend} disabled={sending}>
            <Send className="mr-1 h-4 w-4" />
            Resend
          </Button>
        )}
        {canPay && (
          <Button
            size="sm"
            onClick={onRecordPayment}
            className="bg-emerald-600 hover:bg-emerald-600/90 text-white"
          >
            <Receipt className="mr-1 h-4 w-4" />
            Record payment
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onExportPdf}
          disabled={exporting}
        >
          {exporting
            ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            : <Download className="mr-1 h-4 w-4" />}
          Export PDF
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-[0.8rem] font-medium hover:bg-muted hover:text-foreground outline-none">
            <MoreHorizontal className="h-4 w-4" />
            More
            <ChevronDown className="h-3 w-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDuplicate}>
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onPrint}>
              <Printer className="mr-1 h-4 w-4" />
              Print
            </DropdownMenuItem>
            {canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onVoid}>
                  <Trash2 className="mr-1 h-4 w-4" />
                  Void
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile: single dropdown */}
      <div className="flex items-center gap-2 md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-[0.8rem] font-medium hover:bg-muted hover:text-foreground outline-none">
            Actions
            <ChevronDown className="h-3 w-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {canEdit && (
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-1 h-4 w-4" /> Edit
              </DropdownMenuItem>
            )}
            {canSendDraft && (
              <DropdownMenuItem onClick={onSend}>
                <Send className="mr-1 h-4 w-4" /> Send
              </DropdownMenuItem>
            )}
            {canSendDraft && (
              <DropdownMenuItem onClick={onMarkSent}>Mark sent</DropdownMenuItem>
            )}
            {canResend && (
              <DropdownMenuItem onClick={onSend}>
                <Send className="mr-1 h-4 w-4" /> Resend
              </DropdownMenuItem>
            )}
            {canPay && (
              <DropdownMenuItem onClick={onRecordPayment}>
                <Receipt className="mr-1 h-4 w-4" /> Record payment
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onExportPdf}>
              <Download className="mr-1 h-4 w-4" /> Export PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>Duplicate</DropdownMenuItem>
            <DropdownMenuItem onClick={onPrint}>
              <Printer className="mr-1 h-4 w-4" /> Print
            </DropdownMenuItem>
            {canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onVoid}>
                  <Trash2 className="mr-1 h-4 w-4" /> Void
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Prev/next — far right. */}
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          disabled={!prev}
          aria-label={prev ? `Previous invoice ${prev.invoice_number}` : 'No previous invoice'}
          onClick={() => prev && onNavigate(`/books/invoices/${prev.id}`)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={!next}
          aria-label={next ? `Next invoice ${next.invoice_number}` : 'No next invoice'}
          onClick={() => next && onNavigate(`/books/invoices/${next.id}`)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function RecordPaymentDialog({
  open, onOpenChange, invoice, onSuccess,
}: {
  open: boolean; onOpenChange: (b: boolean) => void
  invoice: Invoice; onSuccess: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [amount, setAmount] = useState((invoice.balance_due_cents / 100).toFixed(2))
  const [date, setDate] = useState(todayIso())
  const [method, setMethod] = useState('check')
  const [reference, setReference] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [depositAccountId, setDepositAccountId] = useState('')

  useEffect(() => {
    if (!open) return
    fetch('/api/books/accounts').then((r) => r.json()).then((data) => {
      const banks = (data.accounts as Account[]).filter(
        (a) => a.type === 'asset' && ['1000', '1010', '1020'].includes(a.code)
      )
      setAccounts(banks)
      if (banks[0]) setDepositAccountId(banks[0].id)
    })
  }, [open])

  async function submit() {
    setSubmitting(true)
    try {
      const cents = dollarsToCents(amount)
      if (cents <= 0) throw new Error('Amount must be > 0')
      const res = await fetch('/api/books/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_date: date,
          type: 'invoice_payment',
          source_type: 'invoice',
          source_id: invoice.id,
          amount_cents: cents,
          payment_method: method,
          deposit_to_account_id: depositAccountId || null,
          reference: reference || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success(`Payment ${data.payment.payment_number} recorded`)
      onSuccess()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            For invoice {invoice.invoice_number}. Posts to the GL on save.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Amount</Label>
            <Input id="pay-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-date">Date</Label>
            <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-method">Method</Label>
            <select
              id="pay-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
            >
              {['cash', 'check', 'ach', 'wire', 'credit_card', 'debit_card', 'other'].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-account">Deposit to</Label>
            <select
              id="pay-account"
              value={depositAccountId}
              onChange={(e) => setDepositAccountId(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
            >
              <option value="">— default operating bank —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-ref">Reference (optional)</Label>
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Check #4521, txn id, etc." />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Saving…</> : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
