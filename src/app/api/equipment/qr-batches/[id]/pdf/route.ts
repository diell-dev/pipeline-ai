/**
 * GET /api/equipment/qr-batches/[id]/pdf
 *
 * Renders a batch as an Avery 5160 label sheet (30 labels/page, 2.625" x 1").
 * Each label is ~75% QR + ~25% human-readable code below.
 *
 * The first successful render is cached to storage under
 *   public/qr-batches/{batchId}.pdf
 * and the URL written back to equipment_qr_batches.printed_pdf_url. Future
 * requests still re-render the PDF response (so the user always gets a fresh
 * download), but the cached URL is available for the UI to link to.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, hasPermission, canAccessOrg } from '@/lib/api-auth'
import { qrToDataUrl } from '@/lib/qr'
import { jsPDF } from 'jspdf'

// Avery 5160 layout (inches)
const PAGE_WIDTH_IN = 8.5
const PAGE_HEIGHT_IN = 11
const MARGIN_TOP_IN = 0.5
const MARGIN_LEFT_IN = 0.1875
const LABEL_WIDTH_IN = 2.625
const LABEL_HEIGHT_IN = 1.0
const HORIZONTAL_GAP_IN = 0.125
const COLS = 3
const ROWS = 10
const LABELS_PER_PAGE = COLS * ROWS

// Public URL constructor — works for any Supabase storage bucket
function publicUrlFor(path: string) {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
  return `${base}/storage/v1/object/public/${path}`
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: batchId } = await params

  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!hasPermission(auth.role, 'equipment:manage_qr_batches')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = await createClient()

  // Load the batch + its codes (must belong to caller's org via RLS).
  const { data: batch, error: batchErr } = await supabase
    .from('equipment_qr_batches')
    .select('*')
    .eq('id', batchId)
    .single()

  if (batchErr || !batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  }
  if (!canAccessOrg(auth, batch.organization_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: codes, error: codesErr } = await supabase
    .from('equipment_qr_codes')
    .select('code')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true })

  if (codesErr) {
    return NextResponse.json({ error: codesErr.message }, { status: 500 })
  }
  const codeList = (codes || []).map((c) => c.code as string)

  // Build the URL that each sticker encodes. Public scan endpoint.
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')

  // ── Generate the PDF ──
  const doc = new jsPDF({ unit: 'in', format: 'letter' })

  for (let i = 0; i < codeList.length; i++) {
    const code = codeList[i]
    const indexOnPage = i % LABELS_PER_PAGE
    if (i > 0 && indexOnPage === 0) doc.addPage()

    const col = indexOnPage % COLS
    const row = Math.floor(indexOnPage / COLS)
    const x = MARGIN_LEFT_IN + col * (LABEL_WIDTH_IN + HORIZONTAL_GAP_IN)
    const y = MARGIN_TOP_IN + row * LABEL_HEIGHT_IN

    // QR takes ~75% of label height; code text underneath
    const qrSizeIn = 0.75
    const qrPx = 256 // generated at 256px, scaled by jsPDF
    const qrX = x + (LABEL_WIDTH_IN - qrSizeIn) / 2
    const qrY = y + 0.05

    const scanUrl = appUrl ? `${appUrl}/equipment/scan/${code}` : code
    // eslint-disable-next-line no-await-in-loop
    const dataUrl = await qrToDataUrl(scanUrl, qrPx)
    doc.addImage(dataUrl, 'PNG', qrX, qrY, qrSizeIn, qrSizeIn)

    // Code text — small, centered, monospace-feel
    doc.setFontSize(8)
    doc.text(code, x + LABEL_WIDTH_IN / 2, y + LABEL_HEIGHT_IN - 0.08, {
      align: 'center',
    })
  }

  const pdfBuffer = Buffer.from(doc.output('arraybuffer'))

  // Best-effort cache to storage. Don't fail the request if the bucket doesn't
  // exist yet — admins still get their download.
  try {
    const storagePath = `qr-batches/${batchId}.pdf`
    const { error: uploadErr } = await supabase.storage
      .from('public')
      .upload(storagePath, pdfBuffer, {
        upsert: true,
        contentType: 'application/pdf',
      })
    if (!uploadErr && !batch.printed_pdf_url) {
      await supabase
        .from('equipment_qr_batches')
        .update({ printed_pdf_url: publicUrlFor(`public/${storagePath}`) })
        .eq('id', batchId)
    }
  } catch (err) {
    console.warn('QR batch PDF cache upload failed (non-fatal):', err)
  }

  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="qr-batch-${batch.batch_number}.pdf"`,
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  })
}
