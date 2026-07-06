'use client'

/**
 * <InvoicePreview> — the paper-style invoice preview.
 *
 * Renders a receipt-styled card that mirrors what the customer will see
 * once the invoice ships. Uses the tenant's brand color for the line-
 * items table header and (when the invoice is a draft) overlays a
 * rotated "DRAFT" ribbon in the top-left corner.
 *
 * The card intentionally stays light in dark mode — real paper doesn't
 * flip its palette, and this component doubles as the printable view.
 */
import type { InvoiceStatus } from '@/types/database'
import { formatCurrency, formatDate } from '@/lib/books/format'

export interface InvoicePreviewLine {
  id: string
  description: string | null
  quantity: number
  unit_price_cents: number
  total_cents: number
}

export interface InvoicePreviewInvoice {
  id: string
  invoice_number: string
  invoice_date: string
  due_date: string | null
  status: InvoiceStatus
  subtotal_cents: number
  tax_amount_cents: number
  total_cents: number
  amount_paid_cents: number
  balance_due_cents: number
  notes_for_customer: string | null
  po_number?: string | null
  payment_terms_text?: string | null
  clients: {
    id: string
    company_name: string
    billing_contact_email: string | null
    primary_contact_email: string | null
    billing_address?: string | null
  } | null
}

export interface InvoicePreviewOrg {
  id: string
  name: string
  logo_url: string | null
  primary_color: string
  company_phone: string | null
  company_email: string | null
  company_website: string | null
  company_address: string | null
}

interface InvoicePreviewProps {
  invoice: InvoicePreviewInvoice
  lines: InvoicePreviewLine[]
  org: InvoicePreviewOrg
}

/**
 * Very rough luminance check — we swap the table-header text between
 * white and near-black based on the org's brand color so the header
 * stays legible on either a dark navy or a pale mint background.
 */
function textOnColor(hex: string): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return '#ffffff'
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq > 128 ? '#111827' : '#ffffff'
}

function termsLabel(inv: InvoicePreviewInvoice): string {
  if (inv.payment_terms_text) return inv.payment_terms_text
  if (!inv.due_date) return 'Due on receipt'
  return `Due ${formatDate(inv.due_date)}`
}

export function InvoicePreview({ invoice, lines, org }: InvoicePreviewProps) {
  const headerBg = org.primary_color || '#05093d'
  const headerFg = textOnColor(headerBg)
  const showDraftRibbon = invoice.status === 'draft'
  const client = invoice.clients

  return (
    <div
      className="invoice-preview relative mx-auto w-full max-w-3xl overflow-hidden rounded-2xl bg-white text-black shadow-sm ring-1 ring-slate-200 print:rounded-none print:shadow-none print:ring-0"
      data-books-invoice-preview
    >
      {showDraftRibbon && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-8 -left-16 z-10 w-56 rotate-[-45deg] bg-amber-500/90 py-1 text-center text-xs font-bold tracking-[0.3em] text-white shadow"
        >
          DRAFT
        </div>
      )}

      <div className="grid gap-6 p-6 sm:p-8 md:grid-cols-2 md:gap-10">
        {/* Left — company block */}
        <div className="min-w-0 space-y-2">
          {org.logo_url ? (
            // Using next/image with an explicit size cap so the logo stays
            // sensible whether the org uploaded a square avatar or a wide
            // wordmark. `unoptimized` sidesteps loader config for arbitrary
            // Supabase Storage URLs.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={org.logo_url}
              alt={`${org.name} logo`}
              className="max-h-[120px] max-w-[240px] object-contain"
            />
          ) : (
            <div className="text-lg font-bold text-slate-900">{org.name}</div>
          )}
          <div className="text-sm font-semibold text-slate-900">{org.name}</div>
          {org.company_address && (
            <div className="whitespace-pre-line text-xs leading-relaxed text-slate-600">
              {org.company_address}
            </div>
          )}
          <div className="space-y-0.5 text-xs text-slate-600">
            {org.company_phone && <div>{org.company_phone}</div>}
            {org.company_email && <div>{org.company_email}</div>}
            {org.company_website && <div>{org.company_website}</div>}
          </div>
        </div>

        {/* Right — invoice title + balance callout */}
        <div className="flex flex-col items-start gap-4 md:items-end">
          <div className="text-right">
            <div className="font-heading text-3xl font-bold uppercase tracking-wider text-slate-900 sm:text-4xl">
              Invoice
            </div>
            <div className="mt-1 font-mono text-xs text-slate-500">
              {invoice.invoice_number}
            </div>
          </div>
          <div className="w-full max-w-[220px] rounded-lg bg-slate-100 px-4 py-3 text-right">
            <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">
              Balance due
            </div>
            <div className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">
              {formatCurrency(invoice.balance_due_cents)}
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200" />

      {/* Bill-to grid */}
      <div className="grid gap-6 p-6 sm:p-8 md:grid-cols-2 md:gap-10">
        <div className="min-w-0 space-y-1">
          <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">
            Bill to
          </div>
          <div
            className="text-base font-semibold"
            style={{ color: headerBg }}
          >
            {client?.company_name ?? '—'}
          </div>
          {client?.billing_address && (
            <div className="whitespace-pre-line text-xs leading-relaxed text-slate-600">
              {client.billing_address}
            </div>
          )}
          {(client?.billing_contact_email || client?.primary_contact_email) && (
            <div className="text-xs text-slate-600">
              {client.billing_contact_email ?? client.primary_contact_email}
            </div>
          )}
        </div>

        <div className="space-y-1 text-sm md:text-right">
          <div className="flex justify-between gap-4 md:justify-end">
            <span className="text-xs uppercase tracking-wider text-slate-500">
              Invoice date
            </span>
            <span className="font-medium text-slate-900">
              {formatDate(invoice.invoice_date)}
            </span>
          </div>
          <div className="flex justify-between gap-4 md:justify-end">
            <span className="text-xs uppercase tracking-wider text-slate-500">
              Terms
            </span>
            <span className="font-medium text-slate-900">
              {termsLabel(invoice)}
            </span>
          </div>
          <div className="flex justify-between gap-4 md:justify-end">
            <span className="text-xs uppercase tracking-wider text-slate-500">
              Due date
            </span>
            <span className="font-medium text-slate-900">
              {invoice.due_date ? formatDate(invoice.due_date) : '—'}
            </span>
          </div>
          {invoice.po_number && (
            <div className="flex justify-between gap-4 md:justify-end">
              <span className="text-xs uppercase tracking-wider text-slate-500">
                PO #
              </span>
              <span className="font-medium text-slate-900">
                {invoice.po_number}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Line items */}
      <div className="px-6 sm:px-8">
        <div className="overflow-x-auto rounded-md">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr style={{ backgroundColor: headerBg, color: headerFg }}>
                <th className="w-10 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider">
                  #
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider">
                  Item &amp; description
                </th>
                <th className="w-16 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider">
                  Qty
                </th>
                <th className="w-28 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider">
                  Rate
                </th>
                <th className="w-28 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr
                  key={line.id}
                  className={idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'}
                >
                  <td className="px-3 py-2 align-top text-slate-500 tabular-nums">
                    {idx + 1}
                  </td>
                  <td className="px-3 py-2 align-top text-slate-800">
                    <span className="whitespace-pre-line">
                      {line.description ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top text-right tabular-nums text-slate-800">
                    {line.quantity}
                  </td>
                  <td className="px-3 py-2 align-top text-right tabular-nums text-slate-800">
                    {formatCurrency(line.unit_price_cents)}
                  </td>
                  <td className="px-3 py-2 align-top text-right tabular-nums font-medium text-slate-900">
                    {formatCurrency(line.total_cents)}
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-xs text-slate-400"
                  >
                    No line items.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Totals */}
      <div className="flex justify-end px-6 pt-6 pb-2 sm:px-8">
        <dl className="w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Sub total</dt>
            <dd className="tabular-nums text-slate-900">
              {formatCurrency(invoice.subtotal_cents)}
            </dd>
          </div>
          {invoice.tax_amount_cents > 0 && (
            <div className="flex justify-between">
              <dt className="text-slate-500">Tax</dt>
              <dd className="tabular-nums text-slate-900">
                {formatCurrency(invoice.tax_amount_cents)}
              </dd>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-1.5">
            <dt className="font-semibold text-slate-900">Total</dt>
            <dd className="text-base font-bold tabular-nums text-slate-900">
              {formatCurrency(invoice.total_cents)}
            </dd>
          </div>
          {invoice.amount_paid_cents > 0 && (
            <div className="flex justify-between">
              <dt className="text-slate-500">Paid</dt>
              <dd className="tabular-nums text-slate-900">
                −{formatCurrency(invoice.amount_paid_cents)}
              </dd>
            </div>
          )}
          <div
            className="flex justify-between rounded-md px-3 py-2 text-white"
            style={{ backgroundColor: headerBg, color: headerFg }}
          >
            <dt className="font-semibold uppercase tracking-wider text-xs">
              Balance due
            </dt>
            <dd className="text-base font-bold tabular-nums">
              {formatCurrency(invoice.balance_due_cents)}
            </dd>
          </div>
        </dl>
      </div>

      {/* Notes */}
      {invoice.notes_for_customer && (
        <div className="px-6 pt-4 pb-8 sm:px-8">
          <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">
            Notes
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
            {invoice.notes_for_customer}
          </p>
        </div>
      )}

    </div>
  )
}
