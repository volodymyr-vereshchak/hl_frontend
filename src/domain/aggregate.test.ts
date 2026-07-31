import { describe, it, expect } from 'vitest'
import {
  AGGREGATES,
  AGGREGATE_LABELS,
  columnAggregate,
  defaultAggregate,
  fold,
} from './aggregate'
import { getArchiveColumns } from './archiveColumns'
import { uk } from '@/locales/uk'
import { ru } from '@/locales/ru'

describe('fold', () => {
  const values = [10, 2, 6]

  it('folds a column each way', () => {
    expect(fold(values, 'sum')).toBe(18)
    expect(fold(values, 'avg')).toBe(6)
    expect(fold(values, 'max')).toBe(10)
    expect(fold(values, 'min')).toBe(2)
  })

  it('returns null for an empty column, not zero', () => {
    // A zero total and "no data at all" must not look the same.
    for (const how of AGGREGATES) expect(fold([], how)).toBeNull()
  })

  it('handles negatives (temperature)', () => {
    expect(fold([-5, -20, 3], 'min')).toBe(-20)
    expect(fold([-5, -20, 3], 'max')).toBe(3)
  })
})

describe('column defaults', () => {
  it('volumes total, measurements average', () => {
    expect(defaultAggregate({ isSummable: true })).toBe('sum')
    expect(defaultAggregate({ isAveragable: true })).toBe('avg')
  })

  it('an explicit choice wins for that column only', () => {
    expect(columnAggregate({ isSummable: true }, 'max')).toBe('max')
    expect(columnAggregate({ isSummable: true })).toBe('sum')
  })

  it('leaves the daily archive showing what it always showed', () => {
    const specs = getArchiveColumns({
      archiveType: 'daily',
      isVirtualLine: false,
      isDpdLine: false,
      lineUnits: {},
      showOutputPressure: false,
      pressureUnit: 'кгс/см²',
      dpUnit: 'кПа',
      t: (k: string) => k,
    })
    const defaults = Object.fromEntries(
      specs
        .filter((s) => s.isSummable || s.isAveragable)
        .map((s) => [s.key, columnAggregate(s)]),
    )
    expect(defaults).toMatchObject({
      volume: 'sum',
      pressure: 'avg',
      temperature: 'avg',
      density: 'avg',
      edit_counts: 'sum',
      sys_counts: 'sum',
    })
  })
})

describe('labels', () => {
  it('every mode is translated in both languages', () => {
    for (const dict of [uk, ru] as unknown as Record<string, string>[]) {
      for (const how of AGGREGATES) expect(dict[AGGREGATE_LABELS[how]]).toBeTruthy()
      expect(dict.summaryRow).toBeTruthy()
      expect(dict.aggregateChange).toBeTruthy()
    }
  })
})
