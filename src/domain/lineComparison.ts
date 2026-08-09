/**
 * Comparing duplicate metering lines against a main one.
 *
 * The lines measure the same gas, so pressure and temperature should agree and
 * volumes should differ only within instrument error. This turns the archive
 * rows of several lines into one table of deviations from the main line.
 *
 * Pure — the page fetches, this shapes and subtracts.
 */

import type { Aggregate } from './aggregate'
import { finiteOrNull, pivotBy, type VolumeRecord } from './groupVolumes'
import { PRESSURE_UNIT_DEFAULT, convertPressureValue, normalizeUnit } from './pressureUnits'

export type Quantity = 'volume' | 'pressure' | 'temperature'
export type ToleranceMode = 'abs' | 'pct'

export interface ComparisonLine {
  id: number
  name: string
  /** `gas_volume_line.pressure_unit`; null when the line has none configured. */
  pressureUnit: string | null
}

export interface ComparisonCell {
  value: number | null
  /** duplicate − main, in the target unit. Positive = the duplicate reads higher. */
  delta: number | null
  /** delta / |main| × 100. Null when the main is absent or zero. */
  deltaPct: number | null
  breach: boolean
  /** Exactly one of the two sides reported this period. */
  lonely: boolean
}

export interface ComparisonRow {
  period: string
  main: number | null
  byLine: Record<number, ComparisonCell>
  /** How many of main + duplicates reported this period. */
  present: number
}

export interface ComparisonResult {
  rows: ComparisonRow[]
  /** The unit everything was converted into; '' where there is nothing to convert. */
  unit: string
  /** Duplicates with no record at all — their column is all dashes. */
  silentLineIds: number[]
  /** Periods the MAIN line did not report; every Δ there is empty. */
  mainMissing: number
  warnings: string[]
}

const QUANTITY_META: Record<
  Quantity,
  { label: string; unit: string; decimals: number; tolAbs: number; tolPct: number }
> = {
  // Volumes are м³ and add up; a few м³ on a ГРС day is noise, hence 0.5 %.
  volume: { label: "Об'єм", unit: 'м³', decimals: 2, tolAbs: 100, tolPct: 0.5 },
  // Two correctors on the same pipe should agree to a few hundredths.
  pressure: { label: 'Тиск', unit: '', decimals: 3, tolAbs: 0.05, tolPct: 0.5 },
  // …and to a few tenths of a degree.
  temperature: { label: 'Температура', unit: '°C', decimals: 2, tolAbs: 0.3, tolPct: 2 },
}

export function quantityMeta(quantity: Quantity, unit: string) {
  const meta = QUANTITY_META[quantity]
  return {
    label: meta.label,
    unit: quantity === 'pressure' ? unit : meta.unit,
    decimals: meta.decimals,
    defaultToleranceAbs: meta.tolAbs,
    defaultTolerancePct: meta.tolPct,
  }
}

/**
 * How a column of this quantity folds in the totals row.
 *
 * Volumes add up; a pressure or a temperature summed over a month means
 * nothing, so those average.
 */
export function defaultAggFor(quantity: Quantity, role: 'value' | 'delta'): Aggregate {
  void role
  return quantity === 'volume' ? 'sum' : 'avg'
}

interface BuildParams {
  records: VolumeRecord[]
  main: ComparisonLine
  duplicates: ComparisonLine[]
  quantity: Quantity
  /** Pressure only; defaults to the main line's unit. */
  targetUnit?: string
  tolerance: number
  toleranceMode: ToleranceMode
}

export function buildComparison({
  records,
  main,
  duplicates,
  quantity,
  targetUnit,
  tolerance,
  toleranceMode,
}: BuildParams): ComparisonResult {
  const warnings: string[] = []
  // Defensive: the selection reducers already keep these apart, but a stale
  // stored selection must not make a line its own baseline.
  const dups = duplicates.filter((d) => d.id !== main.id)
  const lineIds = [main.id, ...dups.map((d) => d.id)]

  const unit =
    quantity === 'pressure'
      ? targetUnit || normalizeUnit(main.pressureUnit) || PRESSURE_UNIT_DEFAULT
      : QUANTITY_META[quantity].unit

  // Unit per line, resolved once. A line with nothing configured is assumed to
  // be reporting in the archive default — but SAID so, because silently
  // assuming it already matches the target is how a factor of ten gets in.
  const unitOf = new Map<number, string>()
  if (quantity === 'pressure') {
    for (const line of [main, ...dups]) {
      const own = normalizeUnit(line.pressureUnit)
      if (!own) {
        warnings.push(
          `Лінія «${line.name}» не має налаштованої одиниці тиску — прийнято ${PRESSURE_UNIT_DEFAULT}`,
        )
      }
      unitOf.set(line.id, own || PRESSURE_UNIT_DEFAULT)
    }
  }

  const read = (r: VolumeRecord): number | null => {
    if (quantity === 'temperature') return finiteOrNull(r.temperature)
    if (quantity === 'volume') return finiteOrNull(r.volume)
    const raw = finiteOrNull(r.pressure)
    if (raw === null || r.line_id == null) return null
    return convertPressureValue(raw, unitOf.get(r.line_id) ?? PRESSURE_UNIT_DEFAULT, unit)
  }

  const pivoted = pivotBy(records, lineIds, read)

  let mainMissing = 0
  const seen = new Set<number>()

  const rows: ComparisonRow[] = pivoted.map((row) => {
    const mainValue = row.byLine[main.id] ?? null
    if (mainValue === null) mainMissing += 1

    const byLine: Record<number, ComparisonCell> = {}
    for (const dup of dups) {
      const value = row.byLine[dup.id] ?? null
      if (value !== null) seen.add(dup.id)

      const both = value !== null && mainValue !== null
      const delta = both ? value - mainValue : null
      // |main| in the denominator, not main: temperature goes below zero, and
      // a raw −5 °C baseline would flip the sign of every percentage while Δ
      // kept its own — the two columns would contradict each other.
      const deltaPct =
        delta !== null && mainValue !== null && mainValue !== 0
          ? (delta / Math.abs(mainValue)) * 100
          : null

      byLine[dup.id] = {
        value,
        delta,
        deltaPct,
        breach: breaches(delta, deltaPct, tolerance, toleranceMode),
        lonely: (value === null) !== (mainValue === null),
      }
    }
    return { period: row.period, main: mainValue, byLine, present: row.present }
  })

  const silentLineIds = dups.filter((d) => !seen.has(d.id)).map((d) => d.id)
  if (mainMissing > 0) {
    warnings.push(`Основна лінія не звітувала за ${mainMissing} ${periodWord(mainMissing)}`)
  }

  return { rows, unit, silentLineIds, mainMissing, warnings }
}

function periodWord(n: number): string {
  const last = n % 10
  const tens = n % 100
  if (tens >= 11 && tens <= 14) return 'періодів'
  if (last === 1) return 'період'
  if (last >= 2 && last <= 4) return 'періоди'
  return 'періодів'
}

function breaches(
  delta: number | null,
  deltaPct: number | null,
  tolerance: number,
  mode: ToleranceMode,
): boolean {
  const v = mode === 'pct' ? deltaPct : delta
  // Strictly greater, matching recountTolerance in fhpDeviation.
  return v !== null && Math.abs(v) > tolerance
}

/**
 * The deviation series of one duplicate, shaped for `summarize` and
 * `recountTolerance` in `fhpDeviation.ts`.
 *
 * Index-aligned with `rows` — a period with no deviation keeps an empty slot
 * rather than being compacted out, or `summarize` would report the wrong
 * moment as the maximum.
 */
export function toDeltaSeries(
  rows: ComparisonRow[],
  lineId: number,
): { deltas: (number | null)[]; delta_pcts: (number | null)[] } {
  return {
    deltas: rows.map((r) => r.byLine[lineId]?.delta ?? null),
    delta_pcts: rows.map((r) => r.byLine[lineId]?.deltaPct ?? null),
  }
}

/**
 * Δ% of the totals — ΣΔ / |Σmain| × 100.
 *
 * NOT the average of the per-period percentages: 100 % of 1 м³ and 10 % of
 * 100 м³ average to 55 %, while the honest answer for the period is 10.9 %.
 */
export function totalDeltaPct(rows: ComparisonRow[], lineId: number): number | null {
  let sumDelta = 0
  let sumMain = 0
  let any = false
  for (const row of rows) {
    const cell = row.byLine[lineId]
    if (!cell || cell.delta === null || row.main === null) continue
    sumDelta += cell.delta
    sumMain += row.main
    any = true
  }
  if (!any || sumMain === 0) return null
  return (sumDelta / Math.abs(sumMain)) * 100
}

/** Per line: the fold input for the totals row (nulls dropped). */
export function columnValues(
  rows: ComparisonRow[],
  lineId: number,
  field: 'value' | 'delta',
): number[] {
  const out: number[] = []
  for (const row of rows) {
    const v = row.byLine[lineId]?.[field]
    if (v !== null && v !== undefined) out.push(v)
  }
  return out
}

/** The main line's own column, for the totals row. */
export function mainValues(rows: ComparisonRow[]): number[] {
  return rows.map((r) => r.main).filter((v): v is number => v !== null)
}

/** Recharts data: one object per period, one key per line. */
export function comparisonChartRows(
  rows: ComparisonRow[],
  lineIds: number[],
  view: 'deltas' | 'values',
  usePct = false,
): Record<string, number | string | null>[] {
  return rows.map((row) => {
    const point: Record<string, number | string | null> = { period: row.period }
    for (const id of lineIds) {
      const cell = row.byLine[id]
      point[`line_${id}`] =
        view === 'deltas' ? (usePct ? (cell?.deltaPct ?? null) : (cell?.delta ?? null)) : (cell?.value ?? null)
    }
    if (view === 'values') point.main = row.main
    return point
  })
}
