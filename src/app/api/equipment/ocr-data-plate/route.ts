/**
 * POST /api/equipment/ocr-data-plate
 *
 * Body: { photo_base64: string, mime_type: string }
 *
 * Sends the photo to Claude's vision model and returns the parsed make/model/
 * serial. No DB write — the UI uses the response to pre-fill the registration
 * form, and the user confirms before submitting.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getApiUser } from '@/lib/api-auth'
import { extractDataPlate, MAX_DATA_PLATE_PHOTO_BYTES } from '@/lib/equipment-ai'

export async function POST(request: NextRequest) {
  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
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

  return NextResponse.json(result)
}
