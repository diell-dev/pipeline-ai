/**
 * Data-plate extraction schema — shared contract between the frontend
 * confirmation UI (Agent Y) and the backend OCR + register endpoints
 * (Agent X).
 *
 * The AI returns a per-field object instead of a flat string so the UI can
 * surface confidence, source-text quotes from the image, and brand-specific
 * notes (e.g. "Daikin YYWW", "Fujitsu needs warranty portal lookup"). The
 * register endpoint logs BOTH the AI's guess AND the tech's confirmed value
 * so the system can learn from corrections (see AI_LEARNING_LOOP.md).
 *
 * Backward compatibility:
 *  - Old OCR responses (flat {make, model, serial}) are normalised to this
 *    shape on the client. Both shapes are accepted while Agent X's new
 *    extractor rolls out.
 *  - The register endpoint accepts the new shape (ai_extraction +
 *    confirmed_extraction + corrected_fields) AS WELL AS the legacy flat
 *    make/model/serial_number fields, so existing callers don't break.
 */

export type ExtractionConfidence = 'high' | 'medium' | 'low'

export type ManufactureDateSource = 'plate' | 'serial' | null

/** Generic per-field result. */
export interface ExtractedField {
  /** AI's best guess. Null if the AI couldn't extract a value. */
  value: string | null
  /** Verbatim quote from the image, when available. */
  source_text: string | null
  /** How confident the AI is in its `value`. */
  confidence: ExtractionConfidence
}

/** Manufacture-date carries extra metadata: where the value came from + any caveats. */
export interface ExtractedManufactureDate extends ExtractedField {
  /**
   * 'plate' — the date was printed directly on the nameplate.
   * 'serial' — the date was decoded from the serial number (e.g. YYWW).
   * null — no date was extracted.
   */
  decoded_from: ManufactureDateSource
  /**
   * Brand-specific helper text shown under the field. Examples:
   *  - "Fujitsu has no serial-encoded date — lookup via warranty portal"
   *  - "Decade ambiguous — this could be 2009, 2019 or 2029"
   *  - "Decoded from serial YYWW prefix"
   */
  notes: string | null
}

/**
 * Full structured extraction returned by /api/equipment/ocr-data-plate.
 * Every field is always present; null `value` means "AI couldn't read it".
 */
export interface StructuredDataPlateExtraction {
  brand: ExtractedField
  model: ExtractedField
  serial: ExtractedField
  manufacture_date: ExtractedManufactureDate
}

/** The four field keys we capture per scan. */
export type ExtractionFieldKey = keyof StructuredDataPlateExtraction

/**
 * Per-field record sent to the register endpoint so we can learn from
 * tech corrections. The shape is:
 *   { brand: 'Carrier', model: '24ACC624', serial: '...', manufacture_date: '2021-03-08' }
 * (i.e. the value the tech ultimately confirmed, post-edit.)
 */
export type ConfirmedExtractionValues = {
  [K in ExtractionFieldKey]: string | null
}

/**
 * Which fields the tech changed vs accepted as-is. True means the final
 * value differs from `ai_extraction[field].value`. Used by the audit query
 * to surface "manufacture date was wrong 40% of the time for Daikin".
 */
export type CorrectedFieldsMap = {
  [K in ExtractionFieldKey]: boolean
}

/**
 * Helper: empty extraction used as a fallback when OCR fails entirely or
 * we have no AI run yet (e.g. user typed everything manually before the
 * photo was processed).
 */
export function emptyExtraction(): StructuredDataPlateExtraction {
  return {
    brand: { value: null, source_text: null, confidence: 'low' },
    model: { value: null, source_text: null, confidence: 'low' },
    serial: { value: null, source_text: null, confidence: 'low' },
    manufacture_date: {
      value: null,
      source_text: null,
      confidence: 'low',
      decoded_from: null,
      notes: null,
    },
  }
}

/**
 * Normaliser: accept either the new structured shape OR the legacy flat
 * { make, model, serial, raw_text } shape and always return the structured
 * shape. Lets the UI talk to either Agent X's updated endpoint or the
 * pre-overhaul endpoint without branching everywhere.
 */
export function normaliseExtractionResponse(
  json: unknown
): StructuredDataPlateExtraction {
  if (!json || typeof json !== 'object') return emptyExtraction()
  const obj = json as Record<string, unknown>

  // New structured shape: has a `brand` (or `model`) object with a `value` key.
  const looksStructured =
    obj.brand && typeof obj.brand === 'object' && 'value' in (obj.brand as object)
  if (looksStructured) {
    return {
      brand: normaliseField(obj.brand),
      model: normaliseField(obj.model),
      serial: normaliseField(obj.serial),
      manufacture_date: normaliseDateField(obj.manufacture_date),
    }
  }

  // Legacy flat shape: { make, model, serial, raw_text }
  const make = typeof obj.make === 'string' ? obj.make : null
  const model = typeof obj.model === 'string' ? obj.model : null
  const serial = typeof obj.serial === 'string' ? obj.serial : null
  return {
    brand: {
      value: make,
      source_text: null,
      confidence: make ? 'medium' : 'low',
    },
    model: {
      value: model,
      source_text: null,
      confidence: model ? 'medium' : 'low',
    },
    serial: {
      value: serial,
      source_text: null,
      confidence: serial ? 'medium' : 'low',
    },
    manufacture_date: {
      value: null,
      source_text: null,
      confidence: 'low',
      decoded_from: null,
      notes: null,
    },
  }
}

function normaliseField(input: unknown): ExtractedField {
  const obj = (input && typeof input === 'object' ? input : {}) as Record<
    string,
    unknown
  >
  return {
    value: typeof obj.value === 'string' ? obj.value : null,
    source_text:
      typeof obj.source_text === 'string' ? obj.source_text : null,
    confidence: normaliseConfidence(obj.confidence),
  }
}

function normaliseDateField(input: unknown): ExtractedManufactureDate {
  const obj = (input && typeof input === 'object' ? input : {}) as Record<
    string,
    unknown
  >
  const decoded =
    obj.decoded_from === 'plate' || obj.decoded_from === 'serial'
      ? obj.decoded_from
      : null
  return {
    value: typeof obj.value === 'string' ? obj.value : null,
    source_text:
      typeof obj.source_text === 'string' ? obj.source_text : null,
    confidence: normaliseConfidence(obj.confidence),
    decoded_from: decoded,
    notes: typeof obj.notes === 'string' ? obj.notes : null,
  }
}

function normaliseConfidence(input: unknown): ExtractionConfidence {
  if (input === 'high' || input === 'medium' || input === 'low') return input
  return 'low'
}
