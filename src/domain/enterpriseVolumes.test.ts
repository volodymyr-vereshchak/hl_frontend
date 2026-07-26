import { describe, it, expect } from 'vitest'
import { buildEnterpriseBreakdown, enterpriseRecordTotal } from './enterpriseVolumes'
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
