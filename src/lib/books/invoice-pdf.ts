/**
 * Books — client-side invoice PDF exporter.
 *
 * Mirrors the on-screen <InvoicePreview> layout: brand logo + INVOICE
 * title on top, bill-to block, brand-colored line-items table, right-
 * aligned totals, notes footer.
 *
 * We keep this on the client because jspdf is a pure browser library.
 * The action-bar "Export PDF" button awaits generateInvoicePdf(), turns
 * the returned Blob into an object URL, and triggers a download.
 *
 * The older /src/lib/pdf/generate-invoice.ts exists for the field-ops
 * flow (job → PDF with four theme variants). Books-mode invoices go
 * through this file so the exporter tracks the paper-preview layout 1:1.
 */
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

import { formatCurrency, formatDate } from '@/lib/books/format'

import type {
  InvoicePreviewInvoice,
  InvoicePreviewLine,
  InvoicePreviewOrg,
} from '@/components/books/invoice-preview'

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return [5, 9, 61] // fall back to Pipeline navy
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ]
}

function isLight([r, g, b]: [number, number, number]): boolean {
  return (r * 299 + g * 587 + b * 114) / 1000 > 128
}

/**
 * Fetch an image URL and convert it to a base64 data URL that jspdf can
 * embed. Returns null on any failure so the PDF still renders (just
 * without the logo). We swallow CORS errors intentionally — the caller
 * shouldn't fail the export because a logo host set a strict header.
 */
async function loadImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = reader.result
        resolve(typeof result === 'string' ? result : null)
      }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/**
 * Detect an image format string jspdf recognises from a data URL. jspdf
 * requires this hint for PNG vs JPEG; we default to PNG which handles
 * transparency correctly for logos.
 */
function detectFormat(dataUrl: string): 'PNG' | 'JPEG' {
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
    return 'JPEG'
  }
  return 'PNG'
}

/**
 * Compute a display size (in mm) that fits the source image into a
 * target box while preserving the aspect ratio. Works from either the
 * base64 data URL (fed through an Image element) or, if the browser
 * can't decode it, a safe square fallback.
 */
async function measure(dataUrl: string): Promise<{ w: number; h: number }> {
  return await new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve({ w: 240, h: 120 })
    img.src = dataUrl
  })
}

export async function generateInvoicePdf(
  invoice: InvoicePreviewInvoice,
  lines: InvoicePreviewLine[],
  org: InvoicePreviewOrg
): Promise<Blob> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 15

  const brand = hexToRgb(org.primary_color || '#05093d')
  const brandFg: [number, number, number] = isLight(brand) ? [17, 24, 39] : [255, 255, 255]

  let y = margin

  // ---- Header: logo (left) + INVOICE title / number (right) ----------
  const headerTop = y
  let leftBottomY = y

  if (org.logo_url) {
    const dataUrl = await loadImageAsDataUrl(org.logo_url)
    if (dataUrl) {
      const dims = await measure(dataUrl)
      const maxW = 60 // mm
      const maxH = 24 // mm
      const ratio = Math.min(maxW / dims.w, maxH / dims.h)
      const w = dims.w * ratio
      const h = dims.h * ratio
      try {
        doc.addImage(dataUrl, detectFormat(dataUrl), margin, y, w, h)
        leftBottomY = y + h + 3
      } catch {
        // jspdf occasionally throws for malformed PNGs — fall back to text.
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(14)
        doc.text(org.name, margin, y + 6)
        leftBottomY = y + 10
      }
    } else {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.text(org.name, margin, y + 6)
      leftBottomY = y + 10
    }
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text(org.name, margin, y + 6)
    leftBottomY = y + 10
  }

  // Right column: INVOICE title, number, balance callout.
  doc.setTextColor(30, 30, 30)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text('INVOICE', pageWidth - margin, headerTop + 8, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(120, 120, 120)
  doc.text(invoice.invoice_number, pageWidth - margin, headerTop + 14, { align: 'right' })

  // Balance-due callout box (light-grey).
  const calloutX = pageWidth - margin - 55
  const calloutY = headerTop + 18
  doc.setFillColor(243, 244, 246)
  doc.roundedRect(calloutX, calloutY, 55, 15, 2, 2, 'F')
  doc.setTextColor(107, 114, 128)
  doc.setFontSize(7)
  doc.text('BALANCE DUE', calloutX + 3, calloutY + 5)
  doc.setTextColor(17, 24, 39)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(
    formatCurrency(invoice.balance_due_cents),
    calloutX + 55 - 3,
    calloutY + 12,
    { align: 'right' }
  )

  const rightBottomY = calloutY + 15 + 4
  y = Math.max(leftBottomY, rightBottomY)

  // Company block (below logo, above divider).
  doc.setTextColor(75, 85, 99)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const orgLines: string[] = [org.name]
  if (org.company_address) orgLines.push(...org.company_address.split(/\r?\n/))
  if (org.company_phone) orgLines.push(org.company_phone)
  if (org.company_email) orgLines.push(org.company_email)
  if (org.company_website) orgLines.push(org.company_website)
  orgLines.forEach((line, idx) => {
    doc.text(line, margin, y + idx * 4)
  })
  y += orgLines.length * 4 + 4

  // Divider.
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.line(margin, y, pageWidth - margin, y)
  y += 6

  // ---- Bill To + right-side meta -------------------------------------
  const billStartY = y
  doc.setTextColor(107, 114, 128)
  doc.setFontSize(7)
  doc.text('BILL TO', margin, billStartY)

  doc.setTextColor(brand[0], brand[1], brand[2])
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(invoice.clients?.company_name ?? '—', margin, billStartY + 5)

  doc.setTextColor(75, 85, 99)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  let billY = billStartY + 10
  if (invoice.clients?.billing_address) {
    invoice.clients.billing_address.split(/\r?\n/).forEach((line) => {
      doc.text(line, margin, billY)
      billY += 4
    })
  }
  const email =
    invoice.clients?.billing_contact_email ?? invoice.clients?.primary_contact_email
  if (email) {
    doc.text(email, margin, billY)
    billY += 4
  }

  // Right-side meta.
  const metaX = pageWidth - margin
  let metaY = billStartY
  doc.setTextColor(107, 114, 128)
  doc.setFontSize(7)
  doc.text('INVOICE DATE', metaX - 40, metaY)
  doc.setTextColor(17, 24, 39)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(formatDate(invoice.invoice_date), metaX, metaY, { align: 'right' })

  metaY += 6
  doc.setTextColor(107, 114, 128)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('TERMS', metaX - 40, metaY)
  doc.setTextColor(17, 24, 39)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(
    invoice.payment_terms_text ??
      (invoice.due_date ? `Due ${formatDate(invoice.due_date)}` : 'Due on receipt'),
    metaX,
    metaY,
    { align: 'right' }
  )

  metaY += 6
  doc.setTextColor(107, 114, 128)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('DUE DATE', metaX - 40, metaY)
  doc.setTextColor(17, 24, 39)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(invoice.due_date ? formatDate(invoice.due_date) : '—', metaX, metaY, {
    align: 'right',
  })

  y = Math.max(billY, metaY + 4) + 4

  // ---- Line items ----------------------------------------------------
  doc.setTextColor(0, 0, 0)
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['#', 'Item & description', 'Qty', 'Rate', 'Amount']],
    body: lines.map((line, idx) => [
      String(idx + 1),
      line.description ?? '—',
      String(line.quantity),
      formatCurrency(line.unit_price_cents),
      formatCurrency(line.total_cents),
    ]),
    headStyles: {
      fillColor: brand,
      textColor: brandFg,
      fontStyle: 'bold',
      fontSize: 9,
      halign: 'left',
    },
    bodyStyles: { fontSize: 9, textColor: [30, 41, 59] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 18, halign: 'right' },
      3: { cellWidth: 28, halign: 'right' },
      4: { cellWidth: 28, halign: 'right' },
    },
  })

  // jspdf-autotable stashes the finalY on the instance; grab it and
  // continue with the totals block. Type is loose so we cast to a
  // narrowed shape rather than pulling in the plugin's own types.
  const lastY =
    ((doc as unknown) as { lastAutoTable?: { finalY: number } }).lastAutoTable
      ?.finalY ?? y
  y = lastY + 6

  // ---- Totals --------------------------------------------------------
  const totalsX = pageWidth - margin - 60
  const totalsW = 60

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(107, 114, 128)
  doc.text('Sub total', totalsX, y)
  doc.setTextColor(17, 24, 39)
  doc.text(formatCurrency(invoice.subtotal_cents), totalsX + totalsW, y, {
    align: 'right',
  })
  y += 5

  if (invoice.tax_amount_cents > 0) {
    doc.setTextColor(107, 114, 128)
    doc.text('Tax', totalsX, y)
    doc.setTextColor(17, 24, 39)
    doc.text(formatCurrency(invoice.tax_amount_cents), totalsX + totalsW, y, {
      align: 'right',
    })
    y += 5
  }

  doc.setDrawColor(226, 232, 240)
  doc.line(totalsX, y, totalsX + totalsW, y)
  y += 5

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(17, 24, 39)
  doc.text('Total', totalsX, y)
  doc.text(formatCurrency(invoice.total_cents), totalsX + totalsW, y, {
    align: 'right',
  })
  y += 6

  if (invoice.amount_paid_cents > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(107, 114, 128)
    doc.text('Paid', totalsX, y)
    doc.setTextColor(17, 24, 39)
    doc.text(
      `−${formatCurrency(invoice.amount_paid_cents)}`,
      totalsX + totalsW,
      y,
      { align: 'right' }
    )
    y += 6
  }

  // Balance due — brand-colored bar.
  doc.setFillColor(brand[0], brand[1], brand[2])
  doc.rect(totalsX - 2, y - 4, totalsW + 4, 8, 'F')
  doc.setTextColor(brandFg[0], brandFg[1], brandFg[2])
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('BALANCE DUE', totalsX, y + 1)
  doc.text(formatCurrency(invoice.balance_due_cents), totalsX + totalsW, y + 1, {
    align: 'right',
  })
  y += 12

  // ---- Notes ---------------------------------------------------------
  if (invoice.notes_for_customer) {
    if (y > pageHeight - margin - 30) {
      doc.addPage()
      y = margin
    }
    doc.setTextColor(107, 114, 128)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.text('NOTES', margin, y)
    y += 4
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(51, 65, 85)
    const wrapped = doc.splitTextToSize(
      invoice.notes_for_customer,
      pageWidth - 2 * margin
    )
    doc.text(wrapped, margin, y)
  }

  return doc.output('blob')
}
