/**
 * Equipment Field Validators
 *
 * Post-extraction sanity checks. When a validator fails, callers should drop
 * the field's confidence to `low` (not nuke the value — the human still needs
 * to see what the AI thought it saw, so they can correct it).
 *
 * Year range: 1980..current+1. Anything older is exceedingly rare in active
 * service and almost certainly an OCR error. Anything newer than next year is
 * impossible.
 *
 * Model regexes are deliberately permissive — they only catch obvious garbage
 * (e.g. a model field that's actually "MODEL NO." or a 1-char string), not
 * every variant a brand might use. False positives here are worse than false
 * negatives.
 */

const CURRENT_YEAR = new Date().getUTCFullYear()
const MIN_YEAR = 1980
const MAX_YEAR = CURRENT_YEAR + 1

/** True iff `year` is a plausible HVAC manufacture year. */
export function validateYear(year: number): boolean {
  if (!Number.isFinite(year)) return false
  if (!Number.isInteger(year)) return false
  return year >= MIN_YEAR && year <= MAX_YEAR
}

/**
 * Per-brand model-number sanity regex. Catches obvious garbage like the
 * literal label text or single-character results; does NOT try to enforce
 * every variant a brand might use in the wild.
 */
const MODEL_RULES: Array<{ family: RegExp; rule: RegExp; min?: number; max?: number }> = [
  // Goodman / Daikin / Amana — alphanumeric, often with dashes, 6-20 chars
  { family: /goodman|daikin|amana/i, rule: /^[A-Z0-9-]{4,25}$/i },
  // Carrier family — alphanumeric, slashes/dashes allowed
  { family: /carrier|bryant|payne|heil|tempstar|comfortmaker|day\s*&?\s*night/i, rule: /^[A-Z0-9./-]{4,30}$/i },
  // Trane / American Standard — uppercase letters + digits, often with slashes
  { family: /trane|american\s*standard|oxbox|ameristar/i, rule: /^[A-Z0-9/-]{4,30}$/i },
  // Lennox family
  { family: /lennox|aire[-\s]?flo|armstrong|ducane|aire[-\s]?ease/i, rule: /^[A-Z0-9/-]{4,30}$/i },
  // York / Luxaire / Coleman / Champion (Johnson Controls)
  { family: /york|luxaire|coleman|champion|johnson\s*controls/i, rule: /^[A-Z0-9/-]{4,30}$/i },
  // Rheem family
  { family: /rheem|ruud|weather\s*king|richmond/i, rule: /^[A-Z0-9/-]{4,30}$/i },
  // Mitsubishi
  { family: /mitsubishi/i, rule: /^[A-Z0-9-]{4,30}$/i },
  // LG
  { family: /^lg|lg\s/i, rule: /^[A-Z0-9-]{4,30}$/i },
  // Fujitsu
  { family: /fujitsu/i, rule: /^[A-Z0-9-]{4,30}$/i },
  // Bosch / Buderus
  { family: /bosch|buderus/i, rule: /^[A-Z0-9/-]{4,30}$/i },
  // Boiler brands
  { family: /weil[-\s]?mclain|burnham|us\s*boiler|navien|rinnai/i, rule: /^[A-Z0-9-]{3,30}$/i },
  // Water heater brands
  { family: /bradford\s*white|a\.?o\.?\s*smith|^state\s|state$/i, rule: /^[A-Z0-9-]{4,30}$/i },
]

/** Catches obviously-invalid model strings (label text, too short, junk). */
export function validateModel(brand: string, model: string): boolean {
  if (!model || typeof model !== 'string') return false
  const trimmed = model.trim()
  if (trimmed.length < 3 || trimmed.length > 40) return false
  // Reject obvious label-text capture
  if (/^model\b/i.test(trimmed)) return false
  if (/^m\/?n\b/i.test(trimmed)) return false
  // Reject if it's all the same character
  if (/^(.)\1+$/.test(trimmed)) return false
  // Reject pure punctuation
  if (!/[A-Z0-9]/i.test(trimmed)) return false

  // Per-brand rule (if known). Unknown brand → only generic checks above.
  const rule = MODEL_RULES.find((r) => r.family.test(brand || ''))?.rule
  if (rule && !rule.test(trimmed)) return false
  return true
}

export interface SerialValidationResult {
  valid: boolean
  reason?: string
}

/** Catches obviously-invalid serial strings (label text, too short, junk). */
export function validateSerial(brand: string, serial: string): SerialValidationResult {
  if (!serial || typeof serial !== 'string') {
    return { valid: false, reason: 'empty serial' }
  }
  const trimmed = serial.trim()
  if (trimmed.length < 4) return { valid: false, reason: 'serial too short (<4 chars)' }
  if (trimmed.length > 40) return { valid: false, reason: 'serial too long (>40 chars)' }
  if (/^serial\b/i.test(trimmed)) return { valid: false, reason: 'serial value looks like label text' }
  if (/^s\/?n\b/i.test(trimmed)) return { valid: false, reason: 'serial value looks like label text (S/N)' }
  if (/^(.)\1+$/.test(trimmed)) return { valid: false, reason: 'serial is a single repeated character' }
  if (!/[A-Z0-9]/i.test(trimmed)) return { valid: false, reason: 'serial contains no alphanumerics' }
  // Brand-specific minimum length hints (very loose)
  const b = (brand || '').toLowerCase()
  if (/carrier|trane|goodman|lennox|york|rheem|ao\s*smith/.test(b) && trimmed.length < 8) {
    return { valid: false, reason: `serial for ${brand} is unusually short (<8 chars)` }
  }
  return { valid: true }
}

/** Parse an ISO YYYY-MM-DD string into a year integer, or null. */
export function parseIsoYear(iso: string | null | undefined): number | null {
  if (!iso) return null
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(iso)
  if (!m) return null
  return parseInt(m[1], 10)
}
