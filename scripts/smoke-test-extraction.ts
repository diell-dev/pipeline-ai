/**
 * Smoke test for the data-plate extractor — exercises the camera-overlay
 * anti-example to verify that:
 *
 *   1. Few-shot images are loaded from public/data-plate-examples/ and
 *      injected into the prompt.
 *   2. The model identifies Fujitsu / AOU45RLXFZ / LYN014684 with high
 *      confidence on every field.
 *   3. The model does NOT extract the burned-in "Mar 10, 2026" camera
 *      timestamp as the manufacture date (the field must be null).
 *
 * Run with:
 *   ANTHROPIC_API_KEY=sk-ant-... npx jiti scripts/smoke-test-extraction.ts
 *
 * Exits 0 on pass, 1 on fail.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractDataPlate, clearFewShotCache } from '../src/lib/equipment-ai'

const TARGET_FILE = 'fujitsu-aou45rlxfz-camera-overlay.jpeg'
const TARGET_PATH = join(process.cwd(), 'public', 'data-plate-examples', TARGET_FILE)

interface ExpectedOutcome {
  brand: string
  model: string
  serial: string
  manufactureDateIsNull: boolean
  forbiddenSubstrings: string[]
}

const EXPECTED: ExpectedOutcome = {
  brand: 'Fujitsu',
  model: 'AOU45RLXFZ',
  serial: 'LYN014684',
  manufactureDateIsNull: true,
  // None of these strings may appear inside the manufacture_date object.
  forbiddenSubstrings: ['2026-03', '2026/03', 'Mar 10', 'mar 10', '2026'],
}

interface FailureReport {
  ok: boolean
  failures: string[]
}

function checkOutcome(extraction: Awaited<ReturnType<typeof extractDataPlate>>): FailureReport {
  const failures: string[] = []
  if (!extraction) {
    return { ok: false, failures: ['extractDataPlate returned null (API call failed)'] }
  }

  const brandVal = extraction.brand.value ?? ''
  if (brandVal.toLowerCase() !== EXPECTED.brand.toLowerCase()) {
    failures.push(`brand expected "${EXPECTED.brand}", got "${brandVal}"`)
  }
  if (extraction.brand.confidence !== 'high') {
    failures.push(`brand.confidence expected "high", got "${extraction.brand.confidence}"`)
  }

  const modelVal = (extraction.model.value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (modelVal !== EXPECTED.model.toUpperCase().replace(/[^A-Z0-9]/g, '')) {
    failures.push(`model expected "${EXPECTED.model}", got "${extraction.model.value}"`)
  }
  if (extraction.model.confidence !== 'high') {
    failures.push(`model.confidence expected "high", got "${extraction.model.confidence}"`)
  }

  const serialVal = (extraction.serial.value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (serialVal !== EXPECTED.serial.toUpperCase().replace(/[^A-Z0-9]/g, '')) {
    failures.push(`serial expected "${EXPECTED.serial}", got "${extraction.serial.value}"`)
  }
  if (extraction.serial.confidence !== 'high') {
    failures.push(`serial.confidence expected "high", got "${extraction.serial.confidence}"`)
  }

  if (EXPECTED.manufactureDateIsNull && extraction.manufacture_date.value !== null) {
    failures.push(
      `manufacture_date.value expected null, got "${extraction.manufacture_date.value}"`
    )
  }

  // No part of the manufacture_date payload may contain the camera-overlay date.
  const dateBlob = JSON.stringify(extraction.manufacture_date)
  for (const forbidden of EXPECTED.forbiddenSubstrings) {
    if (dateBlob.includes(forbidden)) {
      failures.push(
        `manufacture_date payload contains forbidden camera-overlay substring "${forbidden}": ${dateBlob}`
      )
    }
  }

  return { ok: failures.length === 0, failures }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      'ANTHROPIC_API_KEY is not set. Re-run with `ANTHROPIC_API_KEY=sk-ant-... npx jiti scripts/smoke-test-extraction.ts`.'
    )
    process.exit(2)
  }

  console.log(`Smoke test target: ${TARGET_PATH}`)
  const buf = readFileSync(TARGET_PATH)
  const base64 = buf.toString('base64')
  console.log(`Loaded ${buf.byteLength} bytes (base64 ${base64.length} chars)`)

  clearFewShotCache()
  console.log('Calling extractDataPlate...')
  const result = await extractDataPlate(base64, 'image/jpeg')

  console.log('Extraction result:')
  console.log(JSON.stringify(result, null, 2))

  const report = checkOutcome(result)
  if (report.ok) {
    console.log('\nPASS — camera-overlay anti-example extracted correctly.')
    process.exit(0)
  } else {
    console.error(`\nFAIL — ${report.failures.length} assertion(s) failed:`)
    for (const f of report.failures) console.error(`  - ${f}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Smoke test crashed:', err)
  process.exit(1)
})
