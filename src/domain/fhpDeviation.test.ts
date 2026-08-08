import { describe, it, expect } from 'vitest'
import {
  chartRows,
  recountTolerance,
  referenceChanged,
  spreadOf,
  summarize,
  tableRows,
} from './fhpDeviation'
import { formatDelta, formatFhp, formatPeriod, periodAxisLabel } from './fhpParams'
import type { FhpParamBlock } from '@/api/fhpReport'

// The same numbers as tests/unit/test_fhp_series.py::TestLineStats — the two
// tolerance implementations are meant to agree, and copying the fixture is the
// only thing that keeps them from drifting apart unnoticed.
const DELTAS = [0.01, 0.05, -0.09]
const PERIODS = ['2026-05-01T07:00:00', '2026-05-01T08:00:00', '2026-05-01T09:00:00']
const line = { deltas: DELTAS, delta_pcts: DELTAS.map((d) => d * 100) }

describe('recountTolerance', () => {
  it('flags what exceeds an absolute tolerance', () => {
    expect(recountTolerance(line, 0.04, 'abs')).toEqual([false, true, true])
  })

  it('flags what exceeds a percentage tolerance', () => {
    expect(recountTolerance(line, 4, 'pct')).toEqual([false, true, true])
  })

  it('a period with no deviation is never a breach', () => {
    expect(recountTolerance({ deltas: [null, 0.5], delta_pcts: null }, 0.1, 'abs'))
      .toEqual([false, true])
  })

  it('a reference line has nothing to flag', () => {
    expect(recountTolerance({ deltas: null, delta_pcts: null }, 0.1, 'abs')).toEqual([])
  })
})

describe('summarize', () => {
  it('signed and absolute means differ', () => {
    const s = summarize({ deltas: [0.02, -0.04], delta_pcts: null }, PERIODS, 0.1, 'abs')!
    expect(s.meanDelta).toBeCloseTo(-0.01, 10)
    expect(s.meanAbsDelta).toBeCloseTo(0.03, 10)
  })

  it('counts the breaches the backend would count', () => {
    const s = summarize(line, PERIODS, 0.04, 'abs')!
    expect(s.n).toBe(3)
    expect(s.outOfTolerance).toBe(2)
    expect(s.outOfToleranceShare).toBeCloseTo(200 / 3, 10)
  })

  it('the first of a tie is the worst', () => {
    const s = summarize({ deltas: [0.05, -0.05], delta_pcts: null }, PERIODS, 1, 'abs')!
    expect(s.maxAbsDelta).toBeCloseTo(0.05, 10)
    expect(s.maxAbsDeltaAt).toBe(PERIODS[0])
  })

  it('an all-null series has no summary', () => {
    expect(summarize({ deltas: [null, null], delta_pcts: null }, PERIODS, 0.1, 'abs'))
      .toBeNull()
  })

  it('a reference line has no summary', () => {
    expect(summarize({ deltas: null, delta_pcts: null }, PERIODS, 0.1, 'abs')).toBeNull()
  })
})

describe('spreadOf', () => {
  it('ignores the lines that have no value', () => {
    expect(spreadOf([0.74, null, 0.76])).toEqual({ min: 0.74, max: 0.76, spread: expect.closeTo(0.02, 10) })
  })

  it('nothing present means no spread', () => {
    expect(spreadOf([null, null])).toEqual({ min: null, max: null, spread: null })
  })
})

function block(overrides: Partial<FhpParamBlock> = {}): FhpParamBlock {
  return {
    param: 'density',
    label: 'Густина',
    unit: 'кг/м³',
    decimals: 4,
    tolerance: 0.002,
    tolerance_mode: 'abs',
    has_reference: true,
    periods: PERIODS,
    hours_present: null,
    reference: [0.75, 0.75, 0.75],
    reference_count: [1, 1, 1],
    spread_min: [0.74, 0.74, 0.74],
    spread_max: [0.76, 0.76, 0.76],
    spread: [0.02, 0.02, 0.02],
    rejected_changes: 0,
    lines: [
      {
        line_id: 1, line_name: 'Еталон', is_reference: true, status: 'ok',
        values: [0.75, 0.75, 0.75], deltas: null, delta_pcts: null,
        stale: [false, false, false], stats: null,
      },
      {
        line_id: 2, line_name: 'Ручна', is_reference: false, status: 'ok',
        values: [0.76, 0.80, 0.66], deltas: DELTAS, delta_pcts: DELTAS.map((d) => d * 100),
        stale: [false, false, true], stats: null,
      },
    ],
    ...overrides,
  }
}

describe('tableRows', () => {
  it('lines up every column with its period', () => {
    const rows = tableRows(block(), 0.04, 'abs')
    expect(rows).toHaveLength(3)
    expect(rows[1].period).toBe(PERIODS[1])
    expect(rows[1].reference).toBe(0.75)
    expect(rows[1].cells[1]).toMatchObject({
      lineId: 2, value: 0.8, delta: 0.05, breach: true, stale: false,
    })
    expect(rows[2].cells[1].stale).toBe(true)
  })

  it('a route without a reference still has values and spread', () => {
    const rows = tableRows(
      block({
        has_reference: false, reference: null, reference_count: null,
        lines: block().lines.map((l) => ({ ...l, deltas: null, delta_pcts: null })),
      }),
      0.04,
      'abs',
    )
    expect(rows[0].reference).toBeNull()
    expect(rows[0].cells.every((c) => c.delta === null && !c.breach)).toBe(true)
    expect(rows[0].spread).toBeCloseTo(0.02, 10)
  })
})

describe('chartRows', () => {
  it('values view carries every line plus the reference', () => {
    const rows = chartRows(block(), 'values')
    expect(rows[0]).toEqual({
      period: PERIODS[0], line_1: 0.75, line_2: 0.76, reference: 0.75,
    })
  })

  it('deviation view drops the reference lines', () => {
    const rows = chartRows(block(), 'deltas')
    expect(rows[0]).toEqual({ period: PERIODS[0], line_2: 0.01 })
  })
})

describe('referenceChanged', () => {
  it('a constant reference composition is not a change', () => {
    expect(referenceChanged(block())).toBe(false)
  })

  it('two reference lines dropping to one is', () => {
    expect(referenceChanged(block({ reference_count: [2, 2, 1] }))).toBe(true)
  })
})

describe('formatting', () => {
  it('missing values read as an em dash', () => {
    expect(formatFhp(null, 4)).toBe('—')
    expect(formatDelta(undefined, 4)).toBe('—')
  })

  it('deviations always carry their sign', () => {
    expect(formatDelta(0.0027, 4)).toBe('+0,0027')
    expect(formatDelta(-0.0027, 4)).toBe('−0,0027')
    expect(formatDelta(0, 4)).toBe('0,0000')
  })

  it('values keep the parameter decimals', () => {
    expect(formatFhp(0.7467, 4)).toBe('0,7467')
    expect(formatFhp(1.95, 4)).toBe('1,9500')
  })

  it('periods read as hours or as days', () => {
    expect(formatPeriod('2026-05-01T07:00:00', 'hourly')).toBe('01.05 07:00')
    expect(formatPeriod('2026-05-01', 'daily')).toBe('01.05.2026')
  })

  it('axis ticks split the date from the hour', () => {
    expect(periodAxisLabel('2026-05-01T07:00:00', 'hourly')).toEqual(['01.05', '07:00'])
    // Daily ticks have nothing for the second line, which is what hides it.
    expect(periodAxisLabel('2026-05-01', 'daily')).toEqual(['01.05', ''])
  })
})
