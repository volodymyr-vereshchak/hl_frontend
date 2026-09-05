/**
 * The column layout of an FHP comparison table, derived once.
 *
 * The page split `block.lines` into reference and comparison lines in four
 * separate places — the two header rows, the body and the footer — and
 * expressed the table's width a fifth time, by hand, inside a `colSpan`. Five
 * statements of one fact, and the `colSpan` one had to be kept in step with
 * the other four by whoever next added a column.
 *
 * The shape of the table depends on a single flag. WITH a reference, each
 * comparison line occupies three columns (value, Δ, Δ%) and the reference gets
 * a column of its own. WITHOUT one there is nothing to compare against, so
 * each line is one column and the table ends with min / max / spread instead.
 */
import type { FhpLineSeries, FhpParamBlock } from '@/api/fhpReport'

export interface FhpLayout {
  /** Lines that FEED the reference — shown as plain value columns. */
  reference: FhpLineSeries[]
  /** Lines compared AGAINST the reference. */
  comparison: FhpLineSeries[]
  /** Columns each comparison line occupies: 3 with a reference, 1 without. */
  perComparison: number
  /** Total columns, `Період` included — what a full-width cell must span. */
  total: number
}

export function fhpLayout(block: FhpParamBlock): FhpLayout {
  const reference = block.lines.filter((l) => l.is_reference)
  const comparison = block.lines.filter((l) => !l.is_reference)
  const perComparison = block.has_reference ? 3 : 1
  const total =
    1 + // Період
    reference.length +
    (block.has_reference ? 1 : 0) + // Еталон
    comparison.length * perComparison +
    (block.has_reference ? 0 : 3) // Мін / Макс / Розкид
  return { reference, comparison, perComparison, total }
}
