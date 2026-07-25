/**
 * Accident detection from the system archive (ported from accidentsCalculator.js).
 *
 * Device event codes pair up by an offset of 128:
 *   1–74    → accident END   (pairs with start code+128)
 *   128–200 → accident START
 *   75–127, 201+ → standalone notification (no pair, no duration)
 */

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

/** Volume attributed to an accident. */
export function calculateAccidentVolume(accident: Accident): number {
  if (accident.type === 'full') return accident.startVolume || 0
  if (accident.type === 'end_only') return accident.endVolume || 0
  return 0
}

export interface AccidentOccurrence {
  startTime: string
  endTime: string
  duration: string
  volume: number
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
export function groupAccidentsByType(accidents: Accident[]): AccidentGroup[] {
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
    const durationMs = standalone
      ? 0
      : new Date(accident.endTime).getTime() - new Date(accident.startTime).getTime()
    const volume = calculateAccidentVolume(accident)

    group.occurrences.push({
      startTime: accident.startTime,
      endTime: accident.endTime,
      duration: standalone ? '—' : calculateDuration(accident.startTime, accident.endTime),
      volume,
      type: accident.type,
      line_id: accident.line_id,
    })
    group.totalCount++
    group.totalDuration += Math.max(0, durationMs)
    group.totalVolume += volume
  }

  const out = [...grouped.values()]
  for (const group of out) {
    group.totalDurationFormatted = group.isStandalone ? '—' : formatMs(group.totalDuration)
  }
  return out.sort((a, b) => b.totalCount - a.totalCount)
}

export function filterAccidentsByLine(accidents: Accident[], lineId: number | null): Accident[] {
  if (!lineId) return accidents
  return accidents.filter((a) => a.line_id === lineId)
}
