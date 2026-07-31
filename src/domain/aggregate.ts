/**
 * How the archive's footer folds ONE column of numbers into a single value.
 *
 * Chosen per column, not per table: a sum of volumes and an average pressure
 * belong in the same row, and forcing one mode on every column would make at
 * least one of them meaningless. Untouched columns keep the treatment their
 * definition asks for — that default is what the app has always shown.
 */
export type Aggregate = 'sum' | 'avg' | 'max' | 'min'

export const AGGREGATES: Aggregate[] = ['sum', 'avg', 'max', 'min']

/** Locale key per mode — the label in the picker and in its tooltip. */
export const AGGREGATE_LABELS: Record<Aggregate, string> = {
  sum: 'aggregateSum',
  avg: 'aggregateAvg',
  max: 'aggregateMax',
  min: 'aggregateMin',
}

/** What a column shows when the user has not chosen anything for it. */
export function defaultAggregate(spec: {
  isSummable?: boolean
  isAveragable?: boolean
}): Aggregate {
  return spec.isSummable ? 'sum' : 'avg'
}

/** The mode a column is actually showing. */
export function columnAggregate(
  spec: { isSummable?: boolean; isAveragable?: boolean },
  chosen?: Aggregate,
): Aggregate {
  return chosen ?? defaultAggregate(spec)
}

/** Null for an empty column — the footer shows a dash rather than a zero. */
export function fold(values: number[], how: Aggregate): number | null {
  if (!values.length) return null
  switch (how) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0)
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length
    case 'max':
      return Math.max(...values)
    case 'min':
      return Math.min(...values)
  }
}
