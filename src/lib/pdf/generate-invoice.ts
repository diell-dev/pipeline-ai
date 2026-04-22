/**
 * Invoice PDF Generator
 *
 * Generates professional invoice PDFs using jsPDF with 4 theme options:
 * - Modern: Clean lines, bold colored header, sans-serif
 * - Classic: Traditional, subtle borders, professional
 * - Minimal: Whitespace-heavy, thin dividers, lightweight
 * - Bold: Large colored blocks, strong contrasts
 *
 * Uses company profile settings for colors, logo, header/footer layout.
 */
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type {
  InvoiceTheme,
  Organization,
  OrganizationSettings,
  DocHeaderFooterLayout,
  DocPillar,
} from '@/types/database'

interface InvoiceData {
  invoice_number: string
  due_date: string
  line_items: Array<{
    service: string
    code: string
    quantity: number
    unit_price: number
    total: number
  }>
  subtotal: number
  tax_rate: number
  tax_amount: number
  total_amount: number
  payment_terms: string
  thank_you?: string
}

interface JobContext {
  clientName: string
  clientContact: string
  clientAddress?: string
  siteName: string
  siteAddress: string
  serviceDate: string
  jobId: string
}

interface CompanyInfo {
  name: string
  phone?: string
  email?: string
  website?: string
  address?: string
  logoUrl?: string
  primaryColor: string
  accentColor: string
  secondaryColor?: string
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [0, 0, 0]
}

function isLightColor(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex)
  return (r * 299 + g * 587 + b * 114) / 1000 > 128
}

// ===== HEADER/FOOTER RENDERER =====
function renderPillar(
  doc: jsPDF,
  pillar: DocPillar,
  x: number,
  y: number,
  width: number,
  company: CompanyInfo,
  pageNum?: number,
  totalPages?: number,
) {
  if (pillar.type === 'empty') return

  const align = pillar.alignment

  if (pillar.type === 'logo' && company.logoUrl) {
    // Logo rendering would need base64 image - we'll show company name as fallback
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text(company.name, align === 'right' ? x + width : align === 'center' ? x + width / 2 : x, y, {
      align,
    })
  } else if (pillar.type === 'logo') {
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text(company.name, align === 'right' ? x + width : align === 'center' ? x + width / 2 : x, y, {
      align,
    })
  } else if (pillar.type === 'company_info') {
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120, 120, 120)
    const infoParts = [company.name]
    if (company.phone) infoParts.push(company.phone)
    if (company.email) infoParts.push(company.email)
    if (company.website) infoParts.push(company.website)
    const textX = align === 'right' ? x + width : align === 'center' ? x + width / 2 : x
    doc.text(infoParts.join('  |  '), textX, y, { align })
    doc.setTextColor(0, 0, 0)
  } else if (pillar.type === 'page_number') {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(150, 150, 150)
    const textX = align === 'right' ? x + width : align === 'center' ? x + width / 2 : x
    doc.text(`Page ${pageNum || 1}${totalPages ? ` of ${totalPages}` : ''}`, textX, y, { align })
    doc.setTextColor(0, 0, 0)
  }
}

function renderHeaderFooter(
  doc: jsPDF,
  layout: DocHeaderFooterLayout | undefined,
  company: CompanyInfo,
  yPos: number,
  pageNum: number,
  totalPages: number,
) {
  if (!layout) return
  const margin = 20
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - 2 * margin
  const pillarWidth = contentWidth / 3

  renderPillar(doc, layout.left, margin, yPos, pillarWidth, company, pageNum, totalPages)
  renderPillar(doc, layout.center, margin + pillarWidth, yPos, pillarWidth, company, pageNum, totalPages)
  renderPillar(doc, layout.right, margin + 2 * pillarWidth, yPos, pillarWidth, company, pageNum, totalPages)
}

// ===== THANK-YOU PARAGRAPH RENDERER =====
function renderThankYou(
  doc: jsPDF,
  thankYou: string | undefined,
  y: number,
  margin: number,
  contentWidth: number,
  accentColor: [number, number, number],
): number {
  if (!thankYou) return y

  const pageHeight = doc.internal.pageSize.getHeight()
  // Ensure enough room — if not, add a page
  if (y > pageHeight - 50) {
    doc.addPage()
    y = 25
  }

  y += 8

  // Subtle accent line
  doc.setFillColor(accentColor[0], accentColor[1], accentColor[2])
  doc.rect(margin, y, contentWidth, 0.5, 'F')
  y += 8

  doc.setFontSize(9)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(80, 80, 80)
  const lines = doc.splitTextToSize(thankYou, contentWidth)
  doc.text(lines, margin, y)
  y += lines.length * doc.getLineHeight() / doc.internal.scaleFactor + 4

  // Reset
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(0, 0, 0)

  return y
}

// ===== THEME GENERATORS =====

function generateModern(
  doc: jsPDF,
  invoice: InvoiceData,
  job: JobContext,
  company: CompanyInfo,
  settings: OrganizationSettings,
) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 20
  const [pr, pg, pb] = hexToRgb(company.primaryColor)
  const [ar, ag, ab] = hexToRgb(company.accentColor)

  // Header bar
  doc.setFillColor(pr, pg, pb)
  doc.rect(0, 0, pageWidth, 45, 'F')

  // Accent line
  doc.setFillColor(ar, ag, ab)
  doc.rect(0, 45, pageWidth, 3, 'F')

  // Company name in header
  const textColor = isLightColor(company.primaryColor) ? [30, 30, 30] : [255, 255, 255]
  doc.setTextColor(textColor[0], textColor[1], textColor[2])
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text(company.name, margin, 22)

  // INVOICE title
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text('INVOICE', pageWidth - margin, 22, { align: 'right' })
  doc.setFontSize(9)
  doc.text(`#${invoice.invoice_number}`, pageWidth - margin, 32, { align: 'right' })

  doc.setTextColor(0, 0, 0)
  let y = 58

  // Bill To / Invoice Details
  doc.setFontSize(8)
  doc.setTextColor(120, 120, 120)
  doc.text('BILL TO', margin, y)
  doc.text('INVOICE DETAILS', pageWidth / 2 + 10, y)

  y += 6
  doc.setTextColor(0, 0, 0)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(job.clientName, margin, y)
  doc.setFont('helvetica', 'normal')
  doc.text(`Invoice #: ${invoice.invoice_number}`, pageWidth / 2 + 10, y)

  y += 5
  doc.setFontSize(9)
  doc.text(job.clientContact, margin, y)
  doc.text(`Date: ${new Date().toLocaleDateString('en-US')}`, pageWidth / 2 + 10, y)

  y += 5
  if (job.clientAddress) doc.text(job.clientAddress, margin, y)
  doc.text(`Due: ${new Date(invoice.due_date).toLocaleDateString('en-US')}`, pageWidth / 2 + 10, y)

  y += 5
  doc.text(`Terms: ${invoice.payment_terms.replace('_', ' ')}`, pageWidth / 2 + 10, y)

  y += 5
  doc.text(`Service Date: ${new Date(job.serviceDate).toLocaleDateString('en-US')}`, pageWidth / 2 + 10, y)

  y += 3

  // Site info
  y += 5
  doc.setFontSize(8)
  doc.setTextColor(120, 120, 120)
  doc.text('SERVICE LOCATION', margin, y)
  y += 5
  doc.setTextColor(0, 0, 0)
  doc.setFontSize(9)
  doc.text(`${job.siteName} — ${job.siteAddress}`, margin, y)

  y += 10

  // Line items table
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Service', 'Code', 'Qty', 'Unit Price', 'Total']],
    body: invoice.line_items.map((item) => {
      const isAdjustment = item.total < 0 || ['DISC', 'SRCH', 'WAIV'].includes(item.code)
      const isDiscount = item.total < 0
      return [
        isAdjustment ? item.service : item.service,
        isAdjustment ? '' : item.code,
        isAdjustment ? '' : String(item.quantity),
        isAdjustment ? '' : `$${item.unit_price.toFixed(2)}`,
        isDiscount ? `-$${Math.abs(item.total).toFixed(2)}` : `$${item.total.toFixed(2)}`,
      ]
    }),
    headStyles: {
      fillColor: [pr, pg, pb],
      textColor: textColor as [number, number, number],
      fontStyle: 'bold',
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section === 'body') {
        const item = invoice.line_items[data.row.index]
        if (item && (item.total < 0 || ['DISC', 'SRCH', 'WAIV'].includes(item.code))) {
          data.cell.styles.textColor = [140, 60, 160]
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fillColor = [248, 240, 252]
        }
      }
    },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 25, halign: 'center' },
      2: { cellWidth: 15, halign: 'center' },
      3: { cellWidth: 30, halign: 'right' },
      4: { cellWidth: 30, halign: 'right' },
    },
  })

  // Totals
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8
  const totalsX = pageWidth - margin - 80

  doc.setFontSize(9)
  doc.text('Subtotal:', totalsX, y)
  doc.text(`$${invoice.subtotal.toFixed(2)}`, pageWidth - margin, y, { align: 'right' })

  y += 6
  doc.text(`Tax (${invoice.tax_rate}%):`, totalsX, y)
  doc.text(`$${invoice.tax_amount.toFixed(2)}`, pageWidth - margin, y, { align: 'right' })

  y += 2
  doc.setFillColor(ar, ag, ab)
  doc.rect(totalsX - 5, y, pageWidth - margin - totalsX + 10, 0.5, 'F')

  y += 7
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('Total:', totalsX, y)
  doc.text(`$${invoice.total_amount.toFixed(2)}`, pageWidth - margin, y, { align: 'right' })

  // Thank-you paragraph
  y = renderThankYou(doc, invoice.thank_you, y + 5, margin, pageWidth - 2 * margin, [ar, ag, ab])

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight()
  renderHeaderFooter(doc, settings.footer, company, pageHeight - 10, 1, 1)
}

function generateClassic(
  doc: jsPDF,
  invoice: InvoiceData,
  job: JobContext,
  company: CompanyInfo,
  settings: OrganizationSettings,
) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 20

  let y = 20

  // Company name
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(company.name, margin, y)

  // INVOICE on right
  doc.setFontSize(22)
  doc.setTextColor(100, 100, 100)
  doc.text('INVOICE', pageWidth - margin, y, { align: 'right' })
  doc.setTextColor(0, 0, 0)

  y += 5
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  const infoLine = [company.phone, company.email, company.website].filter(Boolean).join('  •  ')
  if (infoLine) doc.text(infoLine, margin, y)

  y += 3
  // Divider
  doc.setDrawColor(180, 180, 180)
  doc.setLineWidth(0.5)
  doc.line(margin, y, pageWidth - margin, y)

  y += 10

  // Two-column info
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('Bill To:', margin, y)
  doc.text('Invoice Details:', pageWidth / 2 + 10, y)

  y += 5
  doc.setFont('helvetica', 'normal')
  doc.text(job.clientName, margin, y)
  doc.text(`Number: ${invoice.invoice_number}`, pageWidth / 2 + 10, y)

  y += 5
  doc.text(job.clientContact, margin, y)
  doc.text(`Date: ${new Date().toLocaleDateString('en-US')}`, pageWidth / 2 + 10, y)

  y += 5
  doc.text(`Site: ${job.siteName}`, margin, y)
  doc.text(`Due: ${new Date(invoice.due_date).toLocaleDateString('en-US')}`, pageWidth / 2 + 10, y)

  y += 5
  doc.text(job.siteAddress, margin, y)
  doc.text(`Terms: ${invoice.payment_terms.replace('_', ' ')}`, pageWidth / 2 + 10, y)

  y += 10

  // Table
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Service', 'Code', 'Qty', 'Unit Price', 'Total']],
    body: invoice.line_items.map((item) => {
      const isAdj = item.total < 0 || ['DISC', 'SRCH', 'WAIV'].includes(item.code)
      return [
        item.service,
        isAdj ? '' : item.code,
        isAdj ? '' : String(item.quantity),
        isAdj ? '' : `$${item.unit_price.toFixed(2)}`,
        item.total < 0 ? `-$${Math.abs(item.total).toFixed(2)}` : `$${item.total.toFixed(2)}`,
      ]
    }),
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [30, 30, 30],
      fontStyle: 'bold',
      fontSize: 9,
      lineColor: [180, 180, 180],
      lineWidth: 0.3,
    },
    bodyStyles: { fontSize: 9, lineColor: [220, 220, 220], lineWidth: 0.2 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section === 'body') {
        const item = invoice.line_items[data.row.index]
        if (item && (item.total < 0 || ['DISC', 'SRCH', 'WAIV'].includes(item.code))) {
          data.cell.styles.textColor = [140, 60, 160]
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fillColor = [248, 240, 252]
        }
      }
    },
    columnStyles: {
      2: { halign: 'center' },
      3: { halign: 'right' },
      4: { halign: 'right' },
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8
  const totalsX = pageWidth - margin - 80

  doc.setFontSize(9)
  doc.text('Subtotal:', totalsX, y)
  doc.text(`$${invoice.subtotal.toFixed(2)}`, pageWidth - margin, y, { align: 'right' })
  y += 5
  doc.text(`Tax (${invoice.tax_rate}%):`, totalsX, y)
  doc.text(`$${invoice.tax_amount.toFixed(2)}`, pageWidth - margin, y, { align: 'right' })
  y += 2
  doc.line(totalsX - 5, y, pageWidth - margin, y)
  y += 6
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Total Due:', totalsX, y)
  doc.text(`$${invoice.total_amount.toFixed(2)}`, pageWidth - margin, y, { align: 'right' })

  // Thank-you paragraph
  const [ar, ag, ab] = hexToRgb(company.accentColor)
  y = renderThankYou(doc, invoice.thank_you, y + 5, margin, pageWidth - 2 * margin, [ar, ag, ab])

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight()
  renderHeaderFooter(doc, settings.footer, company, pageHeight - 10, 1, 1)
}

function generateMinimal(
  doc: jsPDF,
  invoice: InvoiceData,
  job: JobContext,
  company: CompanyInfo,
  settings: OrganizationSettings,
) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 25

  let y = 30

  // Thin accent line at very top
  const [ar, ag, ab] = hexToRgb(company.accentColor)
  doc.setFillColor(ar, ag, ab)
  doc.rect(0, 0, pageWidth, 1.5, 'F')

  // Company name - lightweight
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80, 80, 80)
  doc.text(company.name, margin, y)

  doc.setFontSize(11)
  doc.setTextColor(180, 180, 180)
  doc.text('Invoice', pageWidth - margin, y, { align: 'right' })

  y += 4
  doc.setFontSize(8)
  doc.text(`#${invoice.invoice_number}`, pageWidth - margin, y, { align: 'right' })

  doc.setTextColor(0, 0, 0)
  y += 15

  // Minimal info block
  doc.setFontSize(8)
  doc.setTextColor(150, 150, 150)
  doc.text('TO', margin, y)
  doc.text('DETAILS', pageWidth / 2 + 20, y)

  y += 5
  doc.setTextColor(50, 50, 50)
  doc.setFontSize(9)
  doc.text(job.clientName, margin, y)
  doc.text(`Date: ${new Date().toLocaleDateString('en-US')}`, pageWidth / 2 + 20, y)
  y += 5
  doc.text(job.siteAddress, margin, y)
  doc.text(`Due: ${new Date(invoice.due_date).toLocaleDateString('en-US')}`, pageWidth / 2 + 20, y)

  y += 15

  // Table with minimal styling
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Service', 'Qty', 'Price', 'Total']],
    body: invoice.line_items.map((item) => {
      const isAdj = item.total < 0 || ['DISC', 'SRCH', 'WAIV'].includes(item.code)
      return [
        item.service,
        isAdj ? '' : String(item.quantity),
        isAdj ? '' : `$${item.unit_price.toFixed(2)}`,
        item.total < 0 ? `-$${Math.abs(item.total).toFixed(2)}` : `$${item.total.toFixed(2)}`,
      ]
    }),
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [150, 150, 150],
      fontStyle: 'normal',
      fontSize: 8,
      lineColor: [230, 230, 230],
      lineWidth: 0.3,
    },
    bodyStyles: { fontSize: 9, textColor: [50, 50, 50], lineColor: [240, 240, 240], lineWidth: 0.1 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section === 'body') {
        const item = invoice.line_items[data.row.index]
        if (item && (item.total < 0 || ['DISC', 'SRCH', 'WAIV'].includes(item.code))) {
          data.cell.styles.textColor = [140, 60, 160]
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fillColor = [248, 240, 252]
        }
      }
    },
    columnStyles: {
      1: { halign: 'center', cellWidth: 20 },
      2: { halign: 'right', cellWidth: 30 },
      3: { halign: 'right', cellWidth: 30 },
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 15
  const totalsX = pageWidth - margin - 60

  doc.setFontSize(9)
  doc.setTextColor(120, 120, 120)
  doc.text('Subtotal', totalsX, y)
  doc.setTextColor(50, 50, 50)
  doc.text(`$${invoice.subtotal.toFixed(2)}`, pageWidth - margin, y, { align: 'right' })
  y += 6
  doc.setTextColor(120, 120, 120)
  doc.text(`Tax`, totalsX, y)
  doc.setTextColor(50, 50, 50)
  doc.text(`$${invoice.tax_amount.toFixed(2)}`, pageWidth - margin, y, { align: 'right' })
  y += 10
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text(`$${invoice.total_amount.toFixed(2)}`, pageWidth - margin, y, { align: 'right' })

  // Thank-you paragraph
  y = renderThankYou(doc, invoice.thank_you, y + 5, margin, pageWidth - 2 * margin, [ar, ag, ab])

  const pageHeight = doc.internal.pageSize.getHeight()
  renderHeaderFooter(doc, settings.footer, company, pageHeight - 10, 1, 1)
}

function generateBold(
  doc: jsPDF,
  invoice: InvoiceData,
  job: JobContext,
  company: CompanyInfo,
  settings: OrganizationSettings,
) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 20
  const [pr, pg, pb] = hexToRgb(company.primaryColor)
  const [ar, ag, ab] = hexToRgb(company.accentColor)

  // Large colored header block
  doc.setFillColor(pr, pg, pb)
  doc.rect(0, 0, pageWidth, 65, 'F')

  // Accent stripe
  doc.setFillColor(ar, ag, ab)
  doc.rect(0, 65, pageWidth, 5, 'F')

  // Header text
  const textColor = isLightColor(company.primaryColor) ? [0, 0, 0] : [255, 255, 255]
  doc.setTextColor(textColor[0], textColor[1], textColor[2])
  doc.setFontSize(24)
  doc.setFont('helvetica', 'bold')
  doc.text(company.name, margin, 28)

  doc.setFontSize(14)
  doc.text('INVOICE', margin, 42)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`#${invoice.invoice_number}`, margin, 52)

  doc.setFontSize(12)
  doc.text(`$${invoice.total_amount.toFixed(2)}`, pageWidth - margin, 35, { align: 'right' })
  doc.setFontSize(8)
  doc.text(`Due: ${new Date(invoice.due_date).toLocaleDateString('en-US')}`, pageWidth - margin, 45, { align: 'right' })

  doc.setTextColor(0, 0, 0)
  let y = 80

  // Client info - bold style
  doc.setFillColor(245, 245, 245)
  doc.rect(margin, y - 5, pageWidth - 2 * margin, 30, 'F')

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text(job.clientName, margin + 5, y + 2)
  doc.setFont('helvetica', 'normal')
  doc.text(job.clientContact, margin + 5, y + 8)
  doc.text(`${job.siteName} — ${job.siteAddress}`, margin + 5, y + 14)
  doc.text(`Service: ${new Date(job.serviceDate).toLocaleDateString('en-US')}`, margin + 5, y + 20)

  y += 35

  // Table
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Service', 'Qty', 'Unit Price', 'Total']],
    body: invoice.line_items.map((item) => {
      const isAdj = item.total < 0 || ['DISC', 'SRCH', 'WAIV'].includes(item.code)
      return [
        item.service,
        isAdj ? '' : String(item.quantity),
        isAdj ? '' : `$${item.unit_price.toFixed(2)}`,
        item.total < 0 ? `-$${Math.abs(item.total).toFixed(2)}` : `$${item.total.toFixed(2)}`,
      ]
    }),
    headStyles: {
      fillColor: [pr, pg, pb],
      textColor: textColor as [number, number, number],
      fontStyle: 'bold',
      fontSize: 10,
    },
    bodyStyles: { fontSize: 10 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section === 'body') {
        const item = invoice.line_items[data.row.index]
        if (item && (item.total < 0 || ['DISC', 'SRCH', 'WAIV'].includes(item.code))) {
          data.cell.styles.textColor = [140, 60, 160]
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fillColor = [248, 240, 252]
        }
      }
    },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: {
      1: { halign: 'center', cellWidth: 20 },
      2: { halign: 'right', cellWidth: 35 },
      3: { halign: 'right', cellWidth: 35 },
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 10

  // Bold total block
  doc.setFillColor(pr, pg, pb)
  const totalBlockWidth = 90
  doc.rect(pageWidth - margin - totalBlockWidth, y, totalBlockWidth, 25, 'F')
  doc.setTextColor(textColor[0], textColor[1], textColor[2])
  doc.setFontSize(9)
  doc.text('TOTAL DUE', pageWidth - margin - totalBlockWidth + 10, y + 9)
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(`$${invoice.total_amount.toFixed(2)}`, pageWidth - margin - 5, y + 20, { align: 'right' })

  doc.setTextColor(0, 0, 0)

  // Subtotals above
  const subtotalY = y - 2
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`Subtotal: $${invoice.subtotal.toFixed(2)}`, pageWidth - margin - totalBlockWidth - 5, subtotalY - 6, { align: 'right' })
  doc.text(`Tax (${invoice.tax_rate}%): $${invoice.tax_amount.toFixed(2)}`, pageWidth - margin - totalBlockWidth - 5, subtotalY, { align: 'right' })

  // Thank-you paragraph
  y += 30
  y = renderThankYou(doc, invoice.thank_you, y, margin, pageWidth - 2 * margin, [ar, ag, ab])

  const pageHeight = doc.internal.pageSize.getHeight()
  renderHeaderFooter(doc, settings.footer, company, pageHeight - 10, 1, 1)
}

// ===== MAIN EXPORT =====
export function generateInvoicePdf(
  invoiceData: InvoiceData,
  jobContext: JobContext,
  org: Organization,
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const settings = (org.settings || {}) as OrganizationSettings
  const theme: InvoiceTheme = settings.invoice_theme || 'modern'

  const company: CompanyInfo = {
    name: org.name,
    phone: org.company_phone || undefined,
    email: org.company_email || undefined,
    website: org.company_website || undefined,
    address: org.company_address || undefined,
    logoUrl: org.logo_url || undefined,
    primaryColor: org.primary_color || '#05093d',
    accentColor: org.accent_color || '#00ff85',
    secondaryColor: org.secondary_color || undefined,
  }

  switch (theme) {
    case 'classic':
      generateClassic(doc, invoiceData, jobContext, company, settings)
      break
    case 'minimal':
      generateMinimal(doc, invoiceData, jobContext, company, settings)
      break
    case 'bold':
      generateBold(doc, invoiceData, jobContext, company, settings)
      break
    default:
      generateModern(doc, invoiceData, jobContext, company, settings)
  }

  return doc
}
