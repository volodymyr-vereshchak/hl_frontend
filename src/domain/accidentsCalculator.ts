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

/** "HH:MM:SS" between two instants, in epoch ms (clamped at zero). */
export function calculateDuration(startMs: number, endMs: number): string {
  const diff = endMs - startMs
  if (diff < 0) return '00:00:00'
  return formatMs(diff)
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

/**
 * One archive event.
 *
 * The instant is epoch milliseconds all the way through the report, never an
 * ISO string. A month over every line is ~435 000 events, and parsing a date
 * inside a sort comparator parses it once per comparison — 2.9s of a run went
 * into `new Date()` alone. The API sends the number, and only the few hundred
 * rows that reach the screen are ever formatted.
 */
export interface SysRecord {
  line_id?: number
  ms: number
  sys_type_id: number
  sys_name?: string
  volume?: number
}

export type AccidentKind = 'full' | 'start_only' | 'end_only' | 'standalone'

export interface Accident {
  sys_type_id: number
  sys_name?: string
  startMs: number
  endMs: number
  startVolume?: number
  endVolume?: number | null
  line_id?: number
  type: AccidentKind
}

/** Pair start/end events into accidents; unmatched ends/starts are clipped to the period. */
export function pairAccidents(
  sysData: SysRecord[],
  range: { fromMs: number; toMs: number },
): Accident[] {
  if (!sysData || sysData.length === 0) return []

  const sorted = [...sysData].sort((a, b) => a.ms - b.ms)
  const accidents: Accident[] = []
  // Keyed by LINE + end code: an accident always starts and ends on the same
  // line, so pairing globally would match a start on one line with an end on
  // another, inventing long spans and inflating volumes.
  const openAccidents = new Map<string, Accident[]>()
  const openKey = (lineId: number | undefined, endCode: number) => `${lineId ?? 0}_${endCode}`
  const nameByTypeId = new Map(sorted.map((r) => [r.sys_type_id, r.sys_name]))

  const periodStart = range.fromMs
  const periodEnd = range.toMs

  for (const record of sorted) {
    const id = record.sys_type_id

    if (isStandaloneCode(id)) {
      accidents.push({
        sys_type_id: id,
        sys_name: record.sys_name,
        startMs: record.ms,
        endMs: record.ms,
        startVolume: record.volume,
        endVolume: record.volume,
        line_id: record.line_id,
        type: 'standalone',
      })
    } else if (isAccidentStart(id)) {
      const key = openKey(record.line_id, getAccidentEndCode(id))
      if (!openAccidents.has(key)) openAccidents.set(key, [])
      openAccidents.get(key)!.push({
        sys_type_id: id,
        sys_name: record.sys_name,
        startMs: record.ms,
        endMs: 0,
        startVolume: record.volume,
        line_id: record.line_id,
        type: 'start_only',
      })
    } else {
      const endCode = id
      const key = openKey(record.line_id, endCode)
      const openList = openAccidents.get(key)
      if (openList && openList.length > 0) {
        const open = openList.shift()!
        accidents.push({
          sys_type_id: open.sys_type_id,
          sys_name: open.sys_name,
          startMs: open.startMs,
          endMs: record.ms,
          startVolume: open.startVolume,
          endVolume: record.volume,
          line_id: record.line_id,
          type: 'full',
        })
        if (openList.length === 0) openAccidents.delete(key)
      } else {
        // Accident started before the selected period.
        const startTypeId = getAccidentStartCode(endCode)
        accidents.push({
          sys_type_id: startTypeId,
          sys_name: nameByTypeId.get(startTypeId) ?? record.sys_name,
          startMs: periodStart,
          endMs: record.ms,
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
      accidents.push({ ...open, endMs: periodEnd, endVolume: null, type: 'start_only' })
    }
  }

  return accidents
}

/** Commercial day (YYYY-MM-DD) an instant belongs to. */
function commercialDayOfInstant(ms: number): string {
  const d = new Date(ms)
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
  return volumeBetween(
    accident.line_id,
    accident.startMs,
    accident.type === 'end_only' ? 0 : (accident.startVolume ?? null),
    accident.endMs,
    accident.type === 'start_only' ? null : (accident.endVolume ?? null),
    dailyVolume,
  )
}

/**
 * Gas that passed between two instants, given the counter readings at each
 * (null = unknown, to be taken from the daily archive).
 */
function volumeBetween(
  lineId: number | undefined,
  startMs: number,
  startReading: number | null,
  endMs: number,
  endReading: number | null,
  dailyVolume: DailyVolumeLookup,
): number | null {
  const startDay = commercialDayOfInstant(startMs)
  // The upper bound is exclusive: an instant at exactly the contract hour closes
  // the PREVIOUS commercial day, so step back before resolving its day.
  const endDay = commercialDayOfInstant(endMs - 1000)

  if (startDay === endDay) {
    if (startReading == null) return null
    if (endReading != null) return Math.max(0, endReading - startReading)
    // Open at the period end: the rest of that day comes from the daily archive.
    const daily = dailyVolume(lineId, endDay)
    return daily == null ? null : Math.max(0, daily - startReading)
  }

  // Spans day boundaries: rest of the first day + full days between + last day.
  if (startReading == null) return null
  const firstDayTotal = dailyVolume(lineId, startDay)
  if (firstDayTotal == null) return null
  let total = Math.max(0, firstDayTotal - startReading)

  for (let day = addDays(startDay, 1); day < endDay; day = addDays(day, 1)) {
    const v = dailyVolume(lineId, day)
    if (v == null) return null
    total += v
  }

  if (endReading != null) return total + Math.max(0, endReading)
  const lastDay = dailyVolume(lineId, endDay)
  return lastDay == null ? null : total + lastDay
}

export interface AccidentOccurrence {
  startMs: number
  endMs: number
  duration: string
  /** null when a counter reading is missing (open at a period boundary). */
  volume: number | null
  type: AccidentKind
  line_id?: number
  /** Raw counter readings, kept so overlapping occurrences can be merged. */
  startReading: number | null
  endReading: number | null
}

/**
 * Gas that passed while ANY of these occurrences was active, on one line.
 *
 * Overlapping alarms (repeats of one type, or different types at once) cover the
 * same gas, so their volumes must not be added — the intervals are merged first
 * and each merged span is measured once. Without this a line could report more
 * accident volume than it physically passed.
 */
export function volumeOverOccurrences(
  occs: AccidentOccurrence[],
  dailyVolume: DailyVolumeLookup,
): number {
  const spans = occs
    .filter((o) => o.type !== 'standalone')
    .map((o) => ({ start: o.startMs, end: o.endMs, occ: o }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start)

  let total = 0
  let cur: { startOcc: AccidentOccurrence; endOcc: AccidentOccurrence; end: number } | null = null

  const flush = () => {
    if (!cur) return
    const v = volumeBetween(
      cur.startOcc.line_id,
      cur.startOcc.startMs,
      cur.startOcc.startReading,
      cur.endOcc.endMs,
      cur.endOcc.endReading,
      dailyVolume,
    )
    total += v ?? 0
  }

  for (const s of spans) {
    if (!cur) {
      cur = { startOcc: s.occ, endOcc: s.occ, end: s.end }
    } else if (s.start <= cur.end) {
      if (s.end > cur.end) {
        cur.end = s.end
        cur.endOcc = s.occ
      }
    } else {
      flush()
      cur = { startOcc: s.occ, endOcc: s.occ, end: s.end }
    }
  }
  flush()
  return total
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
      startMs: accident.startMs,
      endMs: accident.endMs,
      duration: standalone ? '—' : calculateDuration(accident.startMs, accident.endMs),
      volume,
      type: accident.type,
      line_id: accident.line_id,
      startReading: accident.type === 'end_only' ? 0 : (accident.startVolume ?? null),
      endReading: accident.type === 'start_only' ? null : (accident.endVolume ?? null),
    })
    group.totalCount++
  }

  const out = [...grouped.values()]
  for (const group of out) {
    // Per line the overlapping intervals are merged; the type total is the sum
    // of those per-line durations (two lines in alarm at once really is 2× time).
    const perLine = group.isStandalone
      ? []
      : summarizeOccurrencesByLine(group.occurrences, false, dailyVolume)
    group.totalDuration = perLine.reduce((s, l) => s + l.durationMs, 0)
    group.totalVolume = perLine.reduce((s, l) => s + l.volume, 0)
    group.totalDurationFormatted = group.isStandalone ? '—' : formatMs(group.totalDuration)
  }
  return out.sort((a, b) => b.totalCount - a.totalCount)
}

export interface LineSummary {
  line_id: number
  firstStartMs: number
  lastEndMs: number
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
  dailyVolume: DailyVolumeLookup = () => undefined,
): LineSummary[] {
  const byLine = new Map<number, AccidentOccurrence[]>()
  for (const occ of occurrences) {
    const lid = occ.line_id ?? 0
    if (!byLine.has(lid)) byLine.set(lid, [])
    byLine.get(lid)!.push(occ)
  }
  return [...byLine.entries()]
    .map(([lineId, occs]) => {
      // Reduced, not spread into Math.min: a line with tens of thousands of
      // occurrences would blow the argument limit.
      let firstStartMs = Infinity
      let lastEndMs = -Infinity
      for (const o of occs) {
        if (o.startMs < firstStartMs) firstStartMs = o.startMs
        if (o.endMs > lastEndMs) lastEndMs = o.endMs
      }
      const totalMs = isStandalone
        ? 0
        : mergeIntervalsMs(occs.map((o) => ({ start: o.startMs, end: o.endMs })))
      return {
        line_id: lineId,
        firstStartMs,
        lastEndMs,
        count: occs.length,
        durationMs: totalMs,
        durationFormatted: isStandalone ? '—' : formatMs(totalMs),
        // Merged, so simultaneous alarms never count the same gas twice.
        volume: isStandalone ? 0 : volumeOverOccurrences(occs, dailyVolume),
      }
    })
    .sort((a, b) => b.count - a.count)
}

/** First start / last end across every occurrence of a group, in epoch ms. */
export function groupBounds(group: AccidentGroup): { firstStartMs: number; lastEndMs: number } {
  let firstStartMs = Infinity
  let lastEndMs = -Infinity
  for (const o of group.occurrences) {
    if (o.startMs < firstStartMs) firstStartMs = o.startMs
    if (o.endMs > lastEndMs) lastEndMs = o.endMs
  }
  return { firstStartMs, lastEndMs }
}

export function filterAccidentsByLine(accidents: Accident[], lineId: number | null): Accident[] {
  if (!lineId) return accidents
  return accidents.filter((a) => a.line_id === lineId)
}

/** Branch a line belongs to; null when the topology does not know the line. */
export type LineBranchLookup = (lineId: number | undefined) => number | null

/**
 * Gas that passed while ANY accident of ANY type was active, over a set of
 * groups.
 *
 * Types overlap in time on the same line, so summing `group.totalVolume` would
 * count the same gas once per type. The occurrences are therefore pooled per
 * line first and only then measured — see `volumeOverOccurrences`.
 */
export function unionVolumeOverGroups(
  groups: AccidentGroup[],
  dailyVolume: DailyVolumeLookup = () => undefined,
): number {
  const byLine = new Map<number, AccidentOccurrence[]>()
  for (const group of groups) {
    for (const occ of group.occurrences) {
      const lid = occ.line_id ?? 0
      if (!byLine.has(lid)) byLine.set(lid, [])
      byLine.get(lid)!.push(occ)
    }
  }
  let total = 0
  for (const occs of byLine.values()) total += volumeOverOccurrences(occs, dailyVolume)
  return total
}

export interface BranchAccidentGroup {
  /** null = the line is not in the loaded topology. */
  branchId: number | null
  groups: AccidentGroup[]
  totalCount: number
  /** Union across the branch's lines — never the sum of the type volumes. */
  totalVolume: number
}

/**
 * Split accidents per branch, then group each branch's own accidents by type.
 *
 * A line belongs to exactly one branch, so the branches partition both the
 * occurrences and the volume: the report's overall figures stay the sum of the
 * branch figures, and no accident is counted twice.
 */
export function groupAccidentsByBranch(
  accidents: Accident[],
  branchOf: LineBranchLookup,
  dailyVolume: DailyVolumeLookup = () => undefined,
): BranchAccidentGroup[] {
  const byBranch = new Map<number | null, Accident[]>()
  for (const accident of accidents) {
    const key = branchOf(accident.line_id)
    if (!byBranch.has(key)) byBranch.set(key, [])
    byBranch.get(key)!.push(accident)
  }

  return [...byBranch.entries()]
    .map(([branchId, list]) => {
      const groups = groupAccidentsByType(list, dailyVolume)
      return {
        branchId,
        groups,
        totalCount: groups.reduce((s, g) => s + g.totalCount, 0),
        totalVolume: unionVolumeOverGroups(groups, dailyVolume),
      }
    })
    .sort((a, b) => {
      // Lines the topology does not know sit last: the bucket has no name to
      // show and nothing to drill into beyond the line id.
      if ((a.branchId === null) !== (b.branchId === null)) return a.branchId === null ? 1 : -1
      return b.totalCount - a.totalCount
    })
}
