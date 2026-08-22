import { describe, it, expect } from 'vitest'
import {
  breakdownHeader,
  breakdownInsertAt,
  breakdownRow,
  buildEnterpriseBreakdown,
  enterpriseRecordTotal,
} from './enterpriseVolumes'
import type { EnterpriseDeviceVolume, EnterpriseRecord } from '@/api/enterprise'

const device = (over: Partial<EnterpriseDeviceVolume> = {}): EnterpriseDeviceVolume => ({
  serNum: 111,
  mfDev: 16,
  typeDev: 1,
  chNum: 1,
  enterprise_name: 'ТОВ Завод',
  volume: 100,
  ...over,
})

const record = (period: string, devices: EnterpriseDeviceVolume[]): EnterpriseRecord => ({
  line_id: 1,
  period,
  devices,
})

/**
 * The Excel export's per-enterprise columns. These pin the two things the
 * rewrite got wrong: where the name comes from, and that "not polled" is not
 * the same number as "polled, consumed nothing".
 */
describe('buildEnterpriseBreakdown', () => {
  it('names columns after enterprise_name, not any record-level field', () => {
    const { names, byPeriod } = buildEnterpriseBreakdown(
      [record('2026-07-01', [device({ enterprise_name: 'ТОВ Хліб' })])],
      'daily',
    )
    expect(names).toEqual(['ТОВ Хліб'])
    expect(byPeriod.get('2026-07-01')).toEqual({ 'ТОВ Хліб': 100 })
  })

  it('sums several devices of one enterprise into one column', () => {
    const { names, byPeriod } = buildEnterpriseBreakdown(
      [
        record('2026-07-01', [
          device({ serNum: 1, volume: 100 }),
          device({ serNum: 2, volume: 25 }),
        ]),
      ],
      'daily',
    )
    expect(names).toEqual(['ТОВ Завод'])
    expect(byPeriod.get('2026-07-01')).toEqual({ 'ТОВ Завод': 125 })
  })

  it('keeps an unpolled device null and a polled zero at 0', () => {
    const { byPeriod } = buildEnterpriseBreakdown(
      [
        record('2026-07-01', [
          device({ enterprise_name: 'Не опитано', volume: null }),
          device({ enterprise_name: 'Нуль', volume: 0 }),
        ]),
      ],
      'daily',
    )
    expect(byPeriod.get('2026-07-01')).toEqual({ 'Не опитано': null, Нуль: 0 })
  })

  it('a partial poll does not wipe the value that did come back', () => {
    const { byPeriod } = buildEnterpriseBreakdown(
      [
        record('2026-07-01', [
          device({ serNum: 1, volume: 40 }),
          device({ serNum: 2, volume: null }),
        ]),
      ],
      'daily',
    )
    expect(byPeriod.get('2026-07-01')).toEqual({ 'ТОВ Завод': 40 })
  })

  it('falls back to the serial number when the enterprise has no name', () => {
    const { names } = buildEnterpriseBreakdown(
      [record('2026-07-01', [device({ enterprise_name: '  ', serNum: 90210 })])],
      'daily',
    )
    expect(names).toEqual(['S/N 90210'])
  })

  it('sorts the column names', () => {
    const { names } = buildEnterpriseBreakdown(
      [
        record('2026-07-01', [
          device({ enterprise_name: 'Ярмарок' }),
          device({ enterprise_name: 'Авіа' }),
          device({ enterprise_name: 'Мрія' }),
        ]),
      ],
      'daily',
    )
    expect(names).toEqual(['Авіа', 'Мрія', 'Ярмарок'])
  })

  it('keys hourly periods to the hour and daily periods to the day', () => {
    const hourly = buildEnterpriseBreakdown(
      [
        record('2026-07-01T08:00:00', [device({ volume: 5 })]),
        record('2026-07-01T09:00:00', [device({ volume: 7 })]),
      ],
      'hourly',
    )
    expect([...hourly.byPeriod.keys()]).toEqual(['2026-07-01T08', '2026-07-01T09'])

    // The same two records read as daily collapse onto one day.
    const daily = buildEnterpriseBreakdown(
      [
        record('2026-07-01T08:00:00', [device({ volume: 5 })]),
        record('2026-07-01T09:00:00', [device({ volume: 7 })]),
      ],
      'daily',
    )
    expect(daily.byPeriod.get('2026-07-01')).toEqual({ 'ТОВ Завод': 12 })
  })

  it('survives records with no devices at all', () => {
    const { names, byPeriod } = buildEnterpriseBreakdown([record('2026-07-01', [])], 'daily')
    expect(names).toEqual([])
    expect(byPeriod.get('2026-07-01')).toEqual({})
  })
})

/**
 * Column order of the breakdown export. The point of these is comparability
 * between lines: NET and the total must sit at the same spreadsheet column
 * whatever enterprises a particular line happens to have, and whatever else
 * the line reports — a DPD line has pressure and temperature where a physical
 * one also has working volume.
 */
describe('breakdown column order', () => {
  const lineCols = ['Період', "Об'єм"]

  it('puts NET and the total right after the line columns', () => {
    expect(breakdownHeader(lineCols, ['Авіа', 'Мрія'])).toEqual([
      'Період',
      "Об'єм",
      'NET (лінія − підприємства)',
      'Разом підприємства',
      'Авіа',
      'Мрія',
    ])
  })

  it('keeps NET and the total at the same index for lines with different enterprises', () => {
    const a = breakdownHeader(lineCols, ['Авіа'])
    const b = breakdownHeader(lineCols, ['Мрія', 'Хліб', 'Ярмарок'])
    expect(a.indexOf('NET (лінія − підприємства)')).toBe(b.indexOf('NET (лінія − підприємства)'))
    expect(a.indexOf('Разом підприємства')).toBe(b.indexOf('Разом підприємства'))
  })

  it('lays the row out in the same order as the header', () => {
    const row = breakdownRow(['2026-07-01', 1000], 1000, ['Авіа', 'Мрія'], {
      Авіа: 100,
      Мрія: 25,
    })
    expect(row).toEqual(['2026-07-01', 1000, 875, 125, 100, 25])
  })

  it('leaves an unpolled enterprise blank and out of both the total and NET', () => {
    const row = breakdownRow(['2026-07-01', 1000], 1000, ['Авіа', 'Мрія'], {
      Авіа: 100,
      Мрія: null,
    })
    expect(row).toEqual(['2026-07-01', 1000, 900, 100, 100, ''])
  })

  it('reports the whole line volume as NET when the period has no enterprise data', () => {
    expect(breakdownRow(['2026-07-01', 1000], 1000, ['Авіа'], undefined)).toEqual([
      '2026-07-01',
      1000,
      1000,
      0,
      '',
    ])
  })

  it('puts NET and the total right after the volume, ahead of the other line columns', () => {
    const wide = ['Період', "Об'єм", 'Тиск', 'Температура']
    expect(breakdownHeader(wide, ['Авіа'], 2)).toEqual([
      'Період',
      "Об'єм",
      'NET (лінія − підприємства)',
      'Разом підприємства',
      'Тиск',
      'Температура',
      'Авіа',
    ])
  })

  it('splits the row at the same place as the header', () => {
    const row = breakdownRow(['2026-07-01', 1000, 5.5, 12], 1000, ['Авіа'], { Авіа: 100 }, 2)
    expect(row).toEqual(['2026-07-01', 1000, 900, 100, 5.5, 12, 100])
  })

  it('finds the split from the column keys, whatever the line reports', () => {
    expect(breakdownInsertAt(['period', 'volume'])).toBe(2)
    expect(breakdownInsertAt(['period', 'volume', 'pressure', 'temperature'])).toBe(2)
    // No volume column: nothing to sit next to, so they go after the line block.
    expect(breakdownInsertAt(['period', 'sys_name'])).toBe(2)
  })
})

describe('enterpriseRecordTotal', () => {
  it('prefers the API total', () => {
    expect(
      enterpriseRecordTotal({ period: '2026-07-01', total_volume: 42, devices: [device()] }),
    ).toBe(42)
  })

  it('sums the devices when the total is absent', () => {
    expect(
      enterpriseRecordTotal(
        record('2026-07-01', [device({ volume: 10 }), device({ volume: 32 })]),
      ),
    ).toBe(42)
  })

  it('treats a zero total as a real total, not as missing', () => {
    expect(
      enterpriseRecordTotal({ period: '2026-07-01', total_volume: 0, devices: [device()] }),
    ).toBe(0)
  })
})
