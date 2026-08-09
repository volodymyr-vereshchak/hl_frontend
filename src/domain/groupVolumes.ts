/**
 * Pivoting many lines' archives into one table: a row per period, a column per
 * line, and their sum.
 *
 * Pure — the page fetches, this shapes. Which is what makes the sum testable
 * without a server.
 */

export interface GroupVolumeRow {
  period: string
  /** Volume per line id; a line with no record that period is absent. */
  byLine: Record<number, number>
  /** Sum over the lines that HAVE a value — see the note in `pivotVolumes`. */
  total: number
  /** How many of the group's lines reported that period. */
  present: number
}

/** One archive row, as `/daily/` and `/hourly/` return it. */
export interface VolumeRecord {
  line_id?: number | null
  period?: string | null
  volume?: number | null
  pressure?: number | null
  temperature?: number | null
}

export interface PivotRow<T> {
  period: string
  byLine: Record<number, T>
  /** How many of the requested lines reported that period. */
  present: number
}

/** A number, or null for anything the archive did not actually report. */
export function finiteOrNull(v: number | null | undefined): number | null {
  // `null` first and explicitly: Number(null) is 0, not NaN, so a missing
  // reading would otherwise be counted as a reported zero.
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Rows keyed by period, in period order, reading ONE value per record.
 *
 * `read` returning null means "this record has nothing usable here" — the
 * distinction `Number(null) === 0` would destroy. It is also where a value
 * gets converted: a pressure is normalised once per record on the way in,
 * never after it has been subtracted from another line's.
 */
export function pivotBy<T>(
  records: VolumeRecord[],
  lineIds: number[],
  read: (r: VolumeRecord) => T | null,
): PivotRow<T>[] {
  const wanted = new Set(lineIds)
  const byPeriod = new Map<string, PivotRow<T>>()

  for (const r of records) {
    const lineId = r.line_id
    const period = r.period
    if (lineId == null || period == null || !wanted.has(lineId)) continue
    const value = read(r)
    if (value === null) continue

    let row = byPeriod.get(period)
    if (!row) {
      row = { period, byLine: {}, present: 0 }
      byPeriod.set(period, row)
    }
    // The archive can carry more than one record per line-period (a device
    // re-sent an hour); the later one wins rather than being counted twice.
    if (row.byLine[lineId] === undefined) row.present += 1
    row.byLine[lineId] = value
  }

  return [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period))
}

/**
 * Rows keyed by period, in period order.
 *
 * The total sums the lines that reported, and `present` says how many those
 * were. It is deliberately NOT null when some line is missing: a ГРС whose
 * meter was replaced mid-month would blank the whole node's total for the
 * days around it, which hides more than it protects. The count is what tells
 * the reader the row is short.
 */
export function pivotVolumes(
  records: VolumeRecord[],
  lineIds: number[],
): GroupVolumeRow[] {
  return pivotBy(records, lineIds, (r) => finiteOrNull(r.volume)).map((row) => ({
    ...row,
    total: Object.values(row.byLine).reduce((s, v) => s + v, 0),
  }))
}

/** Per line: the sum over the whole period. Used by the totals row. */
export function lineTotals(rows: GroupVolumeRow[], lineIds: number[]): Record<number, number> {
  const out: Record<number, number> = {}
  for (const id of lineIds) out[id] = 0
  for (const row of rows) {
    for (const id of lineIds) {
      const v = row.byLine[id]
      if (v !== undefined) out[id] += v
    }
  }
  return out
}

/** «01.05.2026» for a day, «01.05 07:00» for an hour. */
export function formatGroupPeriod(period: string, type: 'daily' | 'hourly'): string {
  const [datePart, timePart = ''] = period.replace(' ', 'T').split('T')
  const [y, m, d] = datePart.split('-')
  if (type === 'daily') return `${d}.${m}.${y}`
  return `${d}.${m} ${timePart.slice(0, 5)}`
}
