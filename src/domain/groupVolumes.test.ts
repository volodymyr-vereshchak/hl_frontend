import { describe, it, expect } from 'vitest'
import {
  finiteOrNull,
  formatGroupPeriod,
  lineTotals,
  pivotBy,
  pivotVolumes,
  type VolumeRecord,
} from './groupVolumes'

const rec = (line_id: number, period: string, volume: number | null): VolumeRecord => ({
  line_id,
  period,
  volume,
})

describe('pivotVolumes', () => {
  it('puts each line in its own column and sums the row', () => {
    const rows = pivotVolumes(
      [
        rec(1, '2026-05-01', 100),
        rec(2, '2026-05-01', 250),
        rec(1, '2026-05-02', 110),
        rec(2, '2026-05-02', 240),
      ],
      [1, 2],
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ period: '2026-05-01', total: 350, present: 2 })
    expect(rows[0].byLine).toEqual({ 1: 100, 2: 250 })
    expect(rows[1].total).toBe(350)
  })

  it('orders rows by period whatever order they arrive in', () => {
    const rows = pivotVolumes(
      [rec(1, '2026-05-03', 1), rec(1, '2026-05-01', 2), rec(1, '2026-05-02', 3)],
      [1],
    )
    expect(rows.map((r) => r.period)).toEqual(['2026-05-01', '2026-05-02', '2026-05-03'])
  })

  it('a line that did not report is simply absent, and the row says so', () => {
    const rows = pivotVolumes([rec(1, '2026-05-01', 100)], [1, 2])
    expect(rows[0].byLine[2]).toBeUndefined()
    expect(rows[0].total).toBe(100)
    // Not null: one silent line must not blank the whole node's total. The
    // count is what tells the reader the row is short.
    expect(rows[0].present).toBe(1)
  })

  it('ignores lines outside the group', () => {
    const rows = pivotVolumes([rec(1, '2026-05-01', 100), rec(9, '2026-05-01', 999)], [1])
    expect(rows[0].total).toBe(100)
    expect(rows[0].byLine[9]).toBeUndefined()
  })

  it('a repeated line-period is replaced, not added twice', () => {
    const rows = pivotVolumes(
      [rec(1, '2026-05-01', 100), rec(1, '2026-05-01', 120)],
      [1],
    )
    expect(rows[0].total).toBe(120)
    expect(rows[0].present).toBe(1)
  })

  it('skips records with no usable volume', () => {
    const rows = pivotVolumes(
      [rec(1, '2026-05-01', null), rec(2, '2026-05-01', 50)],
      [1, 2],
    )
    expect(rows[0].total).toBe(50)
    expect(rows[0].present).toBe(1)
  })

  it('nothing in, nothing out', () => {
    expect(pivotVolumes([], [1, 2])).toEqual([])
  })
})

describe('lineTotals', () => {
  it('sums each line over the whole period', () => {
    const rows = pivotVolumes(
      [
        rec(1, '2026-05-01', 100),
        rec(2, '2026-05-01', 250),
        rec(1, '2026-05-02', 110),
      ],
      [1, 2],
    )
    expect(lineTotals(rows, [1, 2])).toEqual({ 1: 210, 2: 250 })
  })

  it('a line with no data at all totals zero rather than vanishing', () => {
    expect(lineTotals([], [7])).toEqual({ 7: 0 })
  })
})

describe('formatGroupPeriod', () => {
  it('days and hours read differently', () => {
    expect(formatGroupPeriod('2026-05-01', 'daily')).toBe('01.05.2026')
    expect(formatGroupPeriod('2026-05-01T07:00:00', 'hourly')).toBe('01.05 07:00')
  })

  it('accepts the space-separated stamps the archive also returns', () => {
    expect(formatGroupPeriod('2026-05-01 07:00:00', 'hourly')).toBe('01.05 07:00')
  })
})


describe('pivotBy', () => {
  const withP = (line_id: number, period: string, pressure: number | null): VolumeRecord => ({
    line_id,
    period,
    pressure,
  })

  it('reads whatever field the caller asks for', () => {
    const rows = pivotBy(
      [withP(1, '2026-05-01', 32.1), withP(2, '2026-05-01', 41.8)],
      [1, 2],
      (r) => finiteOrNull(r.pressure),
    )
    expect(rows[0].byLine).toEqual({ 1: 32.1, 2: 41.8 })
    expect(rows[0].present).toBe(2)
  })

  it('a null reading is absent, not a reported zero', () => {
    const rows = pivotBy([withP(1, '2026-05-01', null)], [1], (r) =>
      finiteOrNull(r.pressure),
    )
    expect(rows).toEqual([])
  })

  it('converts on the way in, once per record', () => {
    // This is the whole reason the callback exists: a pressure is normalised
    // before it can be subtracted from another line's.
    const rows = pivotBy([withP(1, '2026-05-01', 10)], [1], (r) => {
      const v = finiteOrNull(r.pressure)
      return v === null ? null : v * 2
    })
    expect(rows[0].byLine[1]).toBe(20)
  })

  it('a repeated line-period is replaced, and counted once', () => {
    const rows = pivotBy(
      [withP(1, '2026-05-01', 30), withP(1, '2026-05-01', 31)],
      [1],
      (r) => finiteOrNull(r.pressure),
    )
    expect(rows[0].byLine[1]).toBe(31)
    expect(rows[0].present).toBe(1)
  })

  it('ignores lines outside the set and orders by period', () => {
    const rows = pivotBy(
      [withP(9, '2026-05-02', 1), withP(1, '2026-05-02', 2), withP(1, '2026-05-01', 3)],
      [1],
      (r) => finiteOrNull(r.pressure),
    )
    expect(rows.map((r) => r.period)).toEqual(['2026-05-01', '2026-05-02'])
    expect(rows[1].byLine[9]).toBeUndefined()
  })
})

describe('finiteOrNull', () => {
  it('keeps zero and rejects everything that is not a number', () => {
    expect(finiteOrNull(0)).toBe(0)
    expect(finiteOrNull(null)).toBeNull()
    expect(finiteOrNull(undefined)).toBeNull()
    expect(finiteOrNull(Number.NaN)).toBeNull()
    expect(finiteOrNull(Number.POSITIVE_INFINITY)).toBeNull()
  })
})
