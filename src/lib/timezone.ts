/**
 * Timezone-correct date helpers (audit G4).
 *
 * The problem this solves
 * ----------------------
 * `service_date`, invoice dates, and accounting-period boundaries are DATE
 * columns — a calendar day, not an instant. The codebase used to derive them
 * with `new Date().toISOString().slice(0, 10)`, which is the **UTC** calendar
 * day. For a New York organisation that is simply the wrong day every evening
 * after 7/8pm local: a job logged at 9pm Monday was filed as Tuesday.
 *
 * Every date-only value must therefore be computed in the ORGANISATION's
 * timezone (`organizations.timezone`), never the server's and never UTC.
 *
 * Why Intl and not a date library: `Intl.DateTimeFormat` with the `en-CA`
 * locale yields an ISO-shaped `YYYY-MM-DD` and understands DST, so this needs
 * no dependency.
 */

/** Fallback when an org row hasn't been loaded (NYSD's home timezone). */
export const DEFAULT_TIMEZONE = 'America/New_York'

/** Timezones we surface in the settings picker. */
export const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Belgrade',
] as const

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Normalise possibly-missing/invalid org config down to a usable zone. */
export function resolveTimeZone(tz: string | null | undefined): string {
  if (tz && isValidTimeZone(tz)) return tz
  return DEFAULT_TIMEZONE
}

/**
 * The calendar date (YYYY-MM-DD) at `instant` as seen in `timeZone`.
 */
export function dateInTimeZone(
  instant: Date | string | number,
  timeZone: string | null | undefined
): string {
  const d = instant instanceof Date ? instant : new Date(instant)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/**
 * Today's calendar date in the given timezone. This is the replacement for
 * every `new Date().toISOString().slice(0, 10)` in server code.
 */
export function todayInTimeZone(timeZone: string | null | undefined): string {
  return dateInTimeZone(new Date(), timeZone)
}

/**
 * Add (or subtract) whole days to a YYYY-MM-DD string without ever touching
 * local time. Pure calendar arithmetic — DST-safe because it never involves
 * an instant.
 */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

/**
 * Compact YYYYMMDD form used by document numbering (invoices, proposals).
 */
export function compactDate(dateStr: string): string {
  return dateStr.replace(/-/g, '')
}

/**
 * The UTC offset of `timeZone` at a given instant, in minutes.
 * e.g. New York in July → -240.
 */
function offsetMinutes(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = Object.fromEntries(
    dtf.formatToParts(at).map((p) => [p.type, p.value])
  ) as Record<string, string>
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === '24' ? '0' : parts.hour),
    Number(parts.minute),
    Number(parts.second)
  )
  return (asUtc - at.getTime()) / 60_000
}

/**
 * Combine a local calendar date + wall-clock time in `timeZone` into the
 * correct UTC instant.
 *
 * Use this when scheduling: "9:00 on 2026-11-02 in America/New_York" is a
 * different instant depending on DST, and naive string concatenation with a
 * 'Z' suffix silently books the job an hour out twice a year.
 */
export function zonedTimeToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string | null | undefined
): Date {
  const zone = resolveTimeZone(timeZone)
  const [h = '0', min = '0', sec = '0'] = timeStr.split(':')
  const [y, m, d] = dateStr.split('-').map(Number)

  // First guess: treat the wall clock as if it were UTC, then correct by the
  // zone's offset at that approximate instant. A second pass handles the rare
  // case where the correction crosses a DST boundary.
  const naive = Date.UTC(y, (m ?? 1) - 1, d ?? 1, Number(h), Number(min), Number(sec))
  let result = new Date(naive - offsetMinutes(zone, new Date(naive)) * 60_000)
  result = new Date(naive - offsetMinutes(zone, result) * 60_000)
  return result
}

/**
 * Minimal structural type so this helper works with both the RLS-scoped
 * server client and the service-role client without dragging generics in.
 */
interface OrgTimezoneQuery {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => PromiseLike<{ data: { timezone?: string | null } | null }>
      }
    }
  }
}

/**
 * Look up an organisation's timezone, falling back to the default.
 * Prefer passing an already-loaded org row when you have one — this is for
 * routes that only hold an organization_id.
 */
export async function getOrgTimeZone(
  supabase: unknown,
  organizationId: string
): Promise<string> {
  try {
    const client = supabase as OrgTimezoneQuery
    const { data } = await client
      .from('organizations')
      .select('timezone')
      .eq('id', organizationId)
      .maybeSingle()
    return resolveTimeZone(data?.timezone)
  } catch {
    return DEFAULT_TIMEZONE
  }
}

/**
 * The billing-period key ('YYYY-MM') for a given calendar date.
 * Split out from `usagePeriod` so it is unit-testable without a clock.
 */
export function usagePeriodSafe(dateStr: string): string {
  return dateStr.slice(0, 7)
}
