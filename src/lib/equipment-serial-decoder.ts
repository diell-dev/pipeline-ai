/**
 * Equipment Serial Decoder
 *
 * Brand-specific deterministic decoders for HVAC data-plate serial numbers.
 * Used as a post-extraction cross-check against the AI's date guess.
 *
 * Rules are sourced from manufacturer documentation and field-tested decoder
 * cookbooks. When a brand's serial format is ambiguous (e.g. LG / Mitsubishi
 * older formats with single-digit year), we return `low` confidence and
 * include a note explaining the ambiguity rather than guessing.
 *
 * Output dates are always ISO `YYYY-MM-DD`. When only year + week are known
 * we return the Monday of that ISO week. When only year + month are known we
 * return day 01.
 */

export type DecodeConfidence = 'high' | 'medium' | 'low'

export interface SerialDecodeResult {
  /** ISO YYYY-MM-DD or null if undecodable */
  manufacture_date: string | null
  confidence: DecodeConfidence
  /** Human-readable explanation of how the date was derived. */
  method: string
  /** Canonical brand key matched (lowercased family). Useful for logging. */
  brand_key: string | null
}

const CURRENT_YEAR = new Date().getUTCFullYear()

/* ─────────────────── helpers ─────────────────── */

function normaliseBrand(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Map any incoming brand string to a canonical decoder family key. */
function brandFamily(brand: string): string | null {
  const b = normaliseBrand(brand)
  if (!b) return null

  const families: Array<[string, string[]]> = [
    [
      'carrier',
      ['carrier', 'bryant', 'payne', 'heil', 'tempstar', 'day and night', 'day night', 'comfortmaker'],
    ],
    ['trane', ['trane', 'american standard', 'oxbox', 'ameristar']],
    ['lennox', ['lennox', 'aireflo', 'aire flo', 'armstrong', 'ducane', 'airease', 'aire ease']],
    ['york', ['york', 'luxaire', 'coleman', 'champion', 'johnson controls']],
    // Daikin sells through two corporate entities — Daikin Industries, LTD. (Japan
    // parent, units often built in Thailand or PRC) and Daikin Manufacturing Company,
    // L.P. (US subsidiary, units typically assembled in USA). Both use identical
    // YYMM serial prefixes and YYYY.M printed plate dates, so both alias into the
    // goodman family decoder.
    ['goodman', ['goodman', 'amana', 'daikin', 'daikin industries', 'daikin manufacturing']],
    ['rheem', ['rheem', 'ruud', 'weather king', 'weatherking', 'richmond']],
    ['mitsubishi', ['mitsubishi']],
    ['lg', ['lg']],
    ['fujitsu', ['fujitsu']],
    ['bosch', ['bosch', 'buderus']],
    ['weilmclain', ['weil mclain', 'weilmclain', 'weil-mclain']],
    ['burnham', ['burnham', 'us boiler', 'u s boiler']],
    ['navien', ['navien']],
    ['rinnai', ['rinnai']],
    ['bradfordwhite', ['bradford white', 'bradfordwhite']],
    ['aosmith', ['ao smith', 'a o smith', 'aosmith', 'state']],
  ]

  for (const [key, aliases] of families) {
    if (aliases.some((alias) => b === alias || b.includes(alias))) return key
  }
  return null
}

/** Monday of ISO week `ww` in `year` (UTC). */
function isoWeekMonday(year: number, week: number): string | null {
  if (year < 1980 || year > CURRENT_YEAR + 1) return null
  if (week < 1 || week > 53) return null
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7
  const week1Monday = new Date(jan4)
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1))
  const target = new Date(week1Monday)
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7)
  return target.toISOString().slice(0, 10)
}

/** First-of-month for year + month. */
function firstOfMonth(year: number, month: number): string | null {
  if (year < 1980 || year > CURRENT_YEAR + 1) return null
  if (month < 1 || month > 12) return null
  const d = new Date(Date.UTC(year, month - 1, 1))
  return d.toISOString().slice(0, 10)
}

function clean(serial: string): string {
  return (serial || '').toUpperCase().replace(/\s+/g, '')
}

/** Lennox month-letter alphabet: A=Jan..M=Dec, skipping I. */
function lennoxMonthLetter(letter: string): number | null {
  // A,B,C,D,E,F,G,H,J,K,L,M
  const map: Record<string, number> = {
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 9, K: 10, L: 11, M: 12,
  }
  return map[letter] ?? null
}

/** Rinnai year-letter cycle: A=2009..S=2025 (skips I, O). */
function rinnaiYearLetter(letter: string): number | null {
  const sequence = ['A','B','C','D','E','F','G','H','J','K','L','M','N','P','Q','R','S']
  // A=2009, B=2010, ..., H=2016, J=2017, K=2018, L=2019, M=2020, N=2021, P=2022, Q=2023, R=2024, S=2025
  const idx = sequence.indexOf(letter)
  if (idx < 0) return null
  return 2009 + idx
}

function decadeFromYY(yy: number): number {
  // 00..29 → 2000s, 30..99 → 1900s (legacy convention, fine for HVAC plates)
  return yy <= 29 ? 2000 + yy : 1900 + yy
}

/* ─────────────────── per-family decoders ─────────────────── */

function decodeCarrier(serial: string): SerialDecodeResult {
  // 10-char, leading WWYY (week 01-52, then 2-digit year)
  const s = clean(serial)
  const m = s.match(/^(\d{2})(\d{2})/)
  if (!m) {
    return { manufacture_date: null, confidence: 'low', method: 'carrier-family: serial did not start with 4 digits', brand_key: 'carrier' }
  }
  const week = parseInt(m[1], 10)
  const yy = parseInt(m[2], 10)
  const year = decadeFromYY(yy)
  if (week < 1 || week > 53) {
    return { manufacture_date: null, confidence: 'low', method: 'carrier-family: WW out of range', brand_key: 'carrier' }
  }
  const iso = isoWeekMonday(year, week)
  if (!iso) {
    return { manufacture_date: null, confidence: 'low', method: 'carrier-family: WWYY decoded but out of sane year window', brand_key: 'carrier' }
  }
  return { manufacture_date: iso, confidence: 'high', method: `carrier-family WWYY: week ${week} of ${year}`, brand_key: 'carrier' }
}

function decodeTrane(serial: string): SerialDecodeResult {
  // Modern (2010+): 9+ chars, leading YYWWD where YY is 2-digit year, WW is week, D is weekday
  const s = clean(serial)
  const m = s.match(/^(\d{2})(\d{2})(\d)/)
  if (!m) {
    return { manufacture_date: null, confidence: 'low', method: 'trane-family: serial did not start with YYWWD numeric prefix; pre-2010 alphabetic codes not auto-decoded', brand_key: 'trane' }
  }
  const yy = parseInt(m[1], 10)
  const ww = parseInt(m[2], 10)
  const year = decadeFromYY(yy)
  if (ww < 1 || ww > 53) {
    return { manufacture_date: null, confidence: 'low', method: 'trane-family: WW out of range', brand_key: 'trane' }
  }
  const iso = isoWeekMonday(year, ww)
  if (!iso) {
    return { manufacture_date: null, confidence: 'low', method: 'trane-family: YYWWD decoded but out of sane year window', brand_key: 'trane' }
  }
  // confidence drops to medium for years before 2010 (the rule strictly applies post-2010)
  const confidence: DecodeConfidence = year >= 2010 ? 'high' : 'medium'
  return { manufacture_date: iso, confidence, method: `trane-family YYWWD: week ${ww} of ${year}`, brand_key: 'trane' }
}

function decodeLennox(serial: string): SerialDecodeResult {
  // 10-char; digits 3-4 = year (last 2), char 5 = month letter
  const s = clean(serial)
  if (s.length < 5) {
    return { manufacture_date: null, confidence: 'low', method: 'lennox-family: serial too short', brand_key: 'lennox' }
  }
  const yearDigits = s.slice(2, 4)
  const monthLetter = s.charAt(4)
  if (!/^\d{2}$/.test(yearDigits)) {
    return { manufacture_date: null, confidence: 'low', method: 'lennox-family: positions 3-4 not numeric', brand_key: 'lennox' }
  }
  const month = lennoxMonthLetter(monthLetter)
  if (month == null) {
    return { manufacture_date: null, confidence: 'low', method: `lennox-family: month letter '${monthLetter}' not in A-M (skip I)`, brand_key: 'lennox' }
  }
  const year = decadeFromYY(parseInt(yearDigits, 10))
  const iso = firstOfMonth(year, month)
  if (!iso) {
    return { manufacture_date: null, confidence: 'low', method: 'lennox-family: year out of sane window', brand_key: 'lennox' }
  }
  return { manufacture_date: iso, confidence: 'high', method: `lennox-family: ${monthLetter}=month ${month}, year ${year}`, brand_key: 'lennox' }
}

function decodeYork(serial: string): SerialDecodeResult {
  // Post-2004 format: L#L#NNNNNN where pos2 = decade digit, pos3 = month letter, pos4 = year-units digit.
  // Example: W1G7XXXXXX → decade-digit 1, month G (Jul), year-units 7 → July 2017.
  const s = clean(serial)
  if (s.length < 4) {
    return { manufacture_date: null, confidence: 'low', method: 'york-family: serial too short', brand_key: 'york' }
  }
  const decadeDigit = s.charAt(1)
  const monthLetter = s.charAt(2)
  const unitsDigit = s.charAt(3)
  if (!/\d/.test(decadeDigit) || !/\d/.test(unitsDigit)) {
    return { manufacture_date: null, confidence: 'low', method: 'york-family: decade or units digit not numeric', brand_key: 'york' }
  }
  const month = lennoxMonthLetter(monthLetter) // same A-M skip-I convention
  if (month == null) {
    return { manufacture_date: null, confidence: 'low', method: `york-family: month letter '${monthLetter}' not in A-M (skip I)`, brand_key: 'york' }
  }
  // Decade digit: 0 = 2000s, 1 = 2010s, 2 = 2020s ... (post-2004 scheme).
  const decade = parseInt(decadeDigit, 10)
  const units = parseInt(unitsDigit, 10)
  const year = 2000 + decade * 10 + units
  const iso = firstOfMonth(year, month)
  if (!iso) {
    return { manufacture_date: null, confidence: 'low', method: 'york-family: decoded year out of sane window', brand_key: 'york' }
  }
  return { manufacture_date: iso, confidence: 'high', method: `york-family L#L# decode: ${monthLetter}=${month}, year ${year}`, brand_key: 'york' }
}

function decodeGoodman(serial: string): SerialDecodeResult {
  // 10-char, leading YYMM. e.g. 9901XXXXXX = Jan 1999; 2306A123456 = Jun 2023.
  // Daikin also prints "MFG. DATE YYYY.M" decimal — that's handled at the AI layer.
  const s = clean(serial)
  const m = s.match(/^(\d{2})(\d{2})/)
  if (!m) {
    return { manufacture_date: null, confidence: 'low', method: 'goodman-family: serial did not start with YYMM', brand_key: 'goodman' }
  }
  const yy = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  if (month < 1 || month > 12) {
    return { manufacture_date: null, confidence: 'low', method: 'goodman-family: month out of range', brand_key: 'goodman' }
  }
  const year = decadeFromYY(yy)
  const iso = firstOfMonth(year, month)
  if (!iso) {
    return { manufacture_date: null, confidence: 'low', method: 'goodman-family: decoded year out of sane window', brand_key: 'goodman' }
  }
  return { manufacture_date: iso, confidence: 'high', method: `goodman-family YYMM: year ${year}, month ${month}`, brand_key: 'goodman' }
}

function decodeRheem(serial: string): SerialDecodeResult {
  // First 2 digits AFTER an optional single letter prefix = week, next 2 = year.
  // Example: XXXX4217XXXXX (from the cookbook) — the WWYY pair sits within the serial.
  // Strategy: skip leading letters, then read WWYY from the first 4 digits.
  const s = clean(serial)
  const m = s.match(/^[A-Z]?(\d{2})(\d{2})/)
  if (!m) {
    return { manufacture_date: null, confidence: 'low', method: 'rheem-family: could not find WWYY after optional letter prefix', brand_key: 'rheem' }
  }
  const week = parseInt(m[1], 10)
  const yy = parseInt(m[2], 10)
  if (week < 1 || week > 53) {
    return { manufacture_date: null, confidence: 'low', method: 'rheem-family: WW out of range', brand_key: 'rheem' }
  }
  const year = decadeFromYY(yy)
  const iso = isoWeekMonday(year, week)
  if (!iso) {
    return { manufacture_date: null, confidence: 'low', method: 'rheem-family: decoded year out of sane window', brand_key: 'rheem' }
  }
  return { manufacture_date: iso, confidence: 'high', method: `rheem-family WWYY: week ${week} of ${year}`, brand_key: 'rheem' }
}

/** Mitsubishi older-format month code: 1-9 = Jan-Sep, X = Oct, Y = Nov, Z = Dec. */
function mitsubishiOldMonthCode(ch: string): number | null {
  if (ch >= '1' && ch <= '9') return parseInt(ch, 10)
  if (ch === 'X') return 10
  if (ch === 'Y') return 11
  if (ch === 'Z') return 12
  return null
}

function decodeMitsubishi(serial: string): SerialDecodeResult {
  // Older format pattern: <digit><Z|Y|X|1-9><alpha><digits> (e.g. 4ZU01001A).
  //   char 1 = year-units digit (DECADE AMBIGUOUS — could be 200X, 201X, or 202X)
  //   char 2 = month code (1-9 = Jan-Sep, X = Oct, Y = Nov, Z = Dec)
  //   char 3 = factory/line letter
  //   followed by digits and an optional trailing letter
  // Modern format: 6+ digits where first 2 digits encode YY.
  const s = clean(serial)

  // Detect the older format FIRST — it would otherwise be misclassified.
  const older = s.match(/^(\d)([1-9XYZ])[A-Z]\d/)
  if (older) {
    const unitsDigit = older[1]
    const monthCode = older[2]
    const month = mitsubishiOldMonthCode(monthCode)
    const monthName = month != null
      ? ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month]
      : monthCode
    return {
      manufacture_date: null,
      confidence: 'low',
      method:
        `Decade-ambiguous Mitsubishi format. Year-units digit = ${unitsDigit}, month = ${monthCode} (${monthName}). ` +
        `Could be 200${unitsDigit}, 201${unitsDigit}, or 202${unitsDigit}. Disambiguate by refrigerant: ` +
        `R-22 → 200${unitsDigit}, R-410A → 201${unitsDigit} or 202${unitsDigit}, R-32 or R-454B → 202${unitsDigit}.`,
      brand_key: 'mitsubishi',
    }
  }

  // Modern (2010+): first 2 digits = year (full 4-digit interpreted via decade rule).
  const modern = s.match(/^(\d{2})/)
  if (modern) {
    const yy = parseInt(modern[1], 10)
    const year = decadeFromYY(yy)
    // We can't get month from this format without more rules — return Jan 1 medium confidence.
    const iso = firstOfMonth(year, 1)
    if (iso) {
      return {
        manufacture_date: iso,
        confidence: year >= 2010 ? 'medium' : 'low',
        method: `mitsubishi modern: year ${year} (month unknown, defaulting to Jan)`,
        brand_key: 'mitsubishi',
      }
    }
  }

  return {
    manufacture_date: null,
    confidence: 'low',
    method: 'mitsubishi: serial did not match known modern or older format',
    brand_key: 'mitsubishi',
  }
}

function decodeLG(): SerialDecodeResult {
  // char 1 = country letter, then Y-MM (year digit + 2-digit month).
  // DECADE AMBIGUOUS — return low + ask AI/photo to disambiguate.
  return {
    manufacture_date: null,
    confidence: 'low',
    method: 'lg: decade-ambiguous single year digit; refrigerant tiebreaker required (same rule as Mitsubishi)',
    brand_key: 'lg',
  }
}

function decodeFujitsu(): SerialDecodeResult {
  return {
    manufacture_date: null,
    confidence: 'low',
    method: 'fujitsu: serial does NOT encode manufacture date; lookup required via Fujitsu warranty portal',
    brand_key: 'fujitsu',
  }
}

function decodeBosch(serial: string): SerialDecodeResult {
  // 2010+: chars 5-7 of serial encode YYM (year + month) regardless of dashes.
  const s = clean(serial).replace(/-/g, '')
  if (s.length < 7) {
    return { manufacture_date: null, confidence: 'low', method: 'bosch: serial too short for YYM decode at chars 5-7', brand_key: 'bosch' }
  }
  const segment = s.slice(4, 7)
  const m = segment.match(/^(\d{2})(\d)$/)
  if (!m) {
    return { manufacture_date: null, confidence: 'low', method: 'bosch: chars 5-7 not YYM numeric pattern; pre-2010 fallback not auto-decoded', brand_key: 'bosch' }
  }
  const yy = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  if (month < 1 || month > 12) {
    return { manufacture_date: null, confidence: 'low', method: 'bosch: month out of range', brand_key: 'bosch' }
  }
  const year = decadeFromYY(yy)
  const iso = firstOfMonth(year, month)
  if (!iso) {
    return { manufacture_date: null, confidence: 'low', method: 'bosch: decoded year out of sane window', brand_key: 'bosch' }
  }
  return { manufacture_date: iso, confidence: 'medium', method: `bosch YYM at chars 5-7: year ${year}, month ${month}`, brand_key: 'bosch' }
}

function decodeWeilMclain(): SerialDecodeResult {
  return {
    manufacture_date: null,
    confidence: 'low',
    method: 'weil-mclain: 7-digit CP number; pre-1979 MM-YY / 1979-2002 letter pairs / 2000+ YYYYMM — too many overlapping formats to auto-decode',
    brand_key: 'weilmclain',
  }
}

function decodeBurnham(): SerialDecodeResult {
  return {
    manufacture_date: null,
    confidence: 'low',
    method: 'burnham/us-boiler: modern label prints MM/YYYY plainly; rely on plate-printed date, not serial',
    brand_key: 'burnham',
  }
}

function decodeNavien(serial: string): SerialDecodeResult {
  // First 6 digits of serial = YYMMDD
  const s = clean(serial)
  const m = s.match(/^(\d{2})(\d{2})(\d{2})/)
  if (!m) {
    return { manufacture_date: null, confidence: 'low', method: 'navien: first 6 chars not YYMMDD numeric', brand_key: 'navien' }
  }
  const yy = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const day = parseInt(m[3], 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { manufacture_date: null, confidence: 'low', method: 'navien: month/day out of range', brand_key: 'navien' }
  }
  const year = decadeFromYY(yy)
  if (year < 1980 || year > CURRENT_YEAR + 1) {
    return { manufacture_date: null, confidence: 'low', method: 'navien: year out of sane window', brand_key: 'navien' }
  }
  const d = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(d.getTime())) {
    return { manufacture_date: null, confidence: 'low', method: 'navien: invalid YYMMDD', brand_key: 'navien' }
  }
  return { manufacture_date: d.toISOString().slice(0, 10), confidence: 'high', method: `navien YYMMDD: ${year}-${month}-${day}`, brand_key: 'navien' }
}

function decodeRinnai(serial: string): SerialDecodeResult {
  // 2009+: char 1 = year letter, char 2 = month letter (Lennox alphabet).
  const s = clean(serial)
  if (s.length < 2) {
    return { manufacture_date: null, confidence: 'low', method: 'rinnai: serial too short', brand_key: 'rinnai' }
  }
  const year = rinnaiYearLetter(s.charAt(0))
  const month = lennoxMonthLetter(s.charAt(1))
  if (year == null) {
    return { manufacture_date: null, confidence: 'low', method: `rinnai: year letter '${s.charAt(0)}' not in 2009+ sequence`, brand_key: 'rinnai' }
  }
  if (month == null) {
    return { manufacture_date: null, confidence: 'low', method: `rinnai: month letter '${s.charAt(1)}' not in A-M (skip I)`, brand_key: 'rinnai' }
  }
  const iso = firstOfMonth(year, month)
  if (!iso) {
    return { manufacture_date: null, confidence: 'low', method: 'rinnai: decoded year out of sane window', brand_key: 'rinnai' }
  }
  return { manufacture_date: iso, confidence: 'high', method: `rinnai letter pair: year ${year}, month ${month}`, brand_key: 'rinnai' }
}

function decodeBradfordWhite(): SerialDecodeResult {
  return {
    manufacture_date: null,
    confidence: 'low',
    method: 'bradford white: 20-year rotating letter cycle (skips I,O,Q,R,U,V) is ambiguous; cross-reference ANSI standard date on plate',
    brand_key: 'bradfordwhite',
  }
}

function decodeAOSmith(serial: string): SerialDecodeResult {
  // 2008+: YYWW leading
  const s = clean(serial)
  const m = s.match(/^(\d{2})(\d{2})/)
  if (!m) {
    return { manufacture_date: null, confidence: 'low', method: 'ao-smith: first 4 chars not YYWW numeric', brand_key: 'aosmith' }
  }
  const yy = parseInt(m[1], 10)
  const week = parseInt(m[2], 10)
  if (week < 1 || week > 53) {
    return { manufacture_date: null, confidence: 'low', method: 'ao-smith: WW out of range', brand_key: 'aosmith' }
  }
  const year = decadeFromYY(yy)
  const iso = isoWeekMonday(year, week)
  if (!iso) {
    return { manufacture_date: null, confidence: 'low', method: 'ao-smith: decoded year out of sane window', brand_key: 'aosmith' }
  }
  return { manufacture_date: iso, confidence: 'high', method: `ao-smith YYWW: week ${week} of ${year}`, brand_key: 'aosmith' }
}

/* ─────────────────── public API ─────────────────── */

/**
 * Decode the manufacture date from an HVAC equipment serial number using
 * brand-specific rules. Returns null + low confidence for unknown brands or
 * unparseable serials. NEVER guesses — always conservative.
 */
export function decodeSerial(brand: string, serial: string): SerialDecodeResult {
  const safeSerial = (serial || '').trim()
  if (!safeSerial) {
    return { manufacture_date: null, confidence: 'low', method: 'empty serial', brand_key: null }
  }
  const family = brandFamily(brand || '')
  if (!family) {
    return { manufacture_date: null, confidence: 'low', method: 'brand not in known decoder cookbook', brand_key: null }
  }

  switch (family) {
    case 'carrier': return decodeCarrier(safeSerial)
    case 'trane': return decodeTrane(safeSerial)
    case 'lennox': return decodeLennox(safeSerial)
    case 'york': return decodeYork(safeSerial)
    case 'goodman': return decodeGoodman(safeSerial)
    case 'rheem': return decodeRheem(safeSerial)
    case 'mitsubishi': return decodeMitsubishi(safeSerial)
    case 'lg': return decodeLG()
    case 'fujitsu': return decodeFujitsu()
    case 'bosch': return decodeBosch(safeSerial)
    case 'weilmclain': return decodeWeilMclain()
    case 'burnham': return decodeBurnham()
    case 'navien': return decodeNavien(safeSerial)
    case 'rinnai': return decodeRinnai(safeSerial)
    case 'bradfordwhite': return decodeBradfordWhite()
    case 'aosmith': return decodeAOSmith(safeSerial)
    default:
      return { manufacture_date: null, confidence: 'low', method: `unhandled family: ${family}`, brand_key: family }
  }
}
