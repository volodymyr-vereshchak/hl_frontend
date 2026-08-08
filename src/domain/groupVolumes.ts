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

export interface VolumeRecord {
  line_id?: number | null
  period?: string | null
  volume?: number | null
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
  const wanted = new Set(lineIds)
  const byPeriod = new Map<string, GroupVolumeRow>()

  for (const r of records) {
    const lineId = r.line_id
    const period = r.period
    if (lineId == null || period == null || !wanted.has(lineId)) continue
    // `null` first and explicitly: Number(null) is 0, not NaN, so a missing
    // volume would otherwise be counted as a reported zero.
    if (r.volume == null) continue
    const volume = Number(r.volume)
    if (!Number.isFinite(volume)) continue

    let row = byPeriod.get(period)
    if (!row) {
      row = { period, byLine: {}, total: 0, present: 0 }
      byPeriod.set(period, row)
    }
    // The archive can carry more than one record per line-period (a device
    // re-sent an hour); the later one wins rather than being added twice.
    if (row.byLine[lineId] !== undefined) {
      row.total -= row.byLine[lineId]
      row.present -= 1
    }
    row.byLine[lineId] = volume
    row.total += volume
    row.present += 1
  }

  return [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period))
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
