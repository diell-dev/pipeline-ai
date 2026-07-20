/**
 * Money conversion for the Books module.
 *
 * Every monetary form input funnels through dollarsToCents, so a rounding or
 * parsing slip here silently posts a wrong journal entry.
 */
import { describe, it, expect } from 'vitest'
import { centsToDollars, dollarsToCents } from './format'

describe('dollarsToCents', () => {
  it('parses plain numbers and numeric strings', () => {
    expect(dollarsToCents(50)).toBe(5000)
    expect(dollarsToCents('50')).toBe(5000)
    expect(dollarsToCents('50.25')).toBe(5025)
  })

  it('strips currency symbols and thousands separators', () => {
    expect(dollarsToCents('$50')).toBe(5000)
    expect(dollarsToCents('1,234.56')).toBe(123456)
    expect(dollarsToCents(' $1,000.00 ')).toBe(100000)
  })

  it('returns 0 for empty / null / junk rather than NaN', () => {
    expect(dollarsToCents('')).toBe(0)
    expect(dollarsToCents(null)).toBe(0)
    expect(dollarsToCents(undefined)).toBe(0)
    expect(dollarsToCents('abc')).toBe(0)
    expect(dollarsToCents('-')).toBe(0)
    expect(dollarsToCents('.')).toBe(0)
    expect(dollarsToCents(Number.NaN)).toBe(0)
    expect(dollarsToCents(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('handles negatives (credits / reversals)', () => {
    expect(dollarsToCents('-25.50')).toBe(-2550)
    expect(dollarsToCents(-25.5)).toBe(-2550)
  })

  it('rounds float artefacts to the nearest cent', () => {
    // 19.99 * 100 === 1998.9999999999998 in IEEE-754
    expect(dollarsToCents(19.99)).toBe(1999)
    expect(dollarsToCents('0.1')).toBe(10)
  })

  it('documents the classic half-cent float edge case', () => {
    // 1.005 looks like it should round up to 101, but the nearest double to
    // 1.005 is slightly BELOW it, so 1.005 * 100 === 100.49999999999999 and
    // Math.round yields 100. This is inherent to binary floats, not a bug in
    // dollarsToCents — pinned here so nobody "fixes" it by accident.
    // The real mitigation is that users type cents-precision values; sub-cent
    // input is not a supported case.
    expect(1.005 * 100).toBeLessThan(100.5)
    expect(dollarsToCents(1.005)).toBe(100)
  })

  it('never returns a fractional cent', () => {
    for (const v of ['0.001', '12.345', 7.777]) {
      expect(Number.isInteger(dollarsToCents(v))).toBe(true)
    }
  })
})

describe('centsToDollars', () => {
  it('converts cents to a dollar number', () => {
    expect(centsToDollars(5000)).toBe(50)
    expect(centsToDollars(123456)).toBe(1234.56)
  })

  it('defaults null/undefined/non-finite to 0', () => {
    expect(centsToDollars(null)).toBe(0)
    expect(centsToDollars(undefined)).toBe(0)
    expect(centsToDollars(Number.NaN)).toBe(0)
  })

  it('round-trips with dollarsToCents', () => {
    for (const dollars of [0, 1, 19.99, 1234.56, 0.05]) {
      expect(centsToDollars(dollarsToCents(dollars))).toBe(dollars)
    }
  })
})
