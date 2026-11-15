import { describe, expect, it } from 'vitest'
import { lineDeviation, type LineDeviationInput } from './grsLineDeviation'

const days = Array.from({ length: 20 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`)
const flat = (v: number) => days.map(() => v)

/** Three stations, all on their model; the lines read 2× the 1С figure
 *  (a transit through the GRS) and industry takes 100 m³ a day. */
function input(over: Partial<LineDeviationInput> = {}): LineDeviationInput {
  const names = ['A', 'B', 'C']
  const archive: LineDeviationInput['archive'] = {}
  const industry: Record<number, Record<string, number>> = {}
  names.forEach((_, k) => {
    archive[`physical:${k + 1}`] = Object.fromEntries(
      days.map((d) => [d, 2 * 1000 * (k + 1) + 100]),
    )
    industry[k + 1] = Object.fromEntries(days.map((d) => [d, 100]))
  })
  return {
    days,
    // 1С up to the 10th, the model all the way.
    stations: names.map((name, k) => ({
      name,
      y: days.map((_, i) => (i < 10 ? k + 1 : null)),
      model: flat(k + 1),
    })),
    mapped: names.map((name, k) => ({ name, lines: [{ kind: 'physical', id: k + 1 }] })),
    archive,
    industry,
    ...over,
  }
}

describe('line deviation', () => {
  it('brings the lines to the 1С scale and reads zero where all is on the model', () => {
    const out = lineDeviation(input())
    for (const s of out.stations) {
      expect(s.scale).toBeCloseTo(0.5)
      expect(s.calibrationDays).toBe(10)
      expect(s.deviation.at(-1)).toBeCloseTo(0)
      expect(s.estimate.at(-1)).toBeCloseTo(s.model.at(-1)!)
    }
  })

  it('a station whose lines drop after the 1С figures end is off, the others not', () => {
    const inp = input()
    for (const d of days.slice(12)) inp.archive['physical:2'][d] = 0.7 * 2 * 2000 + 100
    const out = lineDeviation(inp)
    const b = out.stations.find((s) => s.name === 'B')!
    expect(b.deviation.at(-1)).toBeCloseTo(-30, 0)
    expect(b.week.at(-1)).toBeCloseTo(-30, 0)
    expect(out.stations.find((s) => s.name === 'A')!.deviation.at(-1)).toBeCloseTo(0)
  })

  it('what all stations share is taken out', () => {
    const inp = input()
    for (const s of inp.stations)
      s.model = s.model.map((v, i) => (i >= 12 ? (v as number) / 1.2 : v))
    const out = lineDeviation(inp)
    expect(out.common.at(-1)).toBeCloseTo(20)
    for (const s of out.stations) expect(s.deviation.at(-1)).toBeCloseTo(0)
  })

  it('a day a line is missing is unknown, not zero', () => {
    const inp = input()
    delete inp.archive['physical:1'][days[15]]
    const a = lineDeviation(inp).stations.find((s) => s.name === 'A')!
    expect(a.estimate[15]).toBeNull()
    expect(a.deviation[15]).toBeNull()
  })

  it('industry can be left in', () => {
    const a = lineDeviation(input({ industry: null })).stations[0]
    expect(a.scale).toBeCloseTo(1000 / 2100)
  })
})
