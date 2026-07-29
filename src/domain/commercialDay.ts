// Commercial-day semantics for gas metering.
//
// A commercial day runs CONTRACT_HOUR → CONTRACT_HOUR (next calendar day), e.g.
// 07:00 → 07:00, NOT 00:00 → 00:00. So commercial day D spans
// [D CONTRACT_HOUR:00, (D+1) CONTRACT_HOUR:00); its hourly records run from
// D CONTRACT_HOUR:00 to (D+1) (CONTRACT_HOUR-1):00 (last record one hour before).
//
// Consequence: the early hours 00:00..(CONTRACT_HOUR-1) of calendar date C belong
// to the PREVIOUS commercial day (C-1). E.g. with 07:00: 30.05 05:00 → 29.05.

import { grsConfig } from './grsConfig'

/** Resolve the contract hour at call time: runtime config first, then default. */
export function getContractHour(): number {
  const runtime = typeof window !== 'undefined' ? window.APP_CONFIG?.GRS_CONFIG?.CONTRACT_HOUR : undefined
  if (Number.isInteger(runtime)) return runtime as number
  if (Number.isInteger(grsConfig.CONTRACT_HOUR)) return grsConfig.CONTRACT_HOUR
  return 7
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * 'YYYY-MM-DD' out of a value that may carry a time part.
 *
 * The enterprise endpoints take BARE commercial days and expand them
 * themselves; the archive controls hand out values like '2026-07-01 07:00:00'.
 * Feeding those straight back into the expansion produced doubled timestamps
 * and NaN dates, so every caller strips the time through this.
 */
export const dayOnly = (v: string) => String(v).split('T')[0].split(' ')[0]

/** Add `delta` days to a 'YYYY-MM-DD' string using pure UTC math (no TZ/DST). */
export function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + delta))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/**
 * Map a selected inclusive date range [fromDate, toDate] (commercial days) to the
 * hourly datetime range covering them:
 * [fromDate CONTRACT_HOUR:00, (toDate+1) (CONTRACT_HOUR-1):00].
 */
export function commercialHourlyRange(fromDate: string, toDate: string): { from: string; to: string } {
  const h = getContractHour()
  const endHour = h - 1
  return {
    from: `${fromDate}T${pad(h)}:00:00`,
    to: `${addDays(toDate, 1)}T${pad(endHour)}:00:00`,
  }
}

/**
 * The commercial day (YYYY-MM-DD) that a calendar date + hour belongs to.
 * Hours below CONTRACT_HOUR → previous day; CONTRACT_HOUR+ → same day.
 */
export function commercialDayOf(dateStr: string, hour: number): string {
  return hour < getContractHour() ? addDays(dateStr, -1) : dateStr
}

/** Hour of a picker value ('YYYY-MM-DD' or 'YYYY-MM-DD HH:mm:ss'), or null. */
function hourOf(v: string): number | null {
  const m = String(v).match(/[T ](\d{2}):/)
  return m ? Number(m[1]) : null
}

/**
 * The bare commercial days the enterprise endpoints must be asked for to cover
 * a picked range.
 *
 * Those endpoints take days, not timestamps, and expand them themselves — for
 * hourly data, day D means [D CONTRACT_HOUR, (D+1) CONTRACT_HOUR). So a range
 * that starts at 00:00 does NOT start on its own calendar day: the hours before
 * the contract hour belong to the day before, and asking for the calendar day
 * left them out of the response entirely — the archive showed rows for them and
 * the overlay filled every one with a zero.
 *
 * Only the bounds are widened; joining stays on the exact period key, so the
 * extra hours at the edges are simply never looked up.
 */
export function enterpriseDayWindow(
  from: string,
  to: string,
  periodType: 'daily' | 'hourly',
): { from: string; to: string } {
  const fromDay = dayOnly(from)
  const toDay = dayOnly(to)
  if (periodType !== 'hourly') return { from: fromDay, to: toDay }
  const fromHour = hourOf(from)
  const toHour = hourOf(to)
  return {
    from: fromHour == null ? fromDay : commercialDayOf(fromDay, fromHour),
    to: toHour == null ? toDay : commercialDayOf(toDay, toHour),
  }
}
