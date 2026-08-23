import { describe, expect, it } from 'vitest'
import {
  groupAccidentsByBranch,
  pairAccidents,
  summarizeOccurrencesByLine,
  type DailyVolumeLookup,
  type SysRecord,
} from './accidentsCalculator'

/**
 * A fixed dataset and the exact figures it must produce.
 *
 * The unit tests above each pin one rule; this one pins the ARITHMETIC of a
 * whole run — counts, durations, volumes, per-line rollups — against numbers
 * that cannot drift unnoticed. The dataset is generated, not typed out, so it
 * covers what real data does: alarms that overlap, repeats without an end,
 * ends without a start, accidents crossing the 07:00 boundary, standalone
 * notifications, and several lines in alarm at once.
 *
 * The expected values were taken from the implementation on 2026-08-23, the
 * same day a run over a real month (435 000 events, 217 911 accidents) was
 * compared occurrence by occurrence against the pre-rewrite calculator and
 * came out identical. So these numbers are the pre-rewrite behaviour, not
 * merely a snapshot of whatever the code happened to do.
 */

const FROM = '2026-05-01T07:00:00'
const TO = '2026-05-06T07:00:00'
const fromMs = new Date(FROM).getTime()
const toMs = new Date(TO).getTime()

/** Deterministic pseudo-random: the fixture must be identical on every machine. */
function makeRandom(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function buildEvents(): SysRecord[] {
  const random = makeRandom(20260823)
  const lines = [11, 12, 13, 21, 22, 31]
  // 130/2 and 175/47 pair up; 90 is standalone; 60 is an end whose start falls
  // before the period.
  const starts = [130, 175]
  const rows: SysRecord[] = []

  for (const line of lines) {
    let counter = 0
    for (let hour = 0; hour < 5 * 24; hour++) {
      const ms = fromMs + hour * 3_600_000 + Math.floor(random() * 3_600_000)
      counter += Math.floor(random() * 500)
      const roll = random()
      if (roll < 0.35) {
        const code = starts[Math.floor(random() * starts.length)]
        rows.push({
          line_id: line,
          ms,
          sys_type_id: code,
          sys_name: `Аварія ${code}`,
          volume: counter,
        })
        // Two thirds of them get an end; the rest run to the period end.
        if (random() < 0.66) {
          const endMs = ms + Math.floor(random() * 20) * 3_600_000 + 600_000
          if (endMs < toMs) {
            rows.push({
              line_id: line,
              ms: endMs,
              sys_type_id: code - 128,
              sys_name: `Норма ${code - 128}`,
              volume: counter + Math.floor(random() * 900),
            })
          }
        }
      } else if (roll < 0.45) {
        rows.push({ line_id: line, ms, sys_type_id: 90, sys_name: 'Сповіщення', volume: counter })
      } else if (roll < 0.5) {
        // An end with no start in the period: clipped to the contract hour.
        rows.push({ line_id: line, ms, sys_type_id: 60, sys_name: 'Норма 60', volume: counter })
      }
    }
  }
  return rows
}

/** Stands in for the daily archive, so multi-day accidents take that path too. */
const dailyVolume: DailyVolumeLookup = (lineId, day) =>
  ((lineId ?? 0) * 7 + Number(day.slice(8, 10))) * 100

const branchOf = (lineId: number | undefined) =>
  lineId == null ? null : lineId < 20 ? 2 : lineId < 30 ? 9 : null

describe('accidents report arithmetic', () => {
  const rows = buildEvents()
  const byBranch = groupAccidentsByBranch(
    pairAccidents(rows, { fromMs, toMs }),
    branchOf,
    dailyVolume,
  )

  it('builds the fixture it is meant to', () => {
    expect(rows).toHaveLength(523)
    expect(byBranch.map((b) => b.branchId)).toEqual([2, 9, null])
  })

  it('keeps the per-branch totals', () => {
    expect(byBranch.map((b) => [b.branchId, b.totalCount, Math.round(b.totalVolume)])).toEqual([
      [2, 176, 130500],
      [9, 118, 153500],
      [null, 70, 110000],
    ])
  })

  it('keeps every type group of the first branch', () => {
    const groups = byBranch[0].groups.map((g) => [
      g.sys_type_id,
      g.totalCount,
      g.totalDurationFormatted,
      Math.round(g.totalVolume),
    ])
    expect(groups).toEqual([
      [130, 68, '355:20:33', 129034],
      [175, 57, '342:58:32', 125632],
      [90, 38, '—', 0],
      [188, 13, '260:32:53', 140347],
    ])
  })

  it('keeps the per-line rollup an expanded row shows', () => {
    const group = byBranch[0].groups.find((g) => g.sys_type_id === 130)!
    const perLine = summarizeOccurrencesByLine(group.occurrences, group.isStandalone, dailyVolume)
    expect(
      perLine.map((l) => [l.line_id, l.count, l.durationFormatted, Math.round(l.volume)]),
    ).toEqual([
      [12, 31, '119:37:09', 43224],
      [13, 21, '117:25:43', 46048],
      [11, 16, '118:17:39', 39762],
    ])
  })

  it('never reports more volume than the union across types', () => {
    // Per branch the union must not exceed the naive sum of the type volumes,
    // and must be smaller wherever types overlap in time.
    for (const branch of byBranch) {
      const naive = branch.groups.reduce((s, g) => s + g.totalVolume, 0)
      expect(branch.totalVolume).toBeLessThan(naive)
    }
  })
})
