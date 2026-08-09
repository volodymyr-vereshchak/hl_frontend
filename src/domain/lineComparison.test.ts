import { describe, it, expect } from 'vitest'
import {
  buildComparison,
  columnValues,
  comparisonChartRows,
  defaultAggFor,
  quantityMeta,
  toDeltaSeries,
  totalDeltaPct,
  type ComparisonLine,
} from './lineComparison'
import { summarize } from './fhpDeviation'
import type { VolumeRecord } from './groupVolumes'

const MAIN: ComparisonLine = { id: 1, name: 'Основа', pressureUnit: 'кгс/см²' }
const DUP: ComparisonLine = { id: 2, name: 'Дубль', pressureUnit: 'кгс/см²' }

const vol = (line_id: number, period: string, volume: number | null): VolumeRecord => ({
  line_id,
  period,
  volume,
})
const press = (line_id: number, period: string, pressure: number | null): VolumeRecord => ({
  line_id,
  period,
  pressure,
})
const temp = (line_id: number, period: string, temperature: number): VolumeRecord => ({
  line_id,
  period,
  temperature,
})

const build = (records: VolumeRecord[], over: Partial<Parameters<typeof buildComparison>[0]> = {}) =>
  buildComparison({
    records,
    main: MAIN,
    duplicates: [DUP],
    quantity: 'volume',
    tolerance: 100,
    toleranceMode: 'abs',
    ...over,
  })

describe('buildComparison — volume', () => {
  it('subtracts the duplicate from the main, period by period', () => {
    const r = build([
      vol(1, '2026-05-01', 1000),
      vol(2, '2026-05-01', 1010),
      vol(1, '2026-05-02', 900),
      vol(2, '2026-05-02', 880),
    ])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0].main).toBe(1000)
    expect(r.rows[0].byLine[2]).toMatchObject({ value: 1010, delta: 10, lonely: false })
    expect(r.rows[0].byLine[2].deltaPct).toBeCloseTo(1, 10)
    expect(r.rows[1].byLine[2].delta).toBe(-20)
  })

  it('positive delta means the duplicate reads higher', () => {
    const r = build([vol(1, '2026-05-01', 100), vol(2, '2026-05-01', 105)])
    expect(r.rows[0].byLine[2].delta).toBeGreaterThan(0)
  })

  it('a duplicate carrying the main id is dropped', () => {
    const r = build([vol(1, '2026-05-01', 100)], {
      duplicates: [{ ...MAIN }],
    })
    expect(r.rows[0].byLine).toEqual({})
  })
})

describe('buildComparison — one side missing', () => {
  it('keeps the row when only the main reported', () => {
    const r = build([vol(1, '2026-05-01', 100)])
    const cell = r.rows[0].byLine[2]
    expect(cell).toMatchObject({ value: null, delta: null, deltaPct: null, lonely: true })
    expect(r.rows[0].main).toBe(100)
  })

  it('keeps the row when only the duplicate reported', () => {
    const r = build([vol(2, '2026-05-01', 100)])
    expect(r.rows[0].main).toBeNull()
    expect(r.rows[0].byLine[2]).toMatchObject({ value: 100, delta: null, lonely: true })
    expect(r.rows[0].present).toBe(1)
    expect(r.mainMissing).toBe(1)
    expect(r.warnings.some((w) => w.includes('Основна лінія'))).toBe(true)
  })

  it('a duplicate that reported nothing at all is listed, not dropped', () => {
    // A dead duplicate IS the finding — its column has to stay on screen.
    const r = build([vol(1, '2026-05-01', 100)])
    expect(r.silentLineIds).toEqual([2])
  })
})

describe('buildComparison — zero baseline', () => {
  it('a zero main gives no percentage, never infinity', () => {
    const r = build([vol(1, '2026-05-01', 0), vol(2, '2026-05-01', 100)])
    expect(r.rows[0].byLine[2].delta).toBe(100)
    expect(r.rows[0].byLine[2].deltaPct).toBeNull()
  })

  it('zero against zero is not 100 % agreement, it is no measurement', () => {
    const r = build([vol(1, '2026-05-01', 0), vol(2, '2026-05-01', 0)])
    expect(r.rows[0].byLine[2].delta).toBe(0)
    expect(r.rows[0].byLine[2].deltaPct).toBeNull()
  })
})

describe('buildComparison — pressure units', () => {
  const BAR: ComparisonLine = { id: 2, name: 'Дубль', pressureUnit: 'бар' }

  it('converts the duplicate into the main line unit before subtracting', () => {
    // 1 бар = 1e5 Па = 1e5/98066.5 кгс/см² = 1.0197162…
    const r = build([press(1, '2026-05-01', 1), press(2, '2026-05-01', 1)], {
      quantity: 'pressure',
      duplicates: [BAR],
      tolerance: 10,
    })
    expect(r.unit).toBe('кгс/см²')
    expect(r.rows[0].byLine[2].value).toBeCloseTo(1e5 / 98066.5, 9)
    expect(r.rows[0].byLine[2].delta).toBeCloseTo(1e5 / 98066.5 - 1, 9)
  })

  it('an explicit target unit converts BOTH sides', () => {
    const r = build([press(1, '2026-05-01', 10), press(2, '2026-05-01', 10)], {
      quantity: 'pressure',
      targetUnit: 'МПа',
      tolerance: 10,
    })
    expect(r.unit).toBe('МПа')
    // 10 кгс/см² = 10 × 98066.5 Па = 0.980665 МПа, for both lines.
    expect(r.rows[0].main).toBeCloseTo(0.980665, 9)
    expect(r.rows[0].byLine[2].delta).toBeCloseTo(0, 12)
  })

  it('a line with no unit is assumed to be the archive default AND says so', () => {
    const r = build([press(1, '2026-05-01', 10), press(2, '2026-05-01', 10)], {
      quantity: 'pressure',
      duplicates: [{ id: 2, name: 'Дубль', pressureUnit: null }],
      tolerance: 10,
    })
    expect(r.rows[0].byLine[2].delta).toBeCloseTo(0, 12)
    expect(r.warnings.some((w) => w.includes('одиниці тиску'))).toBe(true)
  })

  it('volume and temperature are never converted', () => {
    expect(build([vol(1, '2026-05-01', 1)]).unit).toBe('м³')
    expect(build([temp(1, '2026-05-01', 1)], { quantity: 'temperature' }).unit).toBe('°C')
  })
})

describe('buildComparison — negative temperature', () => {
  it('the percentage keeps the sign of the deviation', () => {
    // Main −5 °C, duplicate −4 °C: the duplicate is WARMER, so Δ is +1 and the
    // percentage must be positive too. With a raw (unsigned-abs) denominator
    // this would come out −20 and contradict the Δ column beside it.
    const r = build([temp(1, '2026-05-01', -5), temp(2, '2026-05-01', -4)], {
      quantity: 'temperature',
      tolerance: 10,
    })
    expect(r.rows[0].byLine[2].delta).toBeCloseTo(1, 10)
    expect(r.rows[0].byLine[2].deltaPct).toBeCloseTo(20, 10)
  })
})

describe('buildComparison — tolerance', () => {
  it('trips strictly above the threshold, in absolute mode', () => {
    const at = build([vol(1, '2026-05-01', 100), vol(2, '2026-05-01', 110)], { tolerance: 10 })
    expect(at.rows[0].byLine[2].breach).toBe(false)
    const over = build([vol(1, '2026-05-01', 100), vol(2, '2026-05-01', 110.1)], {
      tolerance: 10,
    })
    expect(over.rows[0].byLine[2].breach).toBe(true)
  })

  it('percentage mode reads the percentage, not the absolute', () => {
    const r = build([vol(1, '2026-05-01', 1000), vol(2, '2026-05-01', 1100)], {
      tolerance: 5,
      toleranceMode: 'pct',
    })
    expect(r.rows[0].byLine[2].breach).toBe(true) // 10 % > 5 %
    const inside = build([vol(1, '2026-05-01', 1000), vol(2, '2026-05-01', 1020)], {
      tolerance: 5,
      toleranceMode: 'pct',
    })
    expect(inside.rows[0].byLine[2].breach).toBe(false) // 2 % < 5 %
  })
})

describe('totalDeltaPct', () => {
  it('weighs by the totals, not by the periods', () => {
    // 10 % of 100 and 100 % of 1 — the honest answer is 11/101, not 55 %.
    const r = build([
      vol(1, '2026-05-01', 100),
      vol(2, '2026-05-01', 110),
      vol(1, '2026-05-02', 1),
      vol(2, '2026-05-02', 2),
    ])
    const pct = totalDeltaPct(r.rows, 2)!
    expect(pct).toBeCloseTo((11 / 101) * 100, 9)
    expect(pct).toBeCloseTo(10.891, 3)
    expect(pct).not.toBeCloseTo(55, 0)
  })

  it('no comparable period gives null', () => {
    const r = build([vol(1, '2026-05-01', 100)])
    expect(totalDeltaPct(r.rows, 2)).toBeNull()
  })

  it('a zero total baseline gives null rather than infinity', () => {
    const r = build([vol(1, '2026-05-01', 0), vol(2, '2026-05-01', 5)])
    expect(totalDeltaPct(r.rows, 2)).toBeNull()
  })
})

describe('toDeltaSeries', () => {
  it('stays index-aligned with the rows', () => {
    const r = build([
      vol(1, '2026-05-01', 100),
      vol(2, '2026-05-01', 110),
      vol(1, '2026-05-02', 100), // duplicate silent this period
      vol(1, '2026-05-03', 100),
      vol(2, '2026-05-03', 90),
    ])
    const series = toDeltaSeries(r.rows, 2)
    expect(series.deltas).toHaveLength(r.rows.length)
    // The empty period keeps its slot — compacting it out would move every
    // later period one place left and make summarize name the wrong moment.
    expect(series.deltas).toEqual([10, null, -10])
  })

  it('feeds summarize the right moment of maximum', () => {
    const r = build([
      vol(1, '2026-05-01', 100),
      vol(2, '2026-05-01', 105),
      vol(1, '2026-05-02', 100),
      vol(2, '2026-05-02', 130),
    ])
    const stats = summarize(
      toDeltaSeries(r.rows, 2),
      r.rows.map((row) => row.period),
      10,
      'abs',
    )!
    expect(stats.maxAbsDelta).toBeCloseTo(30, 10)
    expect(stats.maxAbsDeltaAt).toBe('2026-05-02')
    expect(stats.outOfTolerance).toBe(1)
  })
})

describe('columnValues and chart rows', () => {
  it('drops the empty periods when folding a column', () => {
    const r = build([
      vol(1, '2026-05-01', 100),
      vol(2, '2026-05-01', 110),
      vol(1, '2026-05-02', 100),
    ])
    expect(columnValues(r.rows, 2, 'value')).toEqual([110])
    expect(columnValues(r.rows, 2, 'delta')).toEqual([10])
  })

  it('the values view carries the main, the deviations view does not', () => {
    const r = build([vol(1, '2026-05-01', 100), vol(2, '2026-05-01', 110)])
    expect(comparisonChartRows(r.rows, [2], 'values')).toEqual([
      { period: '2026-05-01', line_2: 110, main: 100 },
    ])
    expect(comparisonChartRows(r.rows, [2], 'deltas')).toEqual([
      { period: '2026-05-01', line_2: 10 },
    ])
  })

  it('the deviations view can plot percentages instead', () => {
    const r = build([vol(1, '2026-05-01', 100), vol(2, '2026-05-01', 110)])
    expect(comparisonChartRows(r.rows, [2], 'deltas', true)[0].line_2).toBeCloseTo(10, 10)
  })
})

describe('quantityMeta and defaultAggFor', () => {
  it('volume adds up, pressure and temperature average', () => {
    expect(defaultAggFor('volume', 'value')).toBe('sum')
    expect(defaultAggFor('pressure', 'delta')).toBe('avg')
    expect(defaultAggFor('temperature', 'value')).toBe('avg')
  })

  it('pressure takes the unit it was converted into', () => {
    expect(quantityMeta('pressure', 'бар').unit).toBe('бар')
    expect(quantityMeta('volume', 'бар').unit).toBe('м³')
    expect(quantityMeta('temperature', 'бар').unit).toBe('°C')
  })
})
