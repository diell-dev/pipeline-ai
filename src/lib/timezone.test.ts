/**
 * Timezone helpers (audit G4).
 *
 * These exist because the whole codebase used to compute calendar dates in
 * UTC. The first test is the actual bug that motivated the change.
 */
import { describe, it, expect } from 'vitest'
import {
  dateInTimeZone,
  todayInTimeZone,
  addDays,
  zonedTimeToUtc,
  resolveTimeZone,
  usagePeriodSafe,
  DEFAULT_TIMEZONE,
} from './timezone'

describe('dateInTimeZone', () => {
  it('returns the LOCAL calendar day, not the UTC one (the G4 bug)', () => {
    // 02:30 UTC on the 21st is still 22:30 on the 20th in New York.
    const instant = new Date('2026-07-21T02:30:00Z')
    expect(instant.toISOString().slice(0, 10)).toBe('2026-07-21')
    expect(dateInTimeZone(instant, 'America/New_York')).toBe('2026-07-20')
  })

  it('handles a zone ahead of UTC', () => {
    const instant = new Date('2026-07-20T23:30:00Z')
    expect(dateInTimeZone(instant, 'Europe/Belgrade')).toBe('2026-07-21')
  })

  it('falls back to the default zone when given a bad one', () => {
    const instant = new Date('2026-07-21T02:30:00Z')
    expect(dateInTimeZone(instant, 'Not/AZone')).toBe(
      dateInTimeZone(instant, DEFAULT_TIMEZONE)
    )
  })
})

describe('resolveTimeZone', () => {
  it('passes through a valid zone', () => {
    expect(resolveTimeZone('America/Chicago')).toBe('America/Chicago')
  })
  it('defaults on null/empty/invalid', () => {
    expect(resolveTimeZone(null)).toBe(DEFAULT_TIMEZONE)
    expect(resolveTimeZone('')).toBe(DEFAULT_TIMEZONE)
    expect(resolveTimeZone('Mars/Olympus')).toBe(DEFAULT_TIMEZONE)
  })
})

describe('addDays', () => {
  it('crosses month boundaries', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01')
  })
  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('is a no-op for 0', () => {
    expect(addDays('2026-07-20', 0)).toBe('2026-07-20')
  })
})

describe('zonedTimeToUtc', () => {
  it('applies daylight saving (EDT, UTC-4)', () => {
    expect(zonedTimeToUtc('2026-07-02', '09:00:00', 'America/New_York').toISOString())
      .toBe('2026-07-02T13:00:00.000Z')
  })
  it('applies standard time (EST, UTC-5)', () => {
    expect(zonedTimeToUtc('2026-11-02', '09:00:00', 'America/New_York').toISOString())
      .toBe('2026-11-02T14:00:00.000Z')
  })
  it('round-trips back to the same calendar day', () => {
    const utc = zonedTimeToUtc('2026-11-02', '23:30:00', 'America/New_York')
    expect(dateInTimeZone(utc, 'America/New_York')).toBe('2026-11-02')
  })
})

describe('todayInTimeZone', () => {
  it('returns an ISO-shaped date', () => {
    expect(todayInTimeZone('America/New_York')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('usagePeriodSafe', () => {
  it('produces a YYYY-MM billing key', () => {
    expect(usagePeriodSafe('2026-07-20')).toBe('2026-07')
  })
})
