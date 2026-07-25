/**
 * Night consumption (ported from NightConsumption.jsx).
 *
 * NET flow of an hour is the metered volume minus industry offtake, clamped at
 * zero. Each hour is attributed to the COMMERCIAL day it belongs to (00:00–06:00
 * of calendar date C belongs to day C−1), then summarised per day and line as
 * either the minimum over 00:00–05:00 or the average of 02:00 and 03:00.
 */
import { buildEnterpriseByLinePeriod, enterprisePeriodKey } from './enterpriseVolumes'
import { commercialDayOf } from './commercialDay'
import type { EnterpriseRecord } from '@/api/enterprise'
import type { ArchiveRow } from '@/api/entities'

export type NightMode = 'min' | 'avg23'

/** Hours used by each variant, and the per-line export sheet column order. */
export const MIN_HOURS = [0, 1, 2, 3, 4, 5]
export const AVG_HOURS = [2, 3]
export const SHEET_HOURS = [21, 22, 23, 0, 1, 2, 3, 4]

/** commercialDay → lineId → hour → NET volume. */
export type NetMap = Record<string, Record<number, Record<number, number>>>

/**
 * Parse "YYYY-MM-DDTHH:mm:ss" as LOCAL wall-clock time. `new Date()` would treat
 * a bare timestamp as UTC and shift the hour in UTC+ zones, moving records into
 * the wrong commercial day.
 */
function splitPeriod(period: string): { date: string; hour: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2})/.exec(String(period))
  if (!m) return null
  return { date: `${m[1]}-${m[2]}-${m[3]}`, hour: parseInt(m[4], 10) }
}

export function buildNetByDayLineHour(
  hourlyData: ArchiveRow[],
  enterpriseData: EnterpriseRecord[] = [],
): NetMap {
  const enterpriseMap = buildEnterpriseByLinePeriod(enterpriseData, 'hourly')
  const wanted = new Set([...MIN_HOURS, ...SHEET_HOURS])
  const map: NetMap = {}

  for (const record of hourlyData) {
    const parsed = splitPeriod(String(record.period))
    if (!parsed || !wanted.has(parsed.hour)) continue

    const lineId = record.line_id as number
    if (lineId == null) continue

    const commDate = commercialDayOf(parsed.date, parsed.hour)
    const key = enterprisePeriodKey(record.period, 'hourly')
    const gs = Number(record.volume) || 0
    const ent = enterpriseMap[lineId]?.[key] ?? 0

    if (!map[commDate]) map[commDate] = {}
    if (!map[commDate][lineId]) map[commDate][lineId] = {}
    map[commDate][lineId][parsed.hour] = Math.max(0, gs - ent)
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
