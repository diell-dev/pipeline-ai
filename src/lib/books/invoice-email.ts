/**
 * Books invoice email template (audit G1).
 *
 * The legacy job-send route (`/api/jobs/[id]/send`) builds a rich email that
 * leads with the AI service report. A standalone Books invoice has no job and
 * no report, so it needs its own, simpler body: header, line items, totals,
 * Pay-with-Card button, payment terms.
 *
 * Money arrives in CENTS here (Books is cents-native) — never re-derive it
 * from the legacy decimal columns.
 */
import { escapeHtml } from '@/lib/escape-html'

export interface BooksInvoiceLine {
  description: string | null
  quantity: number | null
  unit_price_cents: number | null
  total_cents: number | null
}

export interface BooksInvoiceEmailInput {
  orgName: string
  orgLogoUrl?: string | null
  orgPhone?: string | null
  orgEmail?: string | null
  brandColor?: string | null
  clientName: string
  invoiceNumber: string
  invoiceDate: string | null
  dueDate: string | null
  paymentTermsText?: string | null
  notesForCustomer?: string | null
  lines: BooksInvoiceLine[]
  subtotalCents: number
  taxCents: number
  discountCents: number
  totalCents: number
  amountPaidCents: number
  balanceDueCents: number
  payWithCardUrl?: string | null
}

function money(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}

function longDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

/** Only accept a hex literal so org-supplied colour can't escape the style attribute. */
function safeColor(value: string | null | undefined, fallback: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(value || '') ? (value as string) : fallback
}

export function buildBooksInvoiceEmail(input: BooksInvoiceEmailInput): string {
  const brand = safeColor(input.brandColor, '#1e3a5f')
  const payColor = safeColor(input.brandColor, '#00a447')

  const lineRows =
    input.lines.length > 0
      ? input.lines
          .map((l) => {
            const qty = l.quantity ?? 1
            const unit = l.unit_price_cents ?? 0
            const total = l.total_cents ?? qty * unit
            return `
          <tr>
            <td style="padding: 10px 12px; border-bottom: 1px solid #eee; color: #333;">${escapeHtml(l.description || 'Service')}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #eee; text-align: center; color: #555;">${escapeHtml(String(qty))}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #eee; text-align: right; color: #555;">${money(unit)}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #eee; text-align: right; color: #333; font-weight: 600;">${money(total)}</td>
          </tr>`
          })
          .join('')
      : `<tr><td colspan="4" style="padding: 14px 12px; color: #888; text-align: center;">See attached invoice for details.</td></tr>`

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0; padding:0; background:#f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width: 640px; margin: 0 auto; background: #ffffff;">

    <!-- Header -->
    <div style="background: ${brand}; padding: 24px 32px; color: #ffffff;">
      ${
        input.orgLogoUrl
          ? `<img src="${escapeHtml(input.orgLogoUrl)}" alt="${escapeHtml(input.orgName)}" style="max-height: 40px; margin-bottom: 8px;">`
          : ''
      }
      <h1 style="margin: 0; font-size: 20px; font-weight: 700;">${escapeHtml(input.orgName)}</h1>
      <p style="margin: 4px 0 0; font-size: 14px; opacity: 0.85;">Invoice ${escapeHtml(input.invoiceNumber)}</p>
    </div>

    <div style="padding: 28px 32px;">
      <p style="font-size: 15px; color: #333; margin: 0 0 4px;">Hi ${escapeHtml(input.clientName)},</p>
      <p style="font-size: 14px; color: #555; margin: 0 0 20px; line-height: 1.6;">
        Please find your invoice below.
      </p>

      <!-- Meta -->
      <table style="width: 100%; font-size: 13px; color: #555; margin-bottom: 20px;">
        <tr>
          <td style="padding: 2px 0;"><strong style="color:#333;">Invoice date:</strong> ${longDate(input.invoiceDate)}</td>
          <td style="padding: 2px 0; text-align: right;"><strong style="color:#333;">Due:</strong> ${longDate(input.dueDate)}</td>
        </tr>
      </table>

      <!-- Line items -->
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead>
          <tr style="background: #f8fafc;">
            <th style="padding: 10px 12px; text-align: left; font-weight: 600; color: #333; border-bottom: 2px solid #e5e7eb;">Description</th>
            <th style="padding: 10px 12px; text-align: center; font-weight: 600; color: #333; border-bottom: 2px solid #e5e7eb;">Qty</th>
            <th style="padding: 10px 12px; text-align: right; font-weight: 600; color: #333; border-bottom: 2px solid #e5e7eb;">Price</th>
            <th style="padding: 10px 12px; text-align: right; font-weight: 600; color: #333; border-bottom: 2px solid #e5e7eb;">Total</th>
          </tr>
        </thead>
        <tbody>${lineRows}</tbody>
      </table>

      <!-- Totals -->
      <div style="text-align: right; margin-top: 16px;">
        <p style="font-size: 14px; color: #555; margin: 4px 0;">Subtotal: <strong>${money(input.subtotalCents)}</strong></p>
        ${
          input.discountCents > 0
            ? `<p style="font-size: 14px; color: #555; margin: 4px 0;">Discount: <strong>-${money(input.discountCents)}</strong></p>`
            : ''
        }
        ${
          input.taxCents > 0
            ? `<p style="font-size: 14px; color: #555; margin: 4px 0;">Tax: <strong>${money(input.taxCents)}</strong></p>`
            : ''
        }
        <p style="font-size: 20px; color: ${brand}; font-weight: 700; margin: 12px 0 0;">Total: ${money(input.totalCents)}</p>
        ${
          input.amountPaidCents > 0
            ? `<p style="font-size: 14px; color: #555; margin: 6px 0 0;">Paid: <strong>${money(input.amountPaidCents)}</strong></p>
               <p style="font-size: 16px; color: #b45309; font-weight: 700; margin: 4px 0 0;">Balance due: ${money(input.balanceDueCents)}</p>`
            : ''
        }
      </div>

      ${
        input.payWithCardUrl
          ? `
      <div style="text-align: center; margin: 24px 0 8px;">
        <a href="${escapeHtml(input.payWithCardUrl)}"
           style="display: inline-block; background: ${payColor}; color: #ffffff; font-weight: 600; font-size: 15px; text-decoration: none; padding: 14px 32px; border-radius: 8px;">
          Pay with Card
        </a>
        <p style="font-size: 12px; color: #888; margin: 10px 0 0;">
          Or pay by check, ACH, or wire &mdash; see invoice for details.
        </p>
      </div>`
          : ''
      }

      ${
        input.paymentTermsText
          ? `<div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px 16px; margin-top: 16px;">
               <p style="font-size: 13px; color: #0369a1; margin: 0;"><strong>Payment terms:</strong> ${escapeHtml(input.paymentTermsText)}</p>
             </div>`
          : ''
      }

      ${
        input.notesForCustomer
          ? `<div style="margin-top: 16px; padding: 12px 16px; background: #fafafa; border-radius: 8px;">
               <p style="font-size: 13px; color: #555; margin: 0; white-space: pre-wrap;">${escapeHtml(input.notesForCustomer)}</p>
             </div>`
          : ''
      }

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;">
      <p style="font-size: 13px; color: #888; text-align: center; margin: 0;">
        Thank you for your business.<br>
        ${input.orgPhone ? escapeHtml(input.orgPhone) : ''}${input.orgPhone && input.orgEmail ? ' &middot; ' : ''}${input.orgEmail ? escapeHtml(input.orgEmail) : ''}
      </p>
    </div>
  </div>
</body>
</html>`
}
