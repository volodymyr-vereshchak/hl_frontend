import { describe, it, expect } from 'vitest'
import { nightRowsFromMap, type NetMap } from './nightConsumption'
import { calculateTrendPercentages } from './grsTrends'
import type { ArchiveRow } from '@/api/entities'

/**
 * Every table that shows periods must show them in order, whatever order the
 * endpoint happened to return. These pin that invariant for the pure builders;
 * the archive fetch sorts in useArchiveData (see `byPeriod`).
 */
describe('period ordering', () => {
  it('night rows come out chronological even from a shuffled map', () => {
    const map: NetMap = {
      '2026-05-03': { 1: { 0: 5, 1: 6, 2: 7, 3: 8, 4: 9, 5: 10 } },
      '2026-05-01': { 1: { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 } },
      '2026-05-02': { 1: { 0: 3, 1: 4, 2: 5, 3: 6, 4: 7, 5: 8 } },
    }
    const rows = nightRowsFromMap(map, [1], 'min')
    expect(rows.map((r) => r.date)).toEqual(['2026-05-01', '2026-05-02', '2026-05-03'])
  })

  it('trend points come out chronological even from shuffled rows', () => {
    const rows: ArchiveRow[] = [
      { line_id: 1, period: '2026-05-03', volume: 30 },
      { line_id: 1, period: '2026-05-01', volume: 10 },
      { line_id: 1, period: '2026-05-02', volume: 20 },
    ]
    const points = calculateTrendPercentages(rows, [], 'daily')
    expect(points.map((p) => p.period)).toEqual(['2026-05-01', '2026-05-02', '2026-05-03'])
  })

  it('hourly trend points sort by hour, not by string luck', () => {
    const rows: ArchiveRow[] = [
      { line_id: 1, period: '2026-05-01T21:00:00', volume: 3 },
      { line_id: 1, period: '2026-05-01T09:00:00', volume: 1 },
      { line_id: 1, period: '2026-05-02T07:00:00', volume: 2 },
    ]
    const points = calculateTrendPercentages(rows, [], 'hourly')
    expect(points.map((p) => p.period)).toEqual([
      '2026-05-01T09',
      '2026-05-01T21',
      '2026-05-02T07',
    ])
  })
})
