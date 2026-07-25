import { describe, it, expect } from 'vitest'
import {
  buildNetByDayLineHour,
  nightRowsFromMap,
  buildHourlySheets,
  SHEET_HOURS,
} from './nightConsumption'
import type { ArchiveRow } from '@/api/entities'

const row = (period: string, line_id: number, volume: number) =>
  ({ period, line_id, volume }) as unknown as ArchiveRow

describe('buildNetByDayLineHour', () => {
  it('attributes 00:00–06:00 to the PREVIOUS commercial day', () => {
    const map = buildNetByDayLineHour([
      row('2026-04-02T02:00:00', 1, 100),
      row('2026-04-01T23:00:00', 1, 50),
    ])
    // 02:00 of 02.04 belongs to commercial day 01.04; 23:00 stays on its own day.
    expect(map['2026-04-01'][1][2]).toBe(100)
    expect(map['2026-04-01'][1][23]).toBe(50)
    expect(map['2026-04-02']).toBeUndefined()
  })

  it('parses the period as local wall-clock, not UTC', () => {
    // Under UTC parsing this 00:00 record would shift and land on another day.
    const map = buildNetByDayLineHour([row('2026-04-02T00:00:00', 7, 10)])
    expect(map['2026-04-01'][7][0]).toBe(10)
  })

  it('subtracts industry offtake and clamps at zero', () => {
    const ent = [
      { line_id: 1, period: '2026-04-02T02:00:00', total_volume: 30 },
      { line_id: 1, period: '2026-04-02T03:00:00', devices: [{ volume: 600 }, { volume: 399 }] },
    ] as never
    const map = buildNetByDayLineHour(
      [row('2026-04-02T02:00:00', 1, 100), row('2026-04-02T03:00:00', 1, 100)],
      ent,
    )
    expect(map['2026-04-01'][1][2]).toBe(70)
    expect(map['2026-04-01'][1][3]).toBe(0)
  })

  it('ignores hours outside the night window and rows without a line', () => {
    const map = buildNetByDayLineHour([
      row('2026-04-01T12:00:00', 1, 500),
      row('2026-04-02T02:00:00', undefined as unknown as number, 500),
    ])
    expect(map).toEqual({})
  })
})

describe('nightRowsFromMap', () => {
  const map = buildNetByDayLineHour([
    row('2026-04-02T00:00:00', 1, 442.5),
    row('2026-04-02T01:00:00', 1, 69.5),
    row('2026-04-02T02:00:00', 1, 67.17),
    row('2026-04-02T03:00:00', 1, 129.34),
    row('2026-04-02T04:00:00', 1, 1170.97),
    row('2026-04-02T05:00:00', 1, 1359.99),
  ])

  it('takes the minimum over 00–05 in "min" mode', () => {
    // Matches the live API check for line 379 on commercial day 01.04.2026.
    expect(nightRowsFromMap(map, [1], 'min')[0].line_1).toBeCloseTo(67.17, 2)
  })

  it('averages hours 02 and 03 in "avg23" mode', () => {
    expect(nightRowsFromMap(map, [1], 'avg23')[0].line_1).toBeCloseTo(98.255, 3)
  })

  it('returns null for a line with no night data, and sorts by day', () => {
    const two = buildNetByDayLineHour([
      row('2026-04-03T02:00:00', 1, 5),
      row('2026-04-02T02:00:00', 1, 9),
    ])
    const rows = nightRowsFromMap(two, [1, 42], 'min')
    expect(rows.map((r) => r.date)).toEqual(['2026-04-01', '2026-04-02'])
    expect(rows[0].line_42).toBeNull()
  })

  it('ignores missing hours instead of treating them as zero', () => {
    const sparse = buildNetByDayLineHour([
      row('2026-04-02T02:00:00', 1, 80),
      row('2026-04-02T04:00:00', 1, 120),
    ])
    expect(nightRowsFromMap(sparse, [1], 'min')[0].line_1).toBe(80)
  })
})

describe('buildHourlySheets', () => {
  it('emits one row per requested day with every sheet hour, null when absent', () => {
    const map = buildNetByDayLineHour([
      row('2026-04-01T22:00:00', 1, 700),
      row('2026-04-02T02:00:00', 1, 67),
    ])
    const sheets = buildHourlySheets(map, ['2026-04-01', '2026-04-09'], [1])
    expect(sheets[1]).toHaveLength(2)
    expect(sheets[1][0][22]).toBe(700)
    expect(sheets[1][0][2]).toBe(67)
    expect(sheets[1][0][21]).toBeNull()
    // A day with no data still produces a full, empty row.
    expect(SHEET_HOURS.every((h) => sheets[1][1][h] === null)).toBe(true)
  })
})
