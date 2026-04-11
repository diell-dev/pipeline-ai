/**
 * PDF Download Utilities
 *
 * Provides functions to download invoice/report PDFs individually
 * or bundled as a ZIP file.
 */
import JSZip from 'jszip'
import { generateInvoicePdf } from './generate-invoice'
import { generateReportPdf } from './generate-report'
import type { Organization } from '@/types/database'

interface DownloadJobData {
  invoiceContent: Record<string, unknown>
  reportContent: Record<string, unknown>
  clientName: string
  clientContact: string
  clientAddress?: string
  siteName: string
  siteAddress: string
  serviceDate: string
  techName: string
  jobId: string
}

function buildInvoiceData(inv: Record<string, unknown>) {
  return {
    invoice_number: (inv.invoice_number as string) || 'N/A',
    due_date: (inv.due_date as string) || new Date().toISOString(),
    line_items: ((inv.line_items as Array<Record<string, unknown>>) || []).map((li) => ({
      service: (li.service as string) || '',
      code: (li.code as string) || '',
      quantity: Number(li.quantity) || 1,
      unit_price: Number(li.unit_price) || 0,
      total: Number(li.total) || 0,
    })),
    subtotal: Number(inv.subtotal) || 0,
    tax_rate: Number(inv.tax_rate) || 8.875,
    tax_amount: Number(inv.tax_amount) || 0,
    total_amount: Number(inv.total_amount) || 0,
    payment_terms: (inv.payment_terms as string) || 'net_30',
  }
}

function buildReportData(report: Record<string, unknown>) {
  return {
    summary: (report.summary as string) || '',
    work_performed: (report.work_performed as string[]) || [],
    findings: (report.findings as string[]) || [],
    recommendations: (report.recommendations as string[]) || [],
    condition_assessment: (report.condition_assessment as string) || '',
    next_steps: (report.next_steps as string) || '',
    generated_by: (report.generated_by as string) || 'AI',
    generated_at: (report.generated_at as string) || '',
    photos: (report.photos as string[]) || [],
  }
}

function buildJobContext(data: DownloadJobData) {
  return {
    clientName: data.clientName,
    clientContact: data.clientContact,
    clientAddress: data.clientAddress,
    siteName: data.siteName,
    siteAddress: data.siteAddress,
    serviceDate: data.serviceDate,
    techName: data.techName,
    jobId: data.jobId,
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadInvoicePdf(data: DownloadJobData, org: Organization) {
  const invoiceData = buildInvoiceData(data.invoiceContent)
  const jobContext = buildJobContext(data)
  const doc = generateInvoicePdf(invoiceData, jobContext, org)
  const blob = doc.output('blob')
  triggerDownload(blob, `Invoice-${invoiceData.invoice_number}.pdf`)
}

export async function downloadReportPdf(data: DownloadJobData, org: Organization) {
  const reportData = buildReportData(data.reportContent)
  const jobContext = buildJobContext(data)
  const doc = await generateReportPdf(reportData, jobContext, org)
  const blob = doc.output('blob')
  triggerDownload(blob, `Report-${data.jobId.slice(0, 8)}.pdf`)
}

export async function downloadBothAsZip(data: DownloadJobData, org: Organization) {
  const invoiceData = buildInvoiceData(data.invoiceContent)
  const reportData = buildReportData(data.reportContent)
  const jobContext = buildJobContext(data)

  const invoiceDoc = generateInvoicePdf(invoiceData, jobContext, org)
  const reportDoc = await generateReportPdf(reportData, jobContext, org)

  const zip = new JSZip()
  zip.file(`Invoice-${invoiceData.invoice_number}.pdf`, invoiceDoc.output('arraybuffer'))
  zip.file(`Report-${data.jobId.slice(0, 8)}.pdf`, reportDoc.output('arraybuffer'))

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  triggerDownload(zipBlob, `${data.clientName.replace(/\s+/g, '_')}-Job-${data.jobId.slice(0, 8)}.zip`)
}
