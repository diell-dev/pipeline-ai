/**
 * QR Code Utilities — Equipment Cataloging (Migration 008)
 *
 * Pre-printed sticker codes follow the format `${PREFIX}-${6 chars}` where
 * the suffix is drawn from an unambiguous alphanumeric alphabet (no 0/O/1/I/L)
 * so that field techs reading paper labels don't confuse characters.
 *
 * The QR rendering helper wraps the `qrcode` npm package. We use the SVG
 * output for crisp print quality on Avery 5160 label sheets.
 */
import QRCode from 'qrcode'

// 30 chars — full uppercase alphabet minus visually confusing letters
// (0, O, 1, I, L). 30^6 ≈ 7.3e8 combinations per prefix, more than enough
// for a single org's lifetime.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * Generates a single random sticker code: `${prefix}-XXXXXX`.
 *
 * Collision handling is the caller's responsibility — when inserting into
 * `equipment_qr_codes`, retry on 23505 unique-violation. With 6-char suffixes
 * the per-attempt collision probability is < 1e-7 even at 1M existing codes,
 * so a small retry loop is enough.
 */
export function generateQrCode(prefix: string): string {
  const safePrefix = (prefix || 'EQUIP')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8) || 'EQUIP'

  let suffix = ''
  // crypto.getRandomValues works in both Node 18+ and edge runtimes.
  const buf = new Uint8Array(6)
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(buf)
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  for (let i = 0; i < 6; i++) {
    suffix += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length]
  }
  return `${safePrefix}-${suffix}`
}

/**
 * Renders a QR code as an inline SVG string (no XML prolog).
 */
export async function qrToSvg(text: string, size: number): Promise<string> {
  const safeSize = Math.max(64, Math.min(1024, size | 0))
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: safeSize,
  })
}

/**
 * Renders a QR code as a PNG data URL — used by jsPDF.addImage().
 */
export async function qrToDataUrl(text: string, size: number): Promise<string> {
  const safeSize = Math.max(64, Math.min(1024, size | 0))
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: safeSize,
  })
}
