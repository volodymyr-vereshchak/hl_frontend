import { describe, it, expect } from 'vitest'
import { addDays, commercialDayOf, commercialHourlyRange, getContractHour } from './commercialDay'

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
})
