/**
 * Night consumption (ported from NightConsumption.jsx).
 *
 * NET flow of an hour is the metered volume minus industry offtake, clamped at
 * zero. Each hour is attributed to a REPORT day, then summarised per day and
 * line as either the minimum over 00:00–05:00 or the average of 02:00 and 03:00.
 *
 * Two systems of coordinates, picked by the caller:
 *
 *   commercial — the gas day 07:00 → 07:00. 00:00–06:00 of calendar date C
 *                belong to day C−1, so the row for D is the night FROM D.
 *   calendar   — the astronomical day 00:00 → 00:00. The row for D is the night
 *                ENDING on the morning of D, so its evening hours 21–23 are read
 *                from the PREVIOUS calendar date.
 *
 * Both show the same continuous night (21:00 → 04:00); they differ only in which
 * date it is filed under, and therefore which calendar date the evening comes
 * from.
 */
import { buildEnterpriseByLinePeriod } from './enterpriseVolumes'
import { addDays, commercialDayOf, dayOnly } from './commercialDay'
import type { EnterpriseRecord } from '@/api/enterprise'
import type { HourlyCompact } from '@/api/entities'

export type NightMode = 'min' | 'avg23'
export type DayMode = 'commercial' | 'calendar'

/** Hours used by each variant, and the per-line export sheet column order. */
export const MIN_HOURS = [0, 1, 2, 3, 4, 5]
export const AVG_HOURS = [2, 3]
export const SHEET_HOURS = [21, 22, 23, 0, 1, 2, 3, 4]

/**
 * First hour of the evening block of SHEET_HOURS — where the calendar day rule
 * splits. If the export ever reaches back to 20:00, this moves with it.
 */
const EVENING_FROM = 21

/** reportDay → lineId → hour → NET volume. */
export type NetMap = Record<string, Record<number, Record<number, number>>>

export interface NightOptions {
  /** Defaults to the gas day — what the report did before the option existed. */
  dayMode?: DayMode
  /**
   * Clamp to the days the picker asks for; omitted, the map is not clamped.
   * A time part is stripped: the bounds are compared to a bare 'YYYY-MM-DD'
   * day, and '2026-08-01 00:00:00' would sort AFTER '2026-08-01' and quietly
   * drop the first day of the report.
   */
  from?: string
  to?: string
}

/** How every stamp is resolved: worked out once, then applied to every row. */
interface StampContext {
  wanted: Set<number>
  dayMode: DayMode
  from?: string
  to?: string
}

/** What a stamp resolves to; worked out once per stamp, not once per row. */
interface StampInfo {
  /** The report day the hour belongs to. */
  day: string
  hour: number
  /** Join key into the enterprise lookup — the stamp itself. */
  key: string
  /** Whether the report looks at this hour of this day at all. */
  wanted: boolean
}

/** The report day an hour belongs to, in the caller's system of coordinates. */
function reportDayOf(date: string, hour: number, dayMode: DayMode): string {
  if (dayMode === 'commercial') return commercialDayOf(date, hour)
  // Filed under the morning the night ends on, so the evening before it belongs
  // to the next date.
  return hour >= EVENING_FROM ? addDays(date, 1) : date
}

/**
 * Read a stamp as LOCAL wall-clock time. The archive sends
 * "YYYY-MM-DDTHH" — plant wall clock, no zone — and so does the enterprise
 * endpoint; comparing anything else (an instant, a parsed Date) would make the
 * two sides agree only in the timezone the server happens to run in.
 */
function readStamp(stamp: string, ctx: StampContext): StampInfo | null {
  if (stamp.length < 13) return null
  const hour = Number(stamp.slice(11, 13))
  if (!Number.isInteger(hour)) return null
  const day = reportDayOf(stamp.slice(0, 10), hour, ctx.dayMode)
  // The fetched window is one day wider than the report on both sides (it has to
  // serve both day modes), so days outside the range are dropped here rather
  // than surfacing as a leading or trailing row built from half a night.
  const inRange = (!ctx.from || day >= ctx.from) && (!ctx.to || day <= ctx.to)
  return { day, hour, key: stamp, wanted: inRange && ctx.wanted.has(hour) }
}

/**
 * The hourly window that serves BOTH day modes: the evening before the range
 * (the calendar day reaches back into it) through the morning after it (the gas
 * day reaches forward). One day wider than the report on each side.
 */
export function nightHourlyRange(from: string, to: string): { from: string; to: string } {
  return { from: `${addDays(from, -1)}T21:00:00`, to: `${addDays(to, 1)}T06:00:00` }
}

export function buildNetByDayLineHour(
  hourly: HourlyCompact,
  enterpriseData: EnterpriseRecord[] = [],
  { dayMode = 'commercial', from, to }: NightOptions = {},
): NetMap {
  const enterpriseMap = buildEnterpriseByLinePeriod(enterpriseData, 'hourly')
  const ctx: StampContext = {
    wanted: new Set([...MIN_HOURS, ...SHEET_HOURS]),
    dayMode,
    from: from ? dayOnly(from) : undefined,
    to: to ? dayOnly(to) : undefined,
  }
  // Hundreds of thousands of rows over some seven hundred stamps: resolving
  // the stamp per row was the whole cost of this loop.
  const stamps = (hourly?.stamps ?? []).map((s) => readStamp(s, ctx))
  const map: NetMap = {}

  for (const [lineId, stampIdx, volume] of hourly?.rows ?? []) {
    const at = stamps[stampIdx]
    if (!at || !at.wanted || lineId == null) continue

    const gs = Number(volume) || 0
    const ent = enterpriseMap[lineId]?.[at.key] ?? 0

    let byLine = map[at.day]
    if (!byLine) byLine = map[at.day] = {}
    let byHour = byLine[lineId]
    if (!byHour) byHour = byLine[lineId] = {}
    byHour[at.hour] = Math.max(0, gs - ent)
  }
  return map
}

export interface NightRow {
  date: string
  [lineKey: string]: string | number | null
}

/** Summary rows per report day: MIN over 00–05, or AVG of 02 and 03. */
export function nightRowsFromMap(map: NetMap, lineIds: number[], mode: NightMode): NightRow[] {
  const hours = mode === 'avg23' ? AVG_HOURS : MIN_HOURS
  return Object.keys(map)
    .sort()
    .map((date) => {
      const row: NightRow = { date }
      for (const lineId of lineIds) {
        const byHour = map[date][lineId]
        const values = byHour
          ? hours.map((h) => byHour[h]).filter((v): v is number => v !== undefined)
          : []
        row[`line_${lineId}`] =
          values.length === 0
            ? null
            : mode === 'avg23'
              ? values.reduce((a, b) => a + b, 0) / values.length
              : Math.min(...values)
      }
      return row
    })
}

/** One sheet per line for the Excel export: hourly NET across the night hours. */
export function buildHourlySheets(
  map: NetMap,
  dates: string[],
  lineIds: number[],
): Record<number, NightRow[]> {
  const sheets: Record<number, NightRow[]> = {}
  for (const lineId of lineIds) {
    sheets[lineId] = dates.map((date) => {
      const byHour = map[date]?.[lineId] ?? {}
      const row: NightRow = { date }
      for (const h of SHEET_HOURS) row[h] = byHour[h] ?? null
      return row
    })
  }
  return sheets
}
