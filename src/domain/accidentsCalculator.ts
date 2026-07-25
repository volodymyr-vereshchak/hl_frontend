/**
 * Accident detection from the system archive (ported from accidentsCalculator.js).
 *
 * Device event codes pair up by an offset of 128:
 *   1–74    → accident END   (pairs with start code+128)
 *   128–200 → accident START
 *   75–127, 201+ → standalone notification (no pair, no duration)
 */

import { commercialDayOf, addDays } from './commercialDay'

export function isAccidentStart(sysTypeId: number): boolean {
  const code = sysTypeId & 0xff
  return code >= 128 && code <= 200
}

export function isAccidentEnd(sysTypeId: number): boolean {
  const code = sysTypeId & 0xff
  return code >= 1 && code <= 74
}

export function isStandaloneCode(sysTypeId: number): boolean {
  const code = sysTypeId & 0xff
  return (code >= 75 && code <= 127) || code >= 201
}

export const getAccidentEndCode = (startCode: number) => startCode - 128
export const getAccidentStartCode = (endCode: number) => endCode + 128

/** "HH:MM:SS" between two instants (clamped at zero). */
export function calculateDuration(startTime: string | Date, endTime: string | Date): string {
  const diffMs = new Date(endTime).getTime() - new Date(startTime).getTime()
  if (diffMs < 0) return '00:00:00'
  return formatMs(diffMs)
}

/**
 * Total wall-clock time covered by a set of intervals, merging overlaps.
 *
 * Repeated start events without a matching end all stretch to the end of the
 * period, so naively summing their durations counts the same hours many times
 * (three alarms 11 minutes apart reported 349h over a 117h span). The union is
 * the real time the line spent in that state.
 */
export function mergeIntervalsMs(intervals: { start: number; end: number }[]): number {
  const valid = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start)
  let total = 0
  let curStart: number | null = null
  let curEnd = 0
  for (const iv of valid) {
    if (curStart === null) {
      curStart = iv.start
      curEnd = iv.end
    } else if (iv.start <= curEnd) {
      curEnd = Math.max(curEnd, iv.end)
    } else {
      total += curEnd - curStart
      curStart = iv.start
      curEnd = iv.end
    }
  }
  if (curStart !== null) total += curEnd - curStart
  return total
}

function formatMs(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export interface SysRecord {
  line_id?: number
  period: string
  sys_type_id: number
  sys_name?: string
  volume?: number
}

export type AccidentKind = 'full' | 'start_only' | 'end_only' | 'standalone'

export interface Accident {
  sys_type_id: number
  sys_name?: string
  startTime: string
  endTime: string
  startVolume?: number
  endVolume?: number | null
  line_id?: number
  type: AccidentKind
}

/** Pair start/end events into accidents; unmatched ends/starts are clipped to the period. */
export function pairAccidents(
  sysData: SysRecord[],
  range: { fromDate: string; toDate: string },
): Accident[] {
  if (!sysData || sysData.length === 0) return []

  const sorted = [...sysData].sort(
    (a, b) => new Date(a.period).getTime() - new Date(b.period).getTime(),
  )
  const accidents: Accident[] = []
  const openAccidents = new Map<number, Accident[]>()
  const nameByTypeId = new Map(sorted.map((r) => [r.sys_type_id, r.sys_name]))

  const periodStart = new Date(range.fromDate)
  const periodEnd = new Date(range.toDate)

  for (const record of sorted) {
    const id = record.sys_type_id

    if (isStandaloneCode(id)) {
      accidents.push({
        sys_type_id: id,
        sys_name: record.sys_name,
        startTime: record.period,
        endTime: record.period,
        startVolume: record.volume,
        endVolume: record.volume,
        line_id: record.line_id,
        type: 'standalone',
      })
    } else if (isAccidentStart(id)) {
      const endCode = getAccidentEndCode(id)
      if (!openAccidents.has(endCode)) openAccidents.set(endCode, [])
      openAccidents.get(endCode)!.push({
        sys_type_id: id,
        sys_name: record.sys_name,
        startTime: record.period,
        endTime: '',
        startVolume: record.volume,
        line_id: record.line_id,
        type: 'start_only',
      })
    } else {
      const endCode = id
      const openList = openAccidents.get(endCode)
      if (openList && openList.length > 0) {
        const open = openList.shift()!
        accidents.push({
          sys_type_id: open.sys_type_id,
          sys_name: open.sys_name,
          startTime: open.startTime,
          endTime: record.period,
          startVolume: open.startVolume,
          endVolume: record.volume,
          line_id: record.line_id,
          type: 'full',
        })
        if (openList.length === 0) openAccidents.delete(endCode)
      } else {
        // Accident started before the selected period.
        const startTypeId = getAccidentStartCode(endCode)
        accidents.push({
          sys_type_id: startTypeId,
          sys_name: nameByTypeId.get(startTypeId) ?? record.sys_name,
          startTime: periodStart.toISOString(),
          endTime: record.period,
          startVolume: 0,
          endVolume: record.volume,
          line_id: record.line_id,
          type: 'end_only',
        })
      }
    }
  }

  // Still-open accidents run to the end of the period.
  for (const openList of openAccidents.values()) {
    for (const open of openList) {
      accidents.push({ ...open, endTime: periodEnd.toISOString(), endVolume: null, type: 'start_only' })
    }
  }

  return accidents
}

/** Commercial day (YYYY-MM-DD) an instant belongs to. */
function commercialDayOfInstant(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return commercialDayOf(date, d.getHours())
}

/** Daily volume for a line on a commercial day; undefined when unknown. */
export type DailyVolumeLookup = (lineId: number | undefined, day: string) => number | undefined

/**
 * Gas that passed during an accident.
 *
 * `volume` on a sys record is the meter counter ACCUMULATED SINCE THE START OF
 * THE COMMERCIAL DAY (it resets at the contract hour) — not a per-event amount.
 * So within one day the accident's volume is simply end − start, which also
 * resolves both open boundaries:
 *   • accident started before the period → the counter began at 0 that day;
 *   • accident still open at the end      → the remainder of the day is
 *     (daily total − start reading), taken from the daily archive.
 * When an accident spans several days the parts add up: rest of the first day,
 * whole days in between, and the accumulated counter on the last day.
 */
export function calculateAccidentVolume(
  accident: Accident,
  dailyVolume: DailyVolumeLookup = () => undefined,
): number | null {
  const startDay = commercialDayOfInstant(accident.startTime)
  // The upper bound is exclusive: an instant at exactly the contract hour closes
  // the PREVIOUS commercial day, so step back before resolving its day.
  const endDay = commercialDayOfInstant(
    new Date(new Date(accident.endTime).getTime() - 1000).toISOString(),
  )
  // Accident began before the period ⇒ counter started the day at 0.
  const startReading = accident.type === 'end_only' ? 0 : (accident.startVolume ?? null)
  const endReading = accident.type === 'start_only' ? null : (accident.endVolume ?? null)

  if (startDay === endDay) {
    if (startReading == null) return null
    if (endReading != null) return Math.max(0, endReading - startReading)
    // Open at the period end: the rest of that day comes from the daily archive.
    const daily = dailyVolume(accident.line_id, endDay)
    return daily == null ? null : Math.max(0, daily - startReading)
  }

  // Spans day boundaries: rest of the first day + full days between + last day.
  if (startReading == null) return null
  const firstDayTotal = dailyVolume(accident.line_id, startDay)
  if (firstDayTotal == null) return null
  let total = Math.max(0, firstDayTotal - startReading)

  for (let day = addDays(startDay, 1); day < endDay; day = addDays(day, 1)) {
    const v = dailyVolume(accident.line_id, day)
    if (v == null) return null
    total += v
  }

  if (endReading != null) return total + Math.max(0, endReading)
  const lastDay = dailyVolume(accident.line_id, endDay)
  return lastDay == null ? null : total + lastDay
}

export interface AccidentOccurrence {
  startTime: string
  endTime: string
  duration: string
  /** null when a counter reading is missing (open at a period boundary). */
  volume: number | null
  type: AccidentKind
  line_id?: number
}

export interface AccidentGroup {
  sys_type_id: number
  sys_name?: string
  isStandalone: boolean
  occurrences: AccidentOccurrence[]
  totalCount: number
  totalDuration: number
  totalVolume: number
  totalDurationFormatted: string
}

/** Group accidents by event type with counts, total duration and volume. */
export function groupAccidentsByType(
  accidents: Accident[],
  dailyVolume: DailyVolumeLookup = () => undefined,
): AccidentGroup[] {
  const grouped = new Map<number, AccidentGroup>()

  for (const accident of accidents) {
    const key = accident.sys_type_id
    const standalone = accident.type === 'standalone'
    if (!grouped.has(key)) {
      grouped.set(key, {
        sys_type_id: key,
        sys_name: accident.sys_name,
        isStandalone: standalone,
        occurrences: [],
        totalCount: 0,
        totalDuration: 0,
        totalVolume: 0,
        totalDurationFormatted: '—',
      })
    }
    const group = grouped.get(key)!
    const volume = calculateAccidentVolume(accident, dailyVolume)

    group.occurrences.push({
      startTime: accident.startTime,
      endTime: accident.endTime,
      duration: standalone ? '—' : calculateDuration(accident.startTime, accident.endTime),
      volume,
      type: accident.type,
      line_id: accident.line_id,
    })
    group.totalCount++
    group.totalVolume += volume ?? 0
  }

  const out = [...grouped.values()]
  for (const group of out) {
    // Per line the overlapping intervals are merged; the type total is the sum
    // of those per-line durations (two lines in alarm at once really is 2× time).
    group.totalDuration = group.isStandalone
      ? 0
      : summarizeOccurrencesByLine(group.occurrences, false).reduce((s, l) => s + l.durationMs, 0)
    group.totalDurationFormatted = group.isStandalone ? '—' : formatMs(group.totalDuration)
  }
  return out.sort((a, b) => b.totalCount - a.totalCount)
}

export interface LineSummary {
  line_id: number
  firstStart: string
  lastEnd: string
  count: number
  /** Union of the occurrence intervals — overlaps counted once. */
  durationMs: number
  durationFormatted: string
  volume: number
}

/**
 * Per-line rollup of one accident type: when it first started, when it last
 * ended, how many times it fired, and the total duration/volume.
 */
export function summarizeOccurrencesByLine(
  occurrences: AccidentOccurrence[],
  isStandalone: boolean,
): LineSummary[] {
  const byLine = new Map<number, AccidentOccurrence[]>()
  for (const occ of occurrences) {
    const lid = occ.line_id ?? 0
    if (!byLine.has(lid)) byLine.set(lid, [])
    byLine.get(lid)!.push(occ)
  }
  return [...byLine.entries()]
    .map(([lineId, occs]) => {
      const starts = occs.map((o) => new Date(o.startTime).getTime())
      const ends = occs.map((o) => new Date(o.endTime).getTime())
      const totalMs = isStandalone
        ? 0
        : mergeIntervalsMs(
            occs.map((o) => ({
              start: new Date(o.startTime).getTime(),
              end: new Date(o.endTime).getTime(),
            })),
          )
      return {
        line_id: lineId,
        firstStart: new Date(Math.min(...starts)).toISOString(),
        lastEnd: new Date(Math.max(...ends)).toISOString(),
        count: occs.length,
        durationMs: totalMs,
        durationFormatted: isStandalone ? '—' : formatMs(totalMs),
        volume: occs.reduce((s, o) => s + (o.volume ?? 0), 0),
      }
    })
    .sort((a, b) => b.count - a.count)
}

/** First start / last end across every occurrence of a group. */
export function groupBounds(group: AccidentGroup): { firstStart: string; lastEnd: string } {
  const starts = group.occurrences.map((o) => new Date(o.startTime).getTime())
  const ends = group.occurrences.map((o) => new Date(o.endTime).getTime())
  return {
    firstStart: new Date(Math.min(...starts)).toISOString(),
    lastEnd: new Date(Math.max(...ends)).toISOString(),
  }
}

export function filterAccidentsByLine(accidents: Accident[], lineId: number | null): Accident[] {
  if (!lineId) return accidents
  return accidents.filter((a) => a.line_id === lineId)
}
