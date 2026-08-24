/**
 * Night consumption (ported from NightConsumption.jsx).
 *
 * NET flow of an hour is the metered volume minus industry offtake, clamped at
 * zero. Each hour is attributed to the COMMERCIAL day it belongs to (00:00–06:00
 * of calendar date C belongs to day C−1), then summarised per day and line as
 * either the minimum over 00:00–05:00 or the average of 02:00 and 03:00.
 */
import { buildEnterpriseByLinePeriod } from './enterpriseVolumes'
import { commercialDayOf } from './commercialDay'
import type { EnterpriseRecord } from '@/api/enterprise'
import type { HourlyCompact } from '@/api/entities'

export type NightMode = 'min' | 'avg23'

/** Hours used by each variant, and the per-line export sheet column order. */
export const MIN_HOURS = [0, 1, 2, 3, 4, 5]
export const AVG_HOURS = [2, 3]
export const SHEET_HOURS = [21, 22, 23, 0, 1, 2, 3, 4]

/** commercialDay → lineId → hour → NET volume. */
export type NetMap = Record<string, Record<number, Record<number, number>>>

/** What a stamp resolves to; worked out once per stamp, not once per row. */
interface StampInfo {
  /** The commercial day the hour belongs to. */
  day: string
  hour: number
  /** Join key into the enterprise lookup — the stamp itself. */
  key: string
  /** Whether the report looks at this hour at all. */
  wanted: boolean
}

/**
 * Read a stamp as LOCAL wall-clock time. The archive sends
 * "YYYY-MM-DDTHH" — plant wall clock, no zone — and so does the enterprise
 * endpoint; comparing anything else (an instant, a parsed Date) would make the
 * two sides agree only in the timezone the server happens to run in.
 */
function readStamp(stamp: string, wanted: Set<number>): StampInfo | null {
  if (stamp.length < 13) return null
  const hour = Number(stamp.slice(11, 13))
  if (!Number.isInteger(hour)) return null
  const date = stamp.slice(0, 10)
  return { day: commercialDayOf(date, hour), hour, key: stamp, wanted: wanted.has(hour) }
}

export function buildNetByDayLineHour(
  hourly: HourlyCompact,
  enterpriseData: EnterpriseRecord[] = [],
): NetMap {
  const enterpriseMap = buildEnterpriseByLinePeriod(enterpriseData, 'hourly')
  const wanted = new Set([...MIN_HOURS, ...SHEET_HOURS])
  // Hundreds of thousands of rows over some seven hundred stamps: resolving
  // the stamp per row was the whole cost of this loop.
  const stamps = (hourly?.stamps ?? []).map((s) => readStamp(s, wanted))
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

/** Summary rows per commercial day: MIN over 00–05, or AVG of 02 and 03. */
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
