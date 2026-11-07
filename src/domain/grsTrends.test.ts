import { describe, it, expect } from 'vitest'
import { calculateTrends, isOutside, median, trendYCeiling } from './grsTrends'
import type { ArchiveRow } from '@/api/entities'

const day = (d: number) => `2026-05-${String(d).padStart(2, '0')}`

/** `n` daily rows of `volume` for a line, with optional overrides by day. */
function series(lid: number, n: number, volume: number, overrides: Record<number, number> = {}): ArchiveRow[] {
  return Array.from({ length: n }, (_, i) => ({
    line_id: lid,
    period: day(i + 1),
    volume: overrides[i + 1] ?? volume,
  }))
}

describe('grs trends', () => {
  it('median handles odd, even and empty input', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNaN()
  })

  it('one spike day does not drag the ordinary days of the line down', () => {
    const { points } = calculateTrends(series(1, 30, 100, { 15: 1000 }), [], 'daily')
    expect(points[0].line_1).toBe(100)
    expect(points[14].line_1).toBe(1000)
    expect(points[29].line_1).toBe(100)
  })

  it('gaps are skipped, not counted as zero days', () => {
    const rows = series(1, 10, 100)
    rows.push({ line_id: 1, period: day(11) }) // no volume
    const { points } = calculateTrends(rows, [], 'daily')
    expect(points.find((p) => p.period === day(11))).toBeUndefined()
    expect(points[0].line_1).toBe(100)
  })

  it('a line with a zero median is excluded instead of dividing by zero', () => {
    const rows = [...series(1, 10, 0, { 3: 50 }), ...series(2, 10, 100)]
    const { stats, excluded } = calculateTrends(rows, [], 'daily')
    expect(excluded).toEqual([1])
    expect(stats.has(2)).toBe(true)
  })

  it('flags only the line that departs from the branch', () => {
    const rows = [
      ...series(1, 10, 100),
      ...series(2, 10, 200),
      ...series(3, 10, 50),
      ...series(4, 10, 80, { 5: 400 }),
    ]
    const { points, stats } = calculateTrends(rows, [], 'daily')
    expect(stats.get(4)!.outliers).toBe(1)
    expect(isOutside(points[4], 4)).toBe(true)
    for (const lid of [1, 2, 3]) expect(stats.get(lid)!.outliers).toBe(0)
  })

  it('a branch-wide rise (weather) is not an anomaly', () => {
    const cold = { 5: 2 } // factor
    const rows = [1, 2, 3, 4, 5].flatMap((lid) =>
      series(lid, 10, lid * 100, { 5: lid * 100 * cold[5] }),
    )
    const { points, stats } = calculateTrends(rows, [], 'daily')
    expect(points[4].median).toBe(200)
    for (const s of stats.values()) expect(s.outliers).toBe(0)
  })

  it('a fixed band uses ± percent of the median', () => {
    const rows = [...series(1, 3, 100), ...series(2, 3, 100), ...series(3, 3, 100, { 2: 115 })]
    const tight = calculateTrends(rows, [], 'daily', 10)
    expect(tight.points[1].band).toEqual([90, 110])
    expect(tight.stats.get(3)!.outliers).toBe(1)
    expect(calculateTrends(rows, [], 'daily', 20).stats.get(3)!.outliers).toBe(0)
  })

  it('hourly data is normalised per hour of day', () => {
    // Night 10, day 100 — every hour is ordinary for its own time of day.
    const rows: ArchiveRow[] = []
    for (let d = 1; d <= 3; d++) {
      rows.push({ line_id: 1, period: `${day(d)}T03:00:00`, volume: 10 })
      rows.push({ line_id: 1, period: `${day(d)}T12:00:00`, volume: 100 })
    }
    const { points } = calculateTrends(rows, [], 'hourly')
    for (const p of points) expect(p.line_1).toBe(100)
  })

  it('no band with fewer than three lines', () => {
    const { points } = calculateTrends([...series(1, 3, 100), ...series(2, 3, 100)], [], 'daily')
    expect(points[0].band).toBeUndefined()
  })

  it('the y ceiling ignores a lone spike', () => {
    const rows = [1, 2, 3, 4].flatMap((lid) => series(lid, 30, 100, lid === 4 ? { 10: 5000 } : {}))
    const { points } = calculateTrends(rows, [], 'daily')
    expect(trendYCeiling(points, [1, 2, 3, 4])).toBeLessThan(300)
  })
})
