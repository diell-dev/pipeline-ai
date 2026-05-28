/**
 * Ground-truth data-plate examples
 *
 * Nine real WhatsApp photos provided by Bogdan May (NYSD) of HVAC / boiler
 * data plates encountered in the field. Each entry records the human-verified
 * brand / model / serial / manufacture_date for the unit in the photo.
 *
 * These examples drive two things:
 *   1. Few-shot images injected into the Claude vision extraction prompt
 *      (see `EXTRACTION_FEW_SHOT_KEYS` in equipment-ai.ts).
 *   2. The smoke-test in `scripts/smoke-test-extraction.ts` which asserts the
 *      extractor produces the verified output for the camera-overlay anti-
 *      example.
 *
 * Anti-examples (`is_anti_example: true`) demonstrate things the extractor
 * MUST NOT do — e.g. the Fujitsu AOU45RLXFZ photo has a "Mar 10, 2026 14:00:01"
 * camera-timestamp overlay burned into the bottom-right by the field-service
 * app. That overlay is NOT the manufacture date. The extractor must return
 * `manufacture_date.value = null` for that photo.
 */

export interface DataPlateExample {
  /** Filename inside public/data-plate-examples/ */
  filename: string
  /** Publicly servable path (e.g. /data-plate-examples/sellers-300hp.jpeg) */
  public_url_path: string
  /** Human-recognised brand family ("Fujitsu", "Daikin", "Mitsubishi", ...) */
  brand: string
  /** Model number exactly as printed on the plate */
  model: string
  /** Serial number exactly as printed on the plate (or "(cropped)" when not visible) */
  serial: string
  /**
   * Manufacture date in ISO format: YYYY-MM-DD, YYYY-MM, or null when the
   * plate doesn't stamp one and the serial doesn't encode it.
   */
  manufacture_date: string | null
  /** Short human description of the unit and any verification gotchas */
  notes: string
  /** true if the photo demonstrates what the extractor must NOT do */
  is_anti_example: boolean
}

export const DATA_PLATE_EXAMPLES: DataPlateExample[] = [
  {
    filename: 'fujitsu-aou48rlxfz1.jpeg',
    public_url_path: '/data-plate-examples/fujitsu-aou48rlxfz1.jpeg',
    brand: 'Fujitsu',
    model: 'AOU48RLXFZ1',
    serial: 'LWN007884',
    manufacture_date: null,
    notes:
      'Outdoor split AC, R-410A, built in Thailand. Fujitsu does NOT stamp a MFG date and does NOT encode date in the serial — manufacture_date is null.',
    is_anti_example: false,
  },
  {
    filename: 'fujitsu-asu9rlf1-mxa143571.jpeg',
    public_url_path: '/data-plate-examples/fujitsu-asu9rlf1-mxa143571.jpeg',
    brand: 'Fujitsu',
    model: 'ASU9RLF1',
    serial: 'MXA143571',
    manufacture_date: null,
    notes:
      'Indoor split AC, built in PRC. Fujitsu does not encode date in serial — manufacture_date is null.',
    is_anti_example: false,
  },
  {
    filename: 'sellers-300hp.jpeg',
    public_url_path: '/data-plate-examples/sellers-300hp.jpeg',
    brand: 'Sellers',
    model: '300 HP MODEL 15 SENIOR',
    serial: '103482B',
    manufacture_date: '2006-06-16',
    notes:
      'Industrial steam boiler, natural gas, 12.5M BTU. MFG date stamped on plate.',
    is_anti_example: false,
  },
  {
    filename: 'mitsubishi-mxz-4c36-partial.jpeg',
    public_url_path: '/data-plate-examples/mitsubishi-mxz-4c36-partial.jpeg',
    brand: 'Mitsubishi Electric',
    model: 'MXZ-4C36NAHZ',
    serial: '(cropped)',
    manufacture_date: null,
    notes:
      'Heat pump, partial photo — serial label is outside the frame. Serial value is unknown from this photo.',
    is_anti_example: false,
  },
  {
    filename: 'mitsubishi-mxz-4c36-full.jpeg',
    public_url_path: '/data-plate-examples/mitsubishi-mxz-4c36-full.jpeg',
    brand: 'Mitsubishi Electric',
    model: 'MXZ-4C36NAHZ',
    serial: '4ZU01001A',
    manufacture_date: null,
    notes:
      'Made in Japan, R-410A. Serial 4ZU01001A is the older Mitsubishi format: char 1 = year-units (4 → 2004, 2014, or 2024), char 2 = Z = December. Decade-ambiguous; refrigerant R-410A narrows to 2014 or 2024.',
    is_anti_example: false,
  },
  {
    filename: 'fujitsu-asu9rlf1-mxa250569.jpeg',
    public_url_path: '/data-plate-examples/fujitsu-asu9rlf1-mxa250569.jpeg',
    brand: 'Fujitsu',
    model: 'ASU9RLF1',
    serial: 'MXA250569',
    manufacture_date: null,
    notes:
      'Indoor split AC, badly faded label. Fujitsu does not encode date in serial — manufacture_date is null.',
    is_anti_example: false,
  },
  {
    filename: 'fujitsu-aou45rlxfz-camera-overlay.jpeg',
    public_url_path: '/data-plate-examples/fujitsu-aou45rlxfz-camera-overlay.jpeg',
    brand: 'Fujitsu',
    model: 'AOU45RLXFZ',
    serial: 'LYN014684',
    manufacture_date: null,
    notes:
      'ANTI-EXAMPLE. Camera/app burned "Mar 10, 2026 14:00:01 / 1117 Fulton Street / Brooklyn / Kings County / New York" into the bottom-right of the photo. That is the photo timestamp, NOT the manufacture date. Fujitsu plates do not stamp a MFG date — manufacture_date is null.',
    is_anti_example: true,
  },
  {
    filename: 'daikin-ctxs07lvju.jpeg',
    public_url_path: '/data-plate-examples/daikin-ctxs07lvju.jpeg',
    brand: 'Daikin',
    model: 'CTXS07LVJU',
    serial: 'E043020',
    manufacture_date: '2016-10',
    notes:
      'Fan coil unit indoor section, built in Thailand by Daikin Industries Ltd (Japan parent). MFG DATE stamped "2016.10" (YYYY.M decimal format).',
    is_anti_example: false,
  },
  {
    filename: 'daikin-reyq168tatju.jpeg',
    public_url_path: '/data-plate-examples/daikin-reyq168tatju.jpeg',
    brand: 'Daikin',
    model: 'REYQ168TATJU',
    serial: '1812238102',
    manufacture_date: '2018-12',
    notes:
      'VRV outdoor heat pump, assembled in USA by Daikin Manufacturing Company L.P. Serial prefix 1812 = December 2018 (YYMM). MFG DATE stamped 2018.12 confirms.',
    is_anti_example: false,
  },
]

/**
 * Filenames used as few-shot images in the extraction prompt. Order matters —
 * see the comment block in equipment-ai.ts where these are injected.
 *
 * Selection rationale:
 *   1. daikin-reyq168tatju  — clearest stamped MFG DATE + YYMM serial decode
 *   2. fujitsu-aou48rlxfz1  — no stamped date, no serial-encoded date (null)
 *   3. fujitsu-aou45rlxfz-camera-overlay — camera-overlay anti-example
 */
export const EXTRACTION_FEW_SHOT_FILENAMES = [
  'daikin-reyq168tatju.jpeg',
  'fujitsu-aou48rlxfz1.jpeg',
  'fujitsu-aou45rlxfz-camera-overlay.jpeg',
] as const

export function getExampleByFilename(filename: string): DataPlateExample | undefined {
  return DATA_PLATE_EXAMPLES.find((e) => e.filename === filename)
}
