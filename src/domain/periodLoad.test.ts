import { describe, it, expect } from 'vitest'
import { isOverlayHeavy, periodDays } from './periodLoad'

const range = (fromDate: string, toDate: string) => ({ fromDate, toDate })

describe('periodDays', () => {
  it('counts both ends', () => {
    expect(periodDays(range('2026-01-01', '2026-01-01'))).toBe(1)
    expect(periodDays(range('2026-01-01', '2026-01-31'))).toBe(31)
  })

  it('ignores the time part the hourly pickers add', () => {
    expect(periodDays(range('2026-01-01 07:00:00', '2026-01-31 06:00:00'))).toBe(31)
  })

  it('crosses a DST boundary without losing a day', () => {
    // Europe/Kyiv moves the clock on the last Sunday of March.
    expect(periodDays(range('2026-03-01', '2026-03-31'))).toBe(31)
  })
})

describe('isOverlayHeavy', () => {
  it('starts where the DPD archive window ends', () => {
    // Up to a month the backend answers from its own cache.
    expect(isOverlayHeavy(range('2026-01-01', '2026-01-31'))).toBe(false)
    // Past that it has to backfill from the DPD API, enterprise by enterprise.
    expect(isOverlayHeavy(range('2026-01-01', '2026-02-01'))).toBe(true)
    expect(isOverlayHeavy(range('2026-01-01', '2026-12-31'))).toBe(true)
  })
})
