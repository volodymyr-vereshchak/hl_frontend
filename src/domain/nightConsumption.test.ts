import { describe, it, expect } from 'vitest'
import {
  buildNetByDayLineHour,
  nightHourlyRange,
  nightRowsFromMap,
  buildHourlySheets,
  SHEET_HOURS,
} from './nightConsumption'
import type { HourlyCompact } from '@/api/entities'

/**
 * Build the compact payload the endpoint sends: stamps listed once, rows
 * pointing at them by index. Assembled the way the server assembles it, so the
 * tests exercise the real indirection rather than a convenient stand-in.
 */
const payload = (...entries: [string, number, number][]): HourlyCompact => {
  const stamps: string[] = []
  const index = new Map<string, number>()
  const rows = entries.map(([period, lineId, volume]) => {
    const stamp = period.slice(0, 13)
    let at = index.get(stamp)
    if (at === undefined) {
      at = stamps.length
      index.set(stamp, at)
      stamps.push(stamp)
    }
    return [lineId, at, volume] as [number, number, number]
  })
  return { stamps, rows }
}

describe('buildNetByDayLineHour', () => {
  it('attributes 00:00–06:00 to the PREVIOUS commercial day', () => {
    const map = buildNetByDayLineHour(
      payload(['2026-04-02T02:00:00', 1, 100], ['2026-04-01T23:00:00', 1, 50]),
    )
    // 02:00 of 02.04 belongs to commercial day 01.04; 23:00 stays on its own day.
    expect(map['2026-04-01'][1][2]).toBe(100)
    expect(map['2026-04-01'][1][23]).toBe(50)
    expect(map['2026-04-02']).toBeUndefined()
  })

  it('reads the stamp as wall-clock, not as an instant', () => {
    // Parsed as UTC and rendered locally, this 00:00 would shift into another
    // commercial day for every viewer outside the server's timezone.
    const map = buildNetByDayLineHour(payload(['2026-04-02T00:00:00', 7, 10]))
    expect(map['2026-04-01'][7][0]).toBe(10)
  })

  it('subtracts industry offtake and clamps at zero', () => {
    const ent = [
      { line_id: 1, period: '2026-04-02T02:00:00', total_volume: 30 },
      { line_id: 1, period: '2026-04-02T03:00:00', devices: [{ volume: 600 }, { volume: 399 }] },
    ] as never
    const map = buildNetByDayLineHour(
      payload(['2026-04-02T02:00:00', 1, 100], ['2026-04-02T03:00:00', 1, 100]),
      ent,
    )
    expect(map['2026-04-01'][1][2]).toBe(70)
    expect(map['2026-04-01'][1][3]).toBe(0)
  })

  it('ignores hours outside the night window and rows without a line', () => {
    // The endpoint filters the hours too, but a caller that asks for the whole
    // day must still get only the night out of this.
    const map = buildNetByDayLineHour(
      payload(
        ['2026-04-01T12:00:00', 1, 500],
        ['2026-04-02T02:00:00', undefined as unknown as number, 500],
      ),
    )
    expect(map).toEqual({})
  })

  it('survives an empty answer', () => {
    expect(buildNetByDayLineHour({ stamps: [], rows: [] })).toEqual({})
  })
})

describe('nightRowsFromMap', () => {
  const map = buildNetByDayLineHour(
    payload(
      ['2026-04-02T00:00:00', 1, 442.5],
      ['2026-04-02T01:00:00', 1, 69.5],
      ['2026-04-02T02:00:00', 1, 67.17],
      ['2026-04-02T03:00:00', 1, 129.34],
      ['2026-04-02T04:00:00', 1, 1170.97],
      ['2026-04-02T05:00:00', 1, 1359.99],
    ),
  )

  it('takes the minimum over 00–05 in "min" mode', () => {
    // Matches the live API check for line 379 on commercial day 01.04.2026.
    expect(nightRowsFromMap(map, [1], 'min')[0].line_1).toBeCloseTo(67.17, 2)
  })

  it('averages hours 02 and 03 in "avg23" mode', () => {
    expect(nightRowsFromMap(map, [1], 'avg23')[0].line_1).toBeCloseTo(98.255, 3)
  })

  it('returns null for a line with no night data, and sorts by day', () => {
    const two = buildNetByDayLineHour(
      payload(['2026-04-03T02:00:00', 1, 5], ['2026-04-02T02:00:00', 1, 9]),
    )
    const rows = nightRowsFromMap(two, [1, 42], 'min')
    expect(rows.map((r) => r.date)).toEqual(['2026-04-01', '2026-04-02'])
    expect(rows[0].line_42).toBeNull()
  })

  it('ignores missing hours instead of treating them as zero', () => {
    const sparse = buildNetByDayLineHour(
      payload(['2026-04-02T02:00:00', 1, 80], ['2026-04-02T04:00:00', 1, 120]),
    )
    expect(nightRowsFromMap(sparse, [1], 'min')[0].line_1).toBe(80)
  })
})

describe('buildHourlySheets', () => {
  it('emits one row per requested day with every sheet hour, null when absent', () => {
    const map = buildNetByDayLineHour(
      payload(['2026-04-01T22:00:00', 1, 700], ['2026-04-02T02:00:00', 1, 67]),
    )
    const sheets = buildHourlySheets(map, ['2026-04-01', '2026-04-09'], [1])
    expect(sheets[1]).toHaveLength(2)
    expect(sheets[1][0][22]).toBe(700)
    expect(sheets[1][0][2]).toBe(67)
    expect(sheets[1][0][21]).toBeNull()
    // A day with no data still produces a full, empty row.
    expect(SHEET_HOURS.every((h) => sheets[1][1][h] === null)).toBe(true)
  })
})

describe('the calendar (astronomical) day', () => {
  // The same night, told twice: the gas day files it under the evening it
  // started on, the calendar day under the morning it ends on.
  const night = payload(
    ['2026-04-01T22:00:00', 1, 700],
    ['2026-04-02T00:00:00', 1, 300],
    ['2026-04-02T02:00:00', 1, 67],
    ['2026-04-02T03:00:00', 1, 129],
    ['2026-04-02T04:00:00', 1, 90],
  )

  it('files the small hours under their own date, not the day before', () => {
    const calendar = buildNetByDayLineHour(night, [], { dayMode: 'calendar' })
    expect(calendar['2026-04-02'][1][2]).toBe(67)
    expect(calendar['2026-04-01']?.[1]?.[2]).toBeUndefined()
    // The gas day says the opposite about the very same hour.
    expect(buildNetByDayLineHour(night)['2026-04-01'][1][2]).toBe(67)
  })

  it('pulls the evening hours forward from the previous date', () => {
    const calendar = buildNetByDayLineHour(night, [], { dayMode: 'calendar' })
    expect(calendar['2026-04-02'][1][22]).toBe(700)
    expect(calendar['2026-04-01']).toBeUndefined()
  })

  it('gives the export sheet one continuous night per row', () => {
    const calendar = buildNetByDayLineHour(night, [], { dayMode: 'calendar' })
    const row = buildHourlySheets(calendar, ['2026-04-02'], [1])[1][0]
    expect(row[22]).toBe(700)
    expect(row[2]).toBe(67)
    expect(row[21]).toBeNull()
  })

  it('summarises the hours of its own date', () => {
    const calendar = buildNetByDayLineHour(night, [], { dayMode: 'calendar' })
    expect(nightRowsFromMap(calendar, [1], 'min')[0]).toEqual({
      date: '2026-04-02',
      line_1: 67,
    })
    expect(nightRowsFromMap(calendar, [1], 'avg23')[0].line_1).toBe(98)
  })
})

describe('clamping to the report range', () => {
  // The window is one day wider than the report on each side, so both modes can
  // be served from one fetch; the days that fall outside must not become rows.
  const wide = payload(
    ['2026-03-31T22:00:00', 1, 10],
    ['2026-04-01T02:00:00', 1, 20],
    ['2026-04-02T02:00:00', 1, 30],
  )

  it('drops the day before the range in gas mode', () => {
    const map = buildNetByDayLineHour(wide, [], { from: '2026-04-01', to: '2026-04-01' })
    // 22:00 of 31.03 and 02:00 of 01.04 both belong to gas day 31.03.
    expect(Object.keys(map)).toEqual(['2026-04-01'])
    expect(map['2026-04-01'][1][2]).toBe(30)
  })

  it('ignores a time part on the bounds', () => {
    // The picker hands out bare days, but every other control in the app hands
    // out '2026-04-01 00:00:00' — which sorts AFTER '2026-04-01' and would drop
    // the report's own first day.
    const map = buildNetByDayLineHour(wide, [], {
      dayMode: 'calendar',
      from: '2026-04-01 00:00:00',
      to: '2026-04-01 00:00:00',
    })
    expect(Object.keys(map)).toEqual(['2026-04-01'])
  })

  it('drops the day after the range in calendar mode', () => {
    const map = buildNetByDayLineHour(wide, [], {
      dayMode: 'calendar',
      from: '2026-04-01',
      to: '2026-04-01',
    })
    // 22:00 of 31.03 is the evening of night 01.04; 02:00 of 02.04 is out.
    expect(Object.keys(map)).toEqual(['2026-04-01'])
    expect(map['2026-04-01'][1][22]).toBe(10)
    expect(map['2026-04-01'][1][2]).toBe(20)
  })
})

describe('nightHourlyRange', () => {
  it('reaches one day back and one day forward, so both modes fit', () => {
    expect(nightHourlyRange('2026-04-01', '2026-04-30')).toEqual({
      from: '2026-03-31T21:00:00',
      to: '2026-05-01T06:00:00',
    })
  })
})
