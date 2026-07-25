import { describe, it, expect } from 'vitest'
import {
  isAccidentStart,
  isAccidentEnd,
  isStandaloneCode,
  pairAccidents,
  groupAccidentsByType,
  summarizeOccurrencesByLine,
  type SysRecord,
} from './accidentsCalculator'

// Accidents are bound to the commercial day: 07:00 → next day 07:00.
const CONTRACT = { fromDate: '2026-04-01T07:00:00', toDate: '2026-04-03T07:00:00' }
const localHour = (iso: string) => new Date(iso).getHours()

describe('event code classification', () => {
  it('splits start / end / standalone ranges', () => {
    expect(isAccidentStart(130)).toBe(true)
    expect(isAccidentEnd(2)).toBe(true)
    expect(isStandaloneCode(80)).toBe(true)
    expect(isStandaloneCode(210)).toBe(true)
    expect(isAccidentStart(2)).toBe(false)
  })
})

describe('pairAccidents', () => {
  it('pairs a start with its end (offset 128)', () => {
    const rows: SysRecord[] = [
      { line_id: 1, period: '2026-04-01T10:00:00', sys_type_id: 130, sys_name: 'dP > max', volume: 5 },
      { line_id: 1, period: '2026-04-01T12:00:00', sys_type_id: 2, sys_name: 'dP норма', volume: 9 },
    ]
    const [acc] = pairAccidents(rows, CONTRACT)
    expect(acc.type).toBe('full')
    expect(acc.sys_type_id).toBe(130)
    expect(acc.startTime).toBe('2026-04-01T10:00:00')
    expect(acc.endTime).toBe('2026-04-01T12:00:00')
  })

  it('anchors a missing START to the contract hour (07:00), not midnight', () => {
    // Only the END record is inside the period — the accident began earlier.
    const rows: SysRecord[] = [
      { line_id: 1, period: '2026-04-02T09:30:00', sys_type_id: 2, sys_name: 'dP норма', volume: 4 },
    ]
    const [acc] = pairAccidents(rows, CONTRACT)
    expect(acc.type).toBe('end_only')
    expect(localHour(acc.startTime)).toBe(7)
  })

  it('anchors a missing END to the contract hour of the period end', () => {
    const rows: SysRecord[] = [
      { line_id: 1, period: '2026-04-02T09:30:00', sys_type_id: 130, sys_name: 'dP > max', volume: 4 },
    ]
    const [acc] = pairAccidents(rows, CONTRACT)
    expect(acc.type).toBe('start_only')
    expect(localHour(acc.endTime)).toBe(7)
  })

  it('keeps standalone notifications without a duration', () => {
    const rows: SysRecord[] = [
      { line_id: 1, period: '2026-04-01T08:00:00', sys_type_id: 80, sys_name: 'Живлення', volume: 0 },
    ]
    const groups = groupAccidentsByType(pairAccidents(rows, CONTRACT))
    expect(groups[0].isStandalone).toBe(true)
    expect(groups[0].totalDurationFormatted).toBe('—')
  })
})

describe('summarizeOccurrencesByLine', () => {
  it('rolls occurrences up per line with first/last bounds and counts', () => {
    const rows: SysRecord[] = [
      { line_id: 1, period: '2026-04-01T10:00:00', sys_type_id: 130, sys_name: 'dP > max', volume: 5 },
      { line_id: 1, period: '2026-04-01T11:00:00', sys_type_id: 2, sys_name: 'dP норма', volume: 1 },
      { line_id: 2, period: '2026-04-02T10:00:00', sys_type_id: 130, sys_name: 'dP > max', volume: 7 },
      { line_id: 2, period: '2026-04-02T12:00:00', sys_type_id: 2, sys_name: 'dP норма', volume: 2 },
    ]
    const [group] = groupAccidentsByType(pairAccidents(rows, CONTRACT))
    const perLine = summarizeOccurrencesByLine(group.occurrences, false)
    expect(perLine).toHaveLength(2)
    expect(perLine.every((l) => l.count === 1)).toBe(true)
    expect(perLine.find((l) => l.line_id === 2)?.volume).toBe(7)
  })
})
