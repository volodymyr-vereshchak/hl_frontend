/**
 * GRS consumption trends.
 *
 * For every line the NET volume of a period is the metered volume minus what
 * industry took (clamped at zero). Two robust steps follow:
 *
 * 1. Per line, each period becomes an INDEX: net / median(net of that line) ×
 *    100. 100% is "an ordinary period of this GRS". The median (not the sum the
 *    old report divided by) keeps one failed or leaking day from dragging every
 *    other day of the line down. Hourly data is normalised per hour of day, so
 *    the night trough is not mistaken for an anomaly.
 * 2. Per period, across all lines: the branch median index and a band of
 *    normal spread around it. A GRS that leaves the band behaves unlike the rest
 *    of the branch — weather moves everyone together, a fault moves one line.
 */
import { buildEnterpriseByLinePeriod, enterprisePeriodKey, type PeriodType } from './enterpriseVolumes'
import type { EnterpriseRecord } from '@/api/enterprise'
import type { ArchiveRow } from '@/api/entities'

export interface TrendPoint {
  period: string
  [seriesKey: string]: string | number | [number, number] | undefined
}

/** 'auto' = median ± 3 robust sigmas (MAD); a number = median ± that many %. */
export type BandMode = 'auto' | number

export interface TrendLineStats {
  /** Periods where the line is outside the band. */
  outliers: number
  /** Largest deviation from the branch median, % of the median (signed). */
  maxDeviation: number
}

export interface TrendResult {
  points: TrendPoint[]
  /** Lines that got an index (a positive baseline). */
  stats: Map<number, TrendLineStats>
  /** Lines left out: no data or a zero median, so no "ordinary" level exists. */
  excluded: number[]
}

/** Below this many lines a period has no meaningful branch median. */
const MIN_LINES_FOR_BAND = 3
/** MAD → sigma for normally distributed data. */
const MAD_SIGMA = 1.4826
const AUTO_SIGMAS = 3
/** Floor of the auto band half-width, % of the median: identical lines give MAD 0. */
const AUTO_MIN_HALF_WIDTH = 5

export function median(values: number[]): number {
  if (values.length === 0) return NaN
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export const indexKey = (lid: number) => `line_${lid}`

export function calculateTrends(
  rows: ArchiveRow[],
  enterpriseData: EnterpriseRecord[],
  periodType: PeriodType,
  band: BandMode = 'auto',
): TrendResult {
  const enterpriseMap = buildEnterpriseByLinePeriod(enterpriseData, periodType)

  // Net volume per line per period. A row without a volume is a gap (no
  // archive), not a zero day — it must not pull the median down.
  const net = new Map<number, Map<string, number>>()
  for (const r of rows) {
    const lid = r.line_id as number
    if (lid == null || r.volume == null) continue
    const gs = Number(r.volume)
    if (!Number.isFinite(gs)) continue
    const key = enterprisePeriodKey(r.period, periodType)
    const ent = enterpriseMap[lid]?.[key] ?? 0
    if (!net.has(lid)) net.set(lid, new Map())
    const m = net.get(lid)!
    // Duplicate rows of one period add up, as the archive totals do.
    m.set(key, (m.get(key) ?? 0) + Math.max(0, gs - ent))
  }

  const hourOf = (key: string) => (periodType === 'hourly' ? key.slice(11, 13) : '')

  const points = new Map<string, TrendPoint>()
  const point = (key: string) => {
    let p = points.get(key)
    if (!p) {
      p = { period: key }
      points.set(key, p)
    }
    return p
  }

  const stats = new Map<number, TrendLineStats>()
  const excluded: number[] = []

  for (const [lid, byPeriod] of net) {
    const all = [...byPeriod.values()]
    const overall = median(all)
    if (!(overall > 0)) {
      excluded.push(lid)
      continue
    }
    // Hourly: one baseline per hour of day; an hour that is usually idle falls
    // back to the line's overall median instead of dividing by zero.
    const hourBase = new Map<string, number>()
    if (periodType === 'hourly') {
      const byHour = new Map<string, number[]>()
      for (const [key, v] of byPeriod) {
        const h = hourOf(key)
        if (!byHour.has(h)) byHour.set(h, [])
        byHour.get(h)!.push(v)
      }
      for (const [h, vs] of byHour) {
        const m = median(vs)
        hourBase.set(h, m > 0 ? m : overall)
      }
    }
    for (const [key, v] of byPeriod) {
      const base = hourBase.get(hourOf(key)) ?? overall
      const p = point(key)
      p[indexKey(lid)] = (v / base) * 100
      p[`${indexKey(lid)}_volume`] = v
      p[`${indexKey(lid)}_enterprise`] = enterpriseMap[lid]?.[key] ?? 0
    }
    stats.set(lid, { outliers: 0, maxDeviation: 0 })
  }

  // Branch median and band per period.
  for (const p of points.values()) {
    const vals: [number, number][] = []
    for (const lid of stats.keys()) {
      const v = p[indexKey(lid)]
      if (typeof v === 'number') vals.push([lid, v])
    }
    if (vals.length < MIN_LINES_FOR_BAND) continue
    const med = median(vals.map(([, v]) => v))
    let half: number
    if (band === 'auto') {
      const mad = median(vals.map(([, v]) => Math.abs(v - med)))
      half = Math.max(AUTO_SIGMAS * MAD_SIGMA * mad, (med * AUTO_MIN_HALF_WIDTH) / 100)
    } else {
      half = (med * band) / 100
    }
    const lo = Math.max(0, med - half)
    const hi = med + half
    p.median = med
    p.band = [lo, hi]
    if (!(med > 0)) continue
    for (const [lid, v] of vals) {
      const s = stats.get(lid)!
      const dev = ((v - med) / med) * 100
      if (Math.abs(dev) > Math.abs(s.maxDeviation)) s.maxDeviation = dev
      if (v < lo || v > hi) s.outliers += 1
    }
  }

  return {
    points: [...points.values()].sort((a, b) => String(a.period).localeCompare(String(b.period))),
    stats,
    excluded,
  }
}

/** Is this line outside the band in this period? */
export function isOutside(p: TrendPoint, lid: number): boolean {
  const v = p[indexKey(lid)]
  const b = p.band
  return typeof v === 'number' && Array.isArray(b) && (v < b[0] || v > b[1])
}

/**
 * Y-axis ceiling that keeps the band readable: a single 1000% spike must not
 * squash everything else into the bottom tenth. Values above it run off the
 * top edge; the tooltip still reports them exactly.
 */
export function trendYCeiling(points: TrendPoint[], lineIds: number[]): number {
  const vals: number[] = []
  let bandTop = 0
  for (const p of points) {
    if (Array.isArray(p.band)) bandTop = Math.max(bandTop, p.band[1])
    for (const lid of lineIds) {
      const v = p[indexKey(lid)]
      if (typeof v === 'number') vals.push(v)
    }
  }
  vals.sort((a, b) => a - b)
  const p95 = vals.length ? vals[Math.floor((vals.length - 1) * 0.95)] : 0
  const top = Math.max(bandTop * 1.3, p95 * 1.1, 120)
  return Math.ceil(top / 20) * 20
}

/** Distinct, evenly spread hues so many lines stay tellable apart. */
export function trendColor(index: number, total: number): string {
  const hue = Math.round((index * 360) / Math.max(1, total))
  return `hsl(${hue} 70% 55%)`
}
