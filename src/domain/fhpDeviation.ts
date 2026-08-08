/**
 * Presentation arithmetic for «Звірка ФХП».
 *
 * The tolerance is recounted here rather than refetched: turning the knob has
 * to move the "поза допуском" number immediately, and the formula is a single
 * comparison. The backend still computes its own `stats` — those are what the
 * Excel export and any other API consumer see — so the two implementations are
 * pinned to the SAME numbers in the tests on both sides.
 */

import type { FhpLineSeries, FhpParamBlock } from '@/api/fhpReport'

export type ToleranceMode = 'abs' | 'pct'

export interface DeviationSummary {
  n: number
  meanDelta: number
  meanAbsDelta: number
  maxAbsDelta: number
  maxAbsDeltaAt: string
  outOfTolerance: number
  outOfToleranceShare: number
}

/** Per period: is this line outside the tolerance? */
export function recountTolerance(
  line: Pick<FhpLineSeries, 'deltas' | 'delta_pcts'>,
  tolerance: number,
  mode: ToleranceMode,
): boolean[] {
  const source = mode === 'pct' ? line.delta_pcts : line.deltas
  if (!source) return []
  return source.map((v) => v !== null && v !== undefined && Math.abs(v) > tolerance)
}

export function summarize(
  line: Pick<FhpLineSeries, 'deltas' | 'delta_pcts'>,
  periods: string[],
  tolerance: number,
  mode: ToleranceMode,
): DeviationSummary | null {
  const deltas = line.deltas
  if (!deltas) return null

  const present: { delta: number; at: string }[] = []
  deltas.forEach((d, i) => {
    if (d !== null && d !== undefined) present.push({ delta: d, at: periods[i] })
  })
  if (present.length === 0) return null

  const breaches = recountTolerance(line, tolerance, mode)
  let outOfTolerance = 0
  breaches.forEach((b, i) => {
    if (b && deltas[i] !== null && deltas[i] !== undefined) outOfTolerance += 1
  })

  // First of a tie wins, matching the backend's `max(..., key=abs)`.
  let worst = present[0]
  for (const p of present) {
    if (Math.abs(p.delta) > Math.abs(worst.delta)) worst = p
  }

  const n = present.length
  return {
    n,
    meanDelta: present.reduce((s, p) => s + p.delta, 0) / n,
    meanAbsDelta: present.reduce((s, p) => s + Math.abs(p.delta), 0) / n,
    maxAbsDelta: Math.abs(worst.delta),
    maxAbsDeltaAt: worst.at,
    outOfTolerance,
    outOfToleranceShare: (outOfTolerance / n) * 100,
  }
}

/** Min, max and spread of the values a route's lines carry at one period. */
export function spreadOf(values: (number | null)[]): {
  min: number | null
  max: number | null
  spread: number | null
} {
  const present = values.filter((v): v is number => v !== null && v !== undefined)
  if (present.length === 0) return { min: null, max: null, spread: null }
  const min = Math.min(...present)
  const max = Math.max(...present)
  return { min, max, spread: max - min }
}

export interface FhpRow {
  period: string
  index: number
  /** Fewer than 24 marks an incomplete commercial day. */
  hoursPresent: number | null
  reference: number | null
  referenceCount: number | null
  spreadMin: number | null
  spreadMax: number | null
  spread: number | null
  cells: {
    lineId: number
    value: number | null
    delta: number | null
    deltaPct: number | null
    stale: boolean
    breach: boolean
  }[]
}

/** The table, one row per period, aligned across every line of the block. */
export function tableRows(
  block: FhpParamBlock,
  tolerance: number,
  mode: ToleranceMode,
): FhpRow[] {
  const breaches = new Map<number, boolean[]>(
    block.lines.map((line) => [line.line_id, recountTolerance(line, tolerance, mode)]),
  )

  return block.periods.map((period, i) => ({
    period,
    index: i,
    hoursPresent: block.hours_present?.[i] ?? null,
    reference: block.reference?.[i] ?? null,
    referenceCount: block.reference_count?.[i] ?? null,
    spreadMin: block.spread_min[i] ?? null,
    spreadMax: block.spread_max[i] ?? null,
    spread: block.spread[i] ?? null,
    cells: block.lines.map((line) => ({
      lineId: line.line_id,
      value: line.values[i] ?? null,
      delta: line.deltas?.[i] ?? null,
      deltaPct: line.delta_pcts?.[i] ?? null,
      stale: line.stale[i] ?? false,
      breach: breaches.get(line.line_id)?.[i] ?? false,
    })),
  }))
}

/** Recharts data: one object per period, one key per line. */
export function chartRows(
  block: FhpParamBlock,
  view: 'values' | 'deltas',
): Record<string, number | string | null>[] {
  return block.periods.map((period, i) => {
    const row: Record<string, number | string | null> = { period }
    for (const line of block.lines) {
      if (view === 'deltas') {
        if (line.is_reference || !line.deltas) continue
        row[`line_${line.line_id}`] = line.deltas[i] ?? null
      } else {
        row[`line_${line.line_id}`] = line.values[i] ?? null
      }
    }
    if (view === 'values' && block.reference) row.reference = block.reference[i] ?? null
    return row
  })
}

/** True when the reference was not built from the same lines all along. */
export function referenceChanged(block: FhpParamBlock): boolean {
  if (!block.reference_count) return false
  const seen = new Set(
    block.reference_count.filter((_, i) => block.reference?.[i] !== null),
  )
  return seen.size > 1
}
