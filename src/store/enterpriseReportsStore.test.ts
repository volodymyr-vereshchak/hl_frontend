/**
 * The reports of the enterprise poll screen are the only state in the app that
 * has to survive a reload but must NOT survive the tab, and the only state big
 * enough to hit a storage quota. Both rules are load-bearing, so both are
 * pinned here.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import type { EnterpriseMappingRow, EventReport } from '@/api/enterprise'
import {
  REPORT_STALE_MS,
  isReportStale,
  useEnterpriseReportsStore,
} from './enterpriseReportsStore'

const STORAGE_KEY = 'hlv-enterprise-reports'

function report(untranslated: string[] = []): EventReport {
  return {
    kind: 'accidents',
    groups: [],
    stats: {
      ours: 12,
      candidates: 40,
      matched: 8,
      with_events: 3,
      dropped_rows: 0,
      untranslated,
    },
  }
}

const row = (id: number) => ({ id, branch_id: 1 }) as EnterpriseMappingRow

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  useEnterpriseReportsStore.setState({
    events: {
      accidents: { report: null, at: null, branchId: null, from: '2026-09-01', to: '2026-09-06' },
      interventions: { report: null, at: null, branchId: null, from: '2026-09-01', to: '2026-09-06' },
    },
    unpolled: { rows: null, at: null, branchId: null, from: '', to: '', count: 0 },
  })
})

const store = () => useEnterpriseReportsStore.getState()

describe('the alarms snapshot', () => {
  it('records which branch answered and when', () => {
    const before = Date.now()
    store().setEventReport('accidents', report(), 7)
    const snap = store().events.accidents
    expect(snap.branchId).toBe(7)
    expect(snap.at).toBeGreaterThanOrEqual(before)
  })

  it('keeps interventions apart from accidents', () => {
    // One store, two reports: writing one must not touch the other, or the
    // interventions button would open the alarms it just overwrote.
    store().setEventReport('accidents', report(), 7)
    expect(store().events.interventions.report).toBeNull()
  })

  it('keeps each kind its own range', () => {
    store().setEventRange('accidents', { from: '2026-08-01' })
    expect(store().events.accidents.from).toBe('2026-08-01')
    expect(store().events.interventions.from).toBe('2026-09-01')
  })
})

describe('the check snapshot', () => {
  it('drops the previous result when a new check starts', () => {
    // Otherwise the pane shows the last answer while a new one is being
    // collected, and the progress bar reads as decoration.
    store().setUnpolledRows([row(1)])
    store().startUnpolled({ from: '2026-09-02', to: '2026-09-05', count: 30, branchId: 2 })
    const snap = store().unpolled
    expect(snap.rows).toBeNull()
    expect(snap.at).toBeNull()
    expect(snap.count).toBe(30)
  })

  it('stamps the result, not the start', () => {
    store().startUnpolled({ from: '2026-09-02', to: '2026-09-05', count: 30, branchId: 2 })
    const started = Date.now()
    store().setUnpolledRows([row(1), row(2)])
    expect(store().unpolled.rows).toHaveLength(2)
    expect(store().unpolled.at).toBeGreaterThanOrEqual(started)
  })
})

describe('persistence', () => {
  it('goes to sessionStorage, so a second tab starts clean', () => {
    store().setEventReport('accidents', report(), 7)
    expect(sessionStorage.getItem(STORAGE_KEY)).toContain('accidents')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('refuses to store a report that would eat the quota', () => {
    // ~2.1M characters of untranslated codes: absurd, but the guard exists for
    // the case nobody predicted, and it must fail by not saving rather than by
    // throwing over the screen that is showing the report.
    const huge = report(['x'.repeat(2_100_000)])
    expect(() => store().setEventReport('accidents', huge, 7)).not.toThrow()
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
    // Still on screen: the tab keeps it, the reload does not.
    expect(store().events.accidents.report).toBe(huge)
  })

  it('clears a stored report rather than leaving a smaller older one', () => {
    store().setEventReport('accidents', report(), 7)
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull()
    store().setEventReport('accidents', report(['y'.repeat(2_100_000)]), 7)
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('isReportStale', () => {
  it('is false without a report', () => {
    expect(isReportStale(null)).toBe(false)
  })

  it('turns true at the hour, not before', () => {
    const now = 1_000_000_000
    expect(isReportStale(now - REPORT_STALE_MS + 1000, now)).toBe(false)
    expect(isReportStale(now - REPORT_STALE_MS, now)).toBe(true)
  })
})
