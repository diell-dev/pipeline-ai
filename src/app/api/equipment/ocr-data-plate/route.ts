/**
 * POST /api/equipment/ocr-data-plate
 *
 * Body: { photo_base64: string, mime_type: string }
 *
 * Sends the photo to Claude's vision model and returns the parsed extraction.
 * No DB write — the UI uses the response to drive the confirmation flow, and
 * the user confirms before /api/equipment/register persists.
 *
 * Response shape (200):
 * {
 *   // ── Structured extraction (new API; preferred by the confirmation UI) ──
 *   extraction: {
 *     brand:            { value, source_text, confidence },
 *     model:            { value, source_text, confidence },
 *     serial:           { value, source_text, confidence },
 *     manufacture_date: { value, source_text, confidence, decoded_from, notes }
 *   },
 *   raw_text: string,                          // verbatim transcription of the plate
 *
 *   // ── Legacy flat aliases (kept so the existing scan page still works) ──
 *   make:   string | null,                     // alias of extraction.brand.value
 *   model:  string | null,                     // alias of extraction.model.value
 *   serial: string | null                      // alias of extraction.serial.value
 * }
 *
 * Confidence values:  'high' | 'medium' | 'low'
 * decoded_from:       'plate' (printed MFG date) | 'serial' (decoder cookbook) | null
 *
 * IMPORTANT for the confirmation UI: ALWAYS pass the full `extraction` object
 * back to /api/equipment/register as the `ai_extraction` field so the AI
 * learning loop gets a complete training row.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getApiUser, hasPermission } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit'
import { extractDataPlate, MAX_DATA_PLATE_PHOTO_BYTES } from '@/lib/equipment-ai'

export async function POST(request: NextRequest) {
  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  // H15: restrict the paid Claude vision call to staff who register
  // equipment, and throttle per user so it can't be looped for cost abuse.
  if (!hasPermission(auth.role, 'equipment:edit')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!checkRateLimit(`equip-ocr:${auth.userId}`, { limit: 20, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Too many requests — slow down.' }, { status: 429 })
  }

  let body: { photo_base64?: unknown; mime_type?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const photoBase64 = typeof body.photo_base64 === 'string' ? body.photo_base64 : ''
  const mimeType = typeof body.mime_type === 'string' ? body.mime_type : ''

  if (!photoBase64 || !mimeType) {
    return NextResponse.json(
      { error: 'photo_base64 and mime_type are required' },
      { status: 400 }
    )
  }

  // Strip any "data:image/...;base64," prefix the client may have included.
  const cleanBase64 = photoBase64.replace(/^data:[^;]+;base64,/, '').trim()

  // Approximate decoded size = base64 length * 3/4. Reject early.
  const approxBytes = Math.ceil(cleanBase64.length * 0.75)
  if (approxBytes > MAX_DATA_PLATE_PHOTO_BYTES) {
    return NextResponse.json(
      { error: 'Photo too large; max 4MB' },
      { status: 413 }
    )
  }

  const result = await extractDataPlate(cleanBase64, mimeType)
  if (!result) {
    return NextResponse.json(
      { error: 'AI extraction unavailable. Please enter details manually.' },
      { status: 503 }
    )
  }

  return NextResponse.json({
    extraction: {
      brand: result.brand,
      model: result.model,
      serial: result.serial,
      manufacture_date: result.manufacture_date,
    },
    raw_text: result.raw_text,
    // Legacy flat aliases for the existing scan page until Agent Y migrates it
    make: result.brand.value ?? null,
    model: result.model.value ?? null,
    serial: result.serial.value ?? null,
  })
}
