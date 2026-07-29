import { describe, it, expect } from 'vitest'
import {
  addDays,
  commercialDayOf,
  commercialHourlyRange,
  enterpriseDayWindow,
  getContractHour,
} from './commercialDay'

describe('commercialDay', () => {
  it('default contract hour is 7', () => {
    expect(getContractHour()).toBe(7)
  })

  it('addDays does pure UTC calendar math (month/year rollover)', () => {
    expect(addDays('2026-05-30', 1)).toBe('2026-05-31')
    expect(addDays('2026-05-31', 1)).toBe('2026-06-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29') // leap year
  })

  it('commercialHourlyRange spans fromDate 07:00 → (toDate+1) 06:00', () => {
    expect(commercialHourlyRange('2026-05-01', '2026-05-03')).toEqual({
      from: '2026-05-01T07:00:00',
      to: '2026-05-04T06:00:00',
    })
  })

  it('commercialDayOf buckets pre-07:00 hours into the previous day', () => {
    expect(commercialDayOf('2026-05-30', 5)).toBe('2026-05-29')
    expect(commercialDayOf('2026-05-30', 6)).toBe('2026-05-29')
    expect(commercialDayOf('2026-05-30', 7)).toBe('2026-05-30')
    expect(commercialDayOf('2026-05-30', 23)).toBe('2026-05-30')
  })

  describe('enterpriseDayWindow', () => {
    it('keeps calendar days for the daily archive', () => {
      expect(enterpriseDayWindow('2026-07-20', '2026-07-25', 'daily')).toEqual({
        from: '2026-07-20',
        to: '2026-07-25',
      })
    })

    it('strips a time part the daily endpoint cannot parse', () => {
      expect(enterpriseDayWindow('2026-07-20 07:00:00', '2026-07-21 06:00:00', 'daily')).toEqual({
        from: '2026-07-20',
        to: '2026-07-21',
      })
    })

    // The bug this exists for: hours 00:00–06:59 belong to the previous
    // commercial day, so asking for 2026-07-20 skipped every one of them.
    it('backs an hourly range that starts before the contract hour onto the previous day', () => {
      expect(enterpriseDayWindow('2026-07-20 00:00:00', '2026-07-20 23:00:00', 'hourly')).toEqual({
        from: '2026-07-19',
        to: '2026-07-20',
      })
    })

    it('leaves a range already aligned to the contract hour alone', () => {
      expect(enterpriseDayWindow('2026-07-20 07:00:00', '2026-07-21 06:00:00', 'hourly')).toEqual({
        from: '2026-07-20',
        to: '2026-07-20',
      })
    })

    it('falls back to the calendar day when no time was picked', () => {
      expect(enterpriseDayWindow('2026-07-20', '2026-07-25', 'hourly')).toEqual({
        from: '2026-07-20',
        to: '2026-07-25',
      })
    })
  })
})
