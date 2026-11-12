import { describe, it, expect } from 'vitest'
import { calculateTrendPercentages, isOutside, median, trendLineStats, trendYCeiling } from './grsTrends'
import type { ArchiveRow } from '@/api/entities'

const day = (d: number) => `2026-05-${String(d).padStart(2, '0')}`

function series(lid: number, n: number, volume: (d: number) => number): ArchiveRow[] {
  return Array.from({ length: n }, (_, i) => ({ line_id: lid, period: day(i + 1), volume: volume(i + 1) }))
}

/** A branch of `n` well-behaved lines of different sizes. */
const branch = (n: number, days: number, shape: (d: number) => number = () => 1) =>
  Array.from({ length: n }, (_, i) => series(i + 1, days, (d) => 100 * (i + 1) * shape(d))).flat()

describe('grs trends', () => {
  it('median of odd, even and empty input', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNaN()
  })

  it('a flat line is an even share of the range', () => {
    const points = calculateTrendPercentages(series(1, 20, () => 100), [], 'daily')
    for (const p of points) expect(p.line_1).toBeCloseTo(5)
  })

  it('one spike day does not push the ordinary days down', () => {
    const points = calculateTrendPercentages(series(1, 30, (d) => (d === 15 ? 1000 : 100)), [], 'daily')
    expect(points[0].line_1).toBeCloseTo(100 / 30)
    expect(points[14].line_1).toBeCloseTo((1000 / 3000) * 100)
    expect(points[14].line_1_outlier).toBe(1)
  })

  it('gaps are skipped, not counted as zero days', () => {
    const rows = series(1, 10, () => 100)
    rows.push({ line_id: 1, period: day(11) })
    const points = calculateTrendPercentages(rows, [], 'daily')
    expect(points).toHaveLength(10)
    expect(points[0].line_1).toBeCloseTo(10)
  })

  it('the corridor is one for the branch: median of the shares and a band', () => {
    const points = calculateTrendPercentages(branch(5, 10), [], 'daily')
    // Every line is 10% of itself each day, so the median is 10 and the
    // band is the 5% floor around it.
    expect(points[0].median).toBeCloseTo(10)
    expect(points[0].band![0]).toBeCloseTo(9.5)
    expect(points[0].band![1]).toBeCloseTo(10.5)
  })

  it('a branch-wide rise stays inside; one line that departs is flagged', () => {
    const rows = [
      ...branch(5, 20, (d) => 1 + d / 10),
      ...series(9, 20, (d) => 100 * (1 + d / 10) * (d >= 11 ? 1.8 : 1)),
    ]
    const points = calculateTrendPercentages(rows, [], 'daily')
    const stats = trendLineStats(points, [1, 2, 3, 4, 5, 9])
    for (const lid of [1, 2, 3, 4, 5]) expect(stats.get(lid)!.outside).toBe(0)
    expect(stats.get(9)!.outside).toBeGreaterThan(5)
  })

  it('a fixed band is ± percent of the median', () => {
    const rows = [...branch(4, 10), ...series(9, 10, (d) => (d === 5 ? 115 : 100))]
    const ten = calculateTrendPercentages(rows, [], 'daily', 10)
    expect(isOutside(ten[4], 9)).toBe(true)
    const twenty = calculateTrendPercentages(rows, [], 'daily', 20)
    expect(isOutside(twenty[4], 9)).toBe(false)
  })

  it('a fault in part of the range shows its full size and leaves the healthy days alone', () => {
    // The Вільнянськ case: line 9 under-meters by 35% from day 7 of 10, on a
    // heating ramp. As a share of its own total it sat ~18% above the branch
    // before the fault and only ~20% below after it.
    const heat = (d: number) => 10 + d
    const rows = [...branch(4, 10, heat), ...series(9, 10, (d) => 100 * heat(d) * (d >= 7 ? 0.65 : 1))]
    const points = calculateTrendPercentages(rows, [], 'daily')
    for (let i = 0; i < 6; i++) {
      expect(points[i].line_9 as number).toBeCloseTo(points[i].median as number)
      expect(isOutside(points[i], 9)).toBe(false)
    }
    for (let i = 6; i < 10; i++) {
      expect((points[i].line_9 as number) / (points[i].median as number)).toBeCloseTo(0.65)
      expect(isOutside(points[i], 9)).toBe(true)
    }
    // The raw share is kept for the tooltip and the export.
    expect(points[0].line_9_share as number).toBeGreaterThan(points[0].median as number)
  })

  it('missing days do not lift a line above the branch', () => {
    // Line 9 lost its archive for the last 4 of 20 days (Новомиколаївка
    // after 03.11) while the branch kept heating up.
    const rise = (d: number) => 1 + d / 10
    const rows = [...branch(4, 20, rise), ...series(9, 16, (d) => 100 * rise(d))]
    const points = calculateTrendPercentages(rows, [], 'daily')
    const stats = trendLineStats(points, [1, 2, 3, 4, 9])
    for (const lid of [1, 2, 3, 4, 9]) expect(stats.get(lid)!.outside).toBe(0)
    expect(points[0].line_9).toBeCloseTo(points[0].line_1 as number)
    expect(points[19].median).toBeCloseTo(points[19].line_1 as number)
  })

  it('a line with data for under half the range is scaled but stays out of the median', () => {
    const rows = [...branch(4, 20), ...series(9, 5, (d) => (d === 3 ? 300 : 100))]
    const points = calculateTrendPercentages(rows, [], 'daily')
    expect(points[0].line_1).toBeCloseTo(5)
    expect(points[19].line_1).toBeCloseTo(5)
    expect(points[0].line_9).toBeCloseTo(5)
    expect(points[2].median).toBeCloseTo(5)
  })

  it('no corridor with fewer than three lines', () => {
    const points = calculateTrendPercentages(branch(2, 5), [], 'daily')
    expect(points[0].band).toBeUndefined()
  })

  it('the y ceiling ignores a lone spike', () => {
    const points = calculateTrendPercentages(series(1, 60, (d) => (d === 10 ? 50000 : 100)), [], 'daily')
    expect(trendYCeiling(points, [1])).toBeLessThan(10)
  })
})
