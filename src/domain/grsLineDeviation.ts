/**
 * A GRS against its consumption model, measured by its metering lines.
 *
 * The model is fitted on the 1С figures (inflow less non-household, thousand
 * m³ a day), which come once a month. The lines are polled every day. Their
 * volume less what industry took (as the trends report computes it) is not
 * the same quantity as the 1С figure — a line may carry a transit, 1С may book
 * consumers the lines do not see — so it is brought to the 1С scale first:
 * the median of 1С / lines over the last days both have. What is left is the
 * station's household consumption by the lines, up to today, compared with
 * the model; and, as in the model's detector, less what every mapped station
 * shares that day, so a cold snap the model missed raises no alarm.
 */

export interface LineRef {
  kind: 'physical' | 'virtual' | 'dpd'
  id: number
}

export interface LineDeviationInput {
  /** The analysis days, ISO. */
  days: string[]
  /** Per station: the 1С figure and the model, thousand m³ a day, by `days`. */
  stations: { name: string; y: (number | null)[]; model: (number | null)[] }[]
  /** The lines of each mapped station. */
  mapped: { name: string; lines: LineRef[] }[]
  /** `${kind}:${id}` → day → m³. */
  archive: Record<string, Record<string, number>>
  /** line id → day → m³ industry took; null to leave industry in. */
  industry: Record<number, Record<string, number>> | null
  /** How many of the latest common days set the scale. */
  calibrationDays?: number
}

export interface StationDeviation {
  name: string
  /** 1С / lines: what a line m³ is in 1С m³. null — no common days. */
  scale: number | null
  calibrationDays: number
  /** Households by the lines, thousand m³ (null where a line has no day). */
  estimate: (number | null)[]
  /** The model, thousand m³. */
  model: (number | null)[]
  /** Day's deviation from the model, less the common one, %. */
  deviation: (number | null)[]
  /** The same over 7 days, %. */
  week: (number | null)[]
  /** The lines' volume less industry, m³ a day. */
  net: (number | null)[]
}

export const lineKey = (l: LineRef) => `${l.kind}:${l.id}`

function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Lines' volume less industry, m³; null where a line has no figure. */
function netByDay(lines: LineRef[], days: string[], input: LineDeviationInput): (number | null)[] {
  return days.map((day) => {
    let total = 0
    for (const line of lines) {
      const v = input.archive[lineKey(line)]?.[day]
      if (v == null) return null
      total += v - (input.industry?.[line.id]?.[day] ?? 0)
    }
    return Math.max(total, 0)
  })
}

export function lineDeviation(input: LineDeviationInput): {
  stations: StationDeviation[]
  /** What all mapped stations share, %, by day. */
  common: (number | null)[]
} {
  const { days } = input
  const calibration = input.calibrationDays ?? 60
  const byName = new Map(input.stations.map((s) => [s.name, s]))
  const rows = input.mapped
    .filter((m) => m.lines.length && byName.has(m.name))
    .map((m) => {
      const station = byName.get(m.name)!
      const net = netByDay(m.lines, days, input)
      const ratios: number[] = []
      for (let i = days.length - 1; i >= 0 && ratios.length < calibration; i--) {
        const y = station.y[i]
        const n = net[i]
        if (y != null && y > 0 && n != null && n > 0) ratios.push((y * 1000) / n)
      }
      const scale = median(ratios)
      const estimate = net.map((n) => (n == null || scale == null ? null : (n * scale) / 1000))
      const log = estimate.map((e, i) => {
        const m2 = station.model[i]
        return e != null && e > 0 && m2 != null && m2 > 0 ? Math.log(e / m2) : null
      })
      return {
        name: m.name,
        scale,
        calibrationDays: ratios.length,
        estimate,
        model: station.model,
        log,
        net,
      }
    })

  const common = days.map((_, i) => {
    const values = rows.map((r) => r.log[i]).filter((v): v is number => v != null)
    return values.length >= 3 ? median(values) : values.length ? 0 : null
  })

  const stations = rows.map((r) => {
    const own = r.log.map((v, i) => (v == null ? null : v - (common[i] ?? 0)))
    const week = weekly(own)
    return {
      name: r.name,
      scale: r.scale,
      calibrationDays: r.calibrationDays,
      estimate: r.estimate,
      model: r.model,
      deviation: own.map((v) => (v == null ? null : (Math.exp(v) - 1) * 100)),
      week,
      net: r.net,
    }
  })
  return { stations, common: common.map((v) => (v == null ? null : (Math.exp(v) - 1) * 100)) }
}

/** 7-day mean of a log ratio, as %; null with fewer than 5 days known. */
export function weekly(log: (number | null)[]): (number | null)[] {
  return log.map((_, i) => {
    const window = log.slice(Math.max(0, i - 6), i + 1).filter((v): v is number => v != null)
    return window.length >= 5
      ? (Math.exp(window.reduce((a, b) => a + b, 0) / window.length) - 1) * 100
      : null
  })
}
