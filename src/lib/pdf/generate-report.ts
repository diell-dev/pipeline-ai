/**
 * Service Report PDF Generator
 *
 * Generates professional service report PDFs using jsPDF.
 * Uses the same theme system as invoices for visual consistency.
 * Includes: summary, work performed, findings, recommendations,
 * condition assessment, next steps, AND job photos.
 */
import jsPDF from 'jspdf'
import type { Organization, OrganizationSettings } from '@/types/database'

// V2 report format (simplified — tech notes pass-through)
interface ReportDataV2 {
  version: 2
  intro: string
  services_performed: string[]
  findings: string[]
  tech_notes_raw: string
  photos?: string[]
  generated_by: string
  generated_at: string
}

// V1 report format (legacy AI-generated)
interface ReportDataV1 {
  summary: string
  work_performed: string[]
  findings: string[]
  recommendations?: string[]
  condition_assessment?: string
  next_steps?: string
  generated_by: string
  generated_at: string
  photos?: string[]
}

type ReportData = ReportDataV2 | ReportDataV1

function isV2Report(data: ReportData): data is ReportDataV2 {
  return 'version' in data && data.version === 2
}

interface JobContext {
  clientName: string
  clientContact: string
  siteName: string
  siteAddress: string
  serviceDate: string
  techName: string
  jobId: string
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

function addWrappedText(doc: jsPDF, text: string, x: number, y: number, maxWidth: number): number {
  const lines = doc.splitTextToSize(text, maxWidth)
  doc.text(lines, x, y)
  return y + lines.length * doc.getLineHeight() / doc.internal.scaleFactor
}

function addSection(
  doc: jsPDF,
  title: string,
  items: string[] | string | undefined,
  x: number,
  y: number,
  maxWidth: number,
  accentColor: [number, number, number],
): number {
  if (!items || (Array.isArray(items) && items.length === 0) || (typeof items === 'string' && !items.trim())) {
    return y
  }

  // Check page break
  if (y > doc.internal.pageSize.getHeight() - 40) {
    doc.addPage()
    y = 25
  }

  // Section title with accent line
  doc.setFillColor(accentColor[0], accentColor[1], accentColor[2])
  doc.rect(x, y - 1, 3, 5, 'F')

  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text(title, x + 6, y + 3)
  y += 10

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')

  if (Array.isArray(items)) {
    for (const item of items) {
      if (y > doc.internal.pageSize.getHeight() - 25) {
        doc.addPage()
        y = 25
      }
      doc.text('•', x + 4, y)
      y = addWrappedText(doc, item, x + 10, y, maxWidth - 10)
      y += 2
    }
  } else {
    y = addWrappedText(doc, items, x + 6, y, maxWidth - 6)
  }

  y += 5
  return y
}

/**
 * Fetch an image URL and return it as a base64 data URL for jsPDF.
 * Returns null if the fetch fails.
 */
async function fetchImageAsBase64(url: string): Promise<{ data: string; format: 'JPEG' | 'PNG' } | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null

    const blob = await response.blob()
    const arrayBuffer = await blob.arrayBuffer()
    const uint8 = new Uint8Array(arrayBuffer)

    // Detect format from magic bytes
    let format: 'JPEG' | 'PNG' = 'JPEG'
    if (uint8[0] === 0x89 && uint8[1] === 0x50) {
      format = 'PNG'
    }

    // Convert to base64
    let binary = ''
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i])
    }
    const base64 = btoa(binary)
    const dataUrl = `data:image/${format.toLowerCase()};base64,${base64}`

    return { data: dataUrl, format }
  } catch {
    return null
  }
}

/**
 * Add a photo grid section to the PDF.
 * Photos are laid out 2 per row with captions.
 */
async function addPhotoSection(
  doc: jsPDF,
  photos: string[],
  startY: number,
  margin: number,
  contentWidth: number,
  accentColor: [number, number, number],
): Promise<number> {
  if (!photos || photos.length === 0) return startY

  let y = startY

  // Check page break before section title
  if (y > doc.internal.pageSize.getHeight() - 60) {
    doc.addPage()
    y = 25
  }

  // Section title
  doc.setFillColor(accentColor[0], accentColor[1], accentColor[2])
  doc.rect(margin, y - 1, 3, 5, 'F')
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text('Photo Documentation', margin + 6, y + 3)
  y += 10

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120, 120, 120)
  doc.text(`${photos.length} photo(s) taken during service visit`, margin + 6, y)
  y += 8

  // Layout: 2 photos per row
  const photoWidth = (contentWidth - 6) / 2 // 6mm gap between
  const photoHeight = photoWidth * 0.75 // 4:3 aspect ratio
  const pageHeight = doc.internal.pageSize.getHeight()

  for (let i = 0; i < photos.length; i++) {
    const col = i % 2
    const xPos = margin + col * (photoWidth + 6)

    // New row check
    if (col === 0 && i > 0) {
      y += photoHeight + 10
    }

    // Page break check
    if (y + photoHeight + 10 > pageHeight - 20) {
      doc.addPage()
      y = 25
    }

    // Try to load and embed the photo
    const img = await fetchImageAsBase64(photos[i])
    if (img) {
      try {
        // Light border/frame
        doc.setDrawColor(220, 220, 220)
        doc.rect(xPos, y, photoWidth, photoHeight, 'S')
        doc.addImage(img.data, img.format, xPos + 0.5, y + 0.5, photoWidth - 1, photoHeight - 1)
      } catch {
        // If image fails to add, show placeholder
        doc.setFillColor(245, 245, 245)
        doc.rect(xPos, y, photoWidth, photoHeight, 'F')
        doc.setFontSize(8)
        doc.setTextColor(150, 150, 150)
        doc.text(`Photo ${i + 1} — unable to embed`, xPos + photoWidth / 2, y + photoHeight / 2, { align: 'center' })
      }
    } else {
      // Placeholder for failed load
      doc.setFillColor(245, 245, 245)
      doc.rect(xPos, y, photoWidth, photoHeight, 'F')
      doc.setDrawColor(220, 220, 220)
      doc.rect(xPos, y, photoWidth, photoHeight, 'S')
      doc.setFontSize(8)
      doc.setTextColor(150, 150, 150)
      doc.text(`Photo ${i + 1}`, xPos + photoWidth / 2, y + photoHeight / 2, { align: 'center' })
    }

    // Photo caption
    doc.setFontSize(7)
    doc.setTextColor(150, 150, 150)
    doc.text(`Photo ${i + 1}`, xPos + photoWidth / 2, y + photoHeight + 4, { align: 'center' })
  }

  // Final row height
  y += photoHeight + 10

  return y
}

export async function generateReportPdf(
  reportData: ReportData,
  jobContext: JobContext,
  org: Organization,
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const settings = (org.settings || {}) as OrganizationSettings

  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 20
  const contentWidth = pageWidth - 2 * margin
  const [pr, pg, pb] = hexToRgb(org.primary_color || '#05093d')
  const [ar, ag, ab] = hexToRgb(org.accent_color || '#00ff85')

  // Header bar
  doc.setFillColor(pr, pg, pb)
  doc.rect(0, 0, pageWidth, 40, 'F')

  doc.setFillColor(ar, ag, ab)
  doc.rect(0, 40, pageWidth, 2.5, 'F')

  // Header text
  const textColor = isLightColor(org.primary_color) ? [30, 30, 30] : [255, 255, 255]
  doc.setTextColor(textColor[0], textColor[1], textColor[2])
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(org.name, margin, 18)

  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text('SERVICE REPORT', margin, 28)

  doc.setFontSize(9)
  doc.text(`Job: ${jobContext.jobId.slice(0, 8)}...`, pageWidth - margin, 18, { align: 'right' })
  doc.text(`Date: ${new Date(jobContext.serviceDate).toLocaleDateString('en-US')}`, pageWidth - margin, 25, { align: 'right' })

  doc.setTextColor(0, 0, 0)
  let y = 52

  // Info block
  doc.setFillColor(248, 248, 248)
  doc.rect(margin, y - 4, contentWidth, 22, 'F')

  doc.setFontSize(8)
  doc.setTextColor(120, 120, 120)
  doc.text('CLIENT', margin + 5, y)
  doc.text('SITE', pageWidth / 2, y)
  doc.text('TECHNICIAN', pageWidth - margin - 40, y)

  y += 5
  doc.setTextColor(0, 0, 0)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text(jobContext.clientName, margin + 5, y)
  doc.text(jobContext.siteName, pageWidth / 2, y)
  doc.text(jobContext.techName, pageWidth - margin - 40, y)

  y += 5
  doc.setFont('helvetica', 'normal')
  doc.text(jobContext.clientContact, margin + 5, y)
  doc.text(jobContext.siteAddress, pageWidth / 2, y)

  y += 12

  // Report sections — different layout for V2 vs V1
  const accentRgb: [number, number, number] = [ar, ag, ab]

  if (isV2Report(reportData)) {
    // ── V2: Simple format matching the real NYSD report ──
    // Intro line: "Performed sewer jetting and camera inspection at the property with the following findings:"
    if (reportData.intro) {
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(0, 0, 0)
      y = addWrappedText(doc, reportData.intro, margin, y, contentWidth)
      y += 6
    }

    // Findings as dashed list (exactly like the real report)
    if (reportData.findings?.length) {
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      for (const item of reportData.findings) {
        if (y > doc.internal.pageSize.getHeight() - 25) {
          doc.addPage()
          y = 25
        }
        doc.text('-', margin, y)
        y = addWrappedText(doc, item, margin + 5, y, contentWidth - 5)
        y += 2
      }
    } else if (reportData.tech_notes_raw) {
      // Fallback: render raw tech notes
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      y = addWrappedText(doc, reportData.tech_notes_raw, margin, y, contentWidth)
    }
  } else {
    // ── V1: Legacy AI-generated format ──
    if (reportData.summary) {
      y = addSection(doc, 'Summary', reportData.summary, margin, y, contentWidth, accentRgb)
    }

    if (reportData.work_performed?.length) {
      y = addSection(doc, 'Work Performed', reportData.work_performed, margin, y, contentWidth, accentRgb)
    }

    if (reportData.findings?.length) {
      y = addSection(doc, 'Findings', reportData.findings, margin, y, contentWidth, accentRgb)
    }

    if (reportData.recommendations?.length) {
      y = addSection(doc, 'Recommendations', reportData.recommendations, margin, y, contentWidth, accentRgb)
    }

    if (reportData.condition_assessment) {
      y = addSection(doc, 'Condition Assessment', reportData.condition_assessment, margin, y, contentWidth, accentRgb)
    }

    if (reportData.next_steps) {
      y = addSection(doc, 'Next Steps', reportData.next_steps, margin, y, contentWidth, accentRgb)
    }
  }

  // Photo Documentation section
  if (reportData.photos && reportData.photos.length > 0) {
    y = await addPhotoSection(doc, reportData.photos, y, margin, contentWidth, accentRgb)
  }

  // Generated info
  if (y > doc.internal.pageSize.getHeight() - 30) {
    doc.addPage()
    y = 25
  }
  y += 5
  doc.setDrawColor(220, 220, 220)
  doc.line(margin, y, pageWidth - margin, y)
  y += 5
  doc.setFontSize(7)
  doc.setTextColor(150, 150, 150)
  doc.text(
    `Generated by ${reportData.generated_by || 'AI'} on ${reportData.generated_at ? new Date(reportData.generated_at).toLocaleString() : 'N/A'}`,
    margin,
    y,
  )

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight()
  const pageCount = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)

    // Footer line
    doc.setDrawColor(220, 220, 220)
    doc.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15)

    // Company info footer
    doc.setFontSize(7)
    doc.setTextColor(150, 150, 150)
    const footerParts = [org.name]
    if (org.company_phone) footerParts.push(org.company_phone)
    if (org.company_email) footerParts.push(org.company_email)
    doc.text(footerParts.join('  |  '), margin, pageHeight - 10)
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 10, { align: 'right' })
  }

  return doc
}
