import { describe, it, expect } from 'vitest'
import {
  isAccidentStart,
  isAccidentEnd,
  isStandaloneCode,
  pairAccidents,
  groupAccidentsByType,
  summarizeOccurrencesByLine,
  volumeOverOccurrences,
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

describe('overlapping unpaired accidents', () => {
  // Real case: type 405 on line Тернівка fired three times within 12 minutes
  // and never got its end code, so all three ran to the period end. Summing
  // them reported 349h over a 117h span; the union is the real time in alarm.
  it('counts overlapping intervals once', () => {
    const rows: SysRecord[] = [
      { line_id: 86, period: '2026-05-04T10:21:53', sys_type_id: 405, sys_name: 'Темп. заміна', volume: 0 },
      { line_id: 86, period: '2026-05-04T10:32:56', sys_type_id: 405, sys_name: 'Темп. заміна', volume: 0 },
      { line_id: 86, period: '2026-05-04T10:33:19', sys_type_id: 405, sys_name: 'Темп. заміна', volume: 0 },
    ]
    const period = { fromDate: '2026-05-01T07:00:00', toDate: '2026-05-09T07:00:00' }
    const [group] = groupAccidentsByType(pairAccidents(rows, period))

    expect(group.totalCount).toBe(3)
    const spanMs =
      new Date('2026-05-09T07:00:00').getTime() - new Date('2026-05-04T10:21:53').getTime()
    // Union == the earliest start to the period end, not 3x that.
    expect(group.totalDuration).toBe(spanMs)
    expect(group.totalDuration / 3_600_000).toBeCloseTo(116.6, 1)
  })

  it('still adds up intervals that do not overlap', () => {
    const rows: SysRecord[] = [
      { line_id: 1, period: '2026-04-01T08:00:00', sys_type_id: 130, volume: 0 },
      { line_id: 1, period: '2026-04-01T09:00:00', sys_type_id: 2, volume: 0 },
      { line_id: 1, period: '2026-04-01T12:00:00', sys_type_id: 130, volume: 0 },
      { line_id: 1, period: '2026-04-01T14:00:00', sys_type_id: 2, volume: 0 },
    ]
    const [group] = groupAccidentsByType(pairAccidents(rows, CONTRACT))
    expect(group.totalDuration / 3_600_000).toBe(3) // 1h + 2h
  })
})

describe('accident volume (counter accumulates from the start of the day)', () => {
  it('uses end − start within one commercial day', () => {
    const rows: SysRecord[] = [
      { line_id: 1, period: '2026-04-01T10:00:00', sys_type_id: 130, volume: 120 },
      { line_id: 1, period: '2026-04-01T12:00:00', sys_type_id: 2, volume: 175 },
    ]
    const [group] = groupAccidentsByType(pairAccidents(rows, CONTRACT))
    expect(group.totalVolume).toBe(55)
  })

  it('treats a missing start as 0 — the counter resets at the contract hour', () => {
    // Only the END is inside the period, so the accident ran from the day start.
    const rows: SysRecord[] = [
      { line_id: 1, period: '2026-04-01T09:00:00', sys_type_id: 2, volume: 42 },
    ]
    const [group] = groupAccidentsByType(pairAccidents(rows, CONTRACT))
    expect(group.occurrences[0].type).toBe('end_only')
    expect(group.totalVolume).toBe(42)
  })

  it('closes an open accident with the daily total from the daily archive', () => {
    const rows: SysRecord[] = [
      { line_id: 1, period: '2026-04-02T10:00:00', sys_type_id: 130, volume: 30 },
    ]
    // Period ends 03.04 07:00, so the accident stays open on commercial day 02.04.
    const daily = (lineId: number | undefined, day: string) =>
      lineId === 1 && day === '2026-04-02' ? 200 : undefined
    const [group] = groupAccidentsByType(pairAccidents(rows, CONTRACT), daily)
    expect(group.occurrences[0].type).toBe('start_only')
    expect(group.totalVolume).toBe(170) // 200 − 30
  })

  it('reports unknown (0 contribution) when the daily total is unavailable', () => {
    const rows: SysRecord[] = [
      { line_id: 1, period: '2026-04-02T10:00:00', sys_type_id: 130, volume: 30 },
    ]
    const [group] = groupAccidentsByType(pairAccidents(rows, CONTRACT))
    expect(group.occurrences[0].volume).toBeNull()
    expect(group.totalVolume).toBe(0)
  })
})

describe('volume never exceeds what the line passed', () => {
  it('counts overlapping alarms of different types only once', () => {
    // Two different alarm types cover the same window on the same line.
    const rows: SysRecord[] = [
      { line_id: 1, period: '2026-04-01T08:00:00', sys_type_id: 130, volume: 10 },
      { line_id: 1, period: '2026-04-01T18:00:00', sys_type_id: 2, volume: 90 },
      { line_id: 1, period: '2026-04-01T09:00:00', sys_type_id: 175, volume: 20 },
      { line_id: 1, period: '2026-04-01T17:00:00', sys_type_id: 47, volume: 80 },
    ]
    const groups = groupAccidentsByType(pairAccidents(rows, CONTRACT))
    const naiveSum = groups.reduce((s, g) => s + g.totalVolume, 0)
    expect(naiveSum).toBe(80 + 60) // per type: 90−10 and 80−20

    // The union across types is the outer window only.
    const all = groups.flatMap((g) => g.occurrences)
    expect(volumeOverOccurrences(all, () => undefined)).toBe(80)
  })

  it('collapses repeats of one type that overlap', () => {
    const rows: SysRecord[] = [
      { line_id: 1, period: '2026-04-01T08:00:00', sys_type_id: 130, volume: 10 },
      { line_id: 1, period: '2026-04-01T09:00:00', sys_type_id: 130, volume: 25 },
      { line_id: 1, period: '2026-04-01T18:00:00', sys_type_id: 2, volume: 90 },
      { line_id: 1, period: '2026-04-01T19:00:00', sys_type_id: 2, volume: 95 },
    ]
    const [group] = groupAccidentsByType(pairAccidents(rows, CONTRACT))
    // FIFO pairs 08→18 and 09→19; the spans overlap, so the union is 10→95.
    expect(group.totalVolume).toBe(85)
  })
})

describe('summarizeOccurrencesByLine', () => {
  it('rolls occurrences up per line with first/last bounds and counts', () => {
    const rows: SysRecord[] = [
      { line_id: 1, period: '2026-04-01T10:00:00', sys_type_id: 130, sys_name: 'dP > max', volume: 5 },
      { line_id: 1, period: '2026-04-01T11:00:00', sys_type_id: 2, sys_name: 'dP норма', volume: 1 },
      { line_id: 2, period: '2026-04-02T10:00:00', sys_type_id: 130, sys_name: 'dP > max', volume: 7 },
      { line_id: 2, period: '2026-04-02T12:00:00', sys_type_id: 2, sys_name: 'dP норма', volume: 19 },
    ]
    const [group] = groupAccidentsByType(pairAccidents(rows, CONTRACT))
    const perLine = summarizeOccurrencesByLine(group.occurrences, false)
    expect(perLine).toHaveLength(2)
    expect(perLine.every((l) => l.count === 1)).toBe(true)
    expect(perLine.find((l) => l.line_id === 2)?.volume).toBe(12) // 19 − 7
  })
})
