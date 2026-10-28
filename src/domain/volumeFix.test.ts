import { describe, expect, it } from 'vitest'
import type { EnterpriseRecord } from '@/api/enterprise'
import { buildEnterpriseFixByPeriod, cellFixMark, enterpriseFixHint } from './volumeFix'

describe('cellFixMark', () => {
  it('marks a DPD line volume by its own fix', () => {
    const summed = cellFixMark(
      'volume',
      { period: '2026-03-10', volume: 24, volume_fix: 'hours' },
      'daily',
    )
    expect(summed?.tone).toBe('hours')
    expect(summed?.hint).toMatch(/сума годинних 07:00–07:00/)

    const unknown = cellFixMark(
      'volume',
      { period: '2026-03-10', volume: 0, volume_fix: 'zeroed' },
      'daily',
    )
    expect(unknown?.tone).toBe('zeroed')
    expect(unknown?.hint).toMatch(/невідомий, показано 0/)
  })

  it('leaves ordinary cells alone', () => {
    expect(cellFixMark('volume', { period: '2026-03-10', volume: 5 }, 'daily')).toBeNull()
    expect(
      cellFixMark('pressure', { period: '2026-03-10', volume_fix: 'zeroed' }, 'daily'),
    ).toBeNull()
  })

  it('marks the enterprise columns, red when any volume is unknown', () => {
    const row = { period: '2026-03-10', enterprise_fix_hours: 2, enterprise_fix_zeroed: 1 }
    expect(cellFixMark('totalEnterprise', row, 'daily')?.tone).toBe('zeroed')
    expect(cellFixMark('netVolume', row, 'daily')?.tone).toBe('zeroed')
    const rebuilt = { period: '2026-03-10', enterprise_fix_hours: 1, enterprise_fix_zeroed: 0 }
    expect(cellFixMark('totalEnterprise', rebuilt, 'daily')?.tone).toBe('hours')
  })
})

describe('enterpriseFixHint', () => {
  it('counts the devices of each kind', () => {
    expect(enterpriseFixHint({ hours: 2, zeroed: 1 })).toBe(
      "Суматор скинуто у 3 приладів підприємств: об'єм у 2 — сума годинних, у 1 — невідомий, враховано 0.",
    )
    expect(enterpriseFixHint({ hours: 0, zeroed: 0 })).toBeNull()
  })
})

describe('buildEnterpriseFixByPeriod', () => {
  it('adds up the lines of one period and skips the clean ones', () => {
    const records: EnterpriseRecord[] = [
      { line_id: 1, period: '2026-03-10', volume_fix_hours: 1, volume_fix_zeroed: 0 },
      { line_id: 2, period: '2026-03-10', volume_fix_hours: 0, volume_fix_zeroed: 2 },
      { line_id: 1, period: '2026-03-11', volume_fix_hours: 0, volume_fix_zeroed: 0 },
    ]
    expect(buildEnterpriseFixByPeriod(records, 'daily')).toEqual({
      '2026-03-10': { hours: 1, zeroed: 2 },
    })
  })
})
