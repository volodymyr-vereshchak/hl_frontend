/**
 * GRS consumption trends (ported from GRSTrends.jsx).
 *
 * For every line the NET volume of a period is the metered volume minus what
 * industry took (clamped at zero). Each period is then expressed as a share of
 * that line's total over the whole range, so every line sums to ~100% and
 * lines of very different sizes stay comparable on one chart.
 *
 * Two additions, both computed from the selected range alone (the database may
 * have no history before it):
 *
 * - Outlier-proof total. A period far from the line's LOCAL level (median of
 *   the neighbouring periods) is an outlier; the total counts the local level
 *   in its place. One failed or leaking day therefore no longer pushes every
 *   other day of the line down. The outlier itself is still drawn as it is.
 * - One corridor for the whole branch: in every period, the median share of
 *   all GRS and a band of normal spread around it. A GRS outside the band
 *   behaves unlike the rest of the branch in that period.
 * - A line's total is taken over the periods every GRS has data for, so a
 *   GRS missing days is not lifted above the others on the days it has.
 */
import { buildEnterpriseByLinePeriod, enterprisePeriodKey, type PeriodType } from './enterpriseVolumes'
import type { EnterpriseRecord } from '@/api/enterprise'
import type { ArchiveRow } from '@/api/entities'

export interface TrendPoint {
  period: string
  /** Branch corridor [lo, hi] of this period, when it has one. */
  band?: [number, number]
  [seriesKey: string]: string | number | [number, number] | undefined
}

export interface TrendLineStats {
  /** Periods outside the branch corridor. */
  outside: number
  /** Periods left out of the total as outliers. */
  outliers: number
}

/** 'auto' = median ± 3 robust sigmas (MAD) of the branch; a number = median ± that many %. */
export type BandMode = 'auto' | number

/** Neighbours on each side that make up the local level (7-period window). */
const HALF_WINDOW = 3
/** A period this many times above (or below 1/x of) the local level is an outlier. */
const OUTLIER_FACTOR = 3
/** Below this many lines a period has no meaningful branch median. */
const MIN_LINES_FOR_BAND = 3
const SIGMAS = 3
const MAD_SIGMA = 1.4826
/** Floor of the auto half-width, % of the median: identical lines give MAD 0. */
const MIN_HALF_WIDTH_PCT = 5
/** A line with data for less than this share of the range's periods is 'partial'. */
const MIN_COVERAGE = 0.5

export const shareKey = (lid: number) => `line_${lid}`

export function median(values: number[]): number {
  if (values.length === 0) return NaN
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Local level of every period: median of its neighbours on both sides, the
 * period itself left out (a median that includes it would never disagree with
 * a single bad day's neighbours). Symmetric, so it shrinks at the edges of the
 * range and a heating ramp does not bias the first and last days. Hourly
 * series are split by hour of day first, so 03:00 is compared with other
 * nights, not with the afternoon.
 */
function localLevels(keys: string[], values: Map<string, number>, periodType: PeriodType) {
  const groups = new Map<string, string[]>()
  for (const k of keys) {
    const g = periodType === 'hourly' ? k.slice(11, 13) : ''
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(k)
  }
  const level = new Map<string, number>()
  for (const ks of groups.values()) {
    ks.forEach((k, i) => {
      const h = Math.min(HALF_WINDOW, i, ks.length - 1 - i)
      const win =
        h > 0
          ? [...ks.slice(i - h, i), ...ks.slice(i + 1, i + h + 1)]
          : ks.length > 1
            ? [ks[i === 0 ? 1 : i - 1]]
            : [k]
      level.set(k, median(win.map((x) => values.get(x)!)))
    })
  }
  return level
}

export function calculateTrendPercentages(
  rows: ArchiveRow[],
  enterpriseData: EnterpriseRecord[],
  periodType: PeriodType,
  band: BandMode = 'auto',
): TrendPoint[] {
  const enterpriseMap = buildEnterpriseByLinePeriod(enterpriseData, periodType)

  // Net volume per line per period. A row without a volume is a gap, not a
  // zero — it must not drag the local level down.
  const byLine = new Map<number, Map<string, number>>()
  for (const r of rows) {
    const lid = r.line_id as number
    if (lid == null || r.volume == null) continue
    const gs = Number(r.volume)
    if (!Number.isFinite(gs)) continue
    const key = enterprisePeriodKey(r.period, periodType)
    const ent = enterpriseMap[lid]?.[key] ?? 0
    if (!byLine.has(lid)) byLine.set(lid, new Map())
    const m = byLine.get(lid)!
    m.set(key, (m.get(key) ?? 0) + Math.max(0, gs - ent))
  }

  // Which periods a line's TOTAL is taken over: only those every line has
  // data for. A line missing days would otherwise divide by a smaller total
  // and sit above the branch on all its other days (Новомиколаївка with no
  // archive after 03.11). A line covering under half of the range would wipe
  // out most periods for everybody, so it keeps its own total and stays out
  // of the median and the corridor.
  const allPeriods = new Set<string>()
  for (const values of byLine.values()) for (const k of values.keys()) allPeriods.add(k)
  const core = [...byLine.keys()].filter(
    (lid) => byLine.get(lid)!.size >= allPeriods.size * MIN_COVERAGE,
  )
  const complete = new Set(
    [...allPeriods].filter((k) => core.every((lid) => byLine.get(lid)!.has(k))),
  )

  const points = new Map<string, TrendPoint>()
  const used: number[] = []
  for (const [lid, values] of byLine) {
    const keys = [...values.keys()].sort()
    const level = localLevels(keys, values, periodType)
    const isOutlier = (k: string) => {
      const v = values.get(k)!
      const b = level.get(k)!
      return b > 0 && (v > b * OUTLIER_FACTOR || v < b / OUTLIER_FACTOR)
    }
    const inCore = core.includes(lid) && complete.size > 0
    const counted = inCore ? keys.filter((k) => complete.has(k)) : keys
    const total = counted.reduce((s, k) => s + (isOutlier(k) ? level.get(k)! : values.get(k)!), 0)
    if (total <= 0) continue
    if (inCore) used.push(lid)

    const key = shareKey(lid)
    for (const k of keys) {
      const v = values.get(k)!
      if (!points.has(k)) points.set(k, { period: k })
      const p = points.get(k)!
      p[key] = (v / total) * 100
      p[`${key}_volume`] = v
      p[`${key}_enterprise`] = enterpriseMap[lid]?.[k] ?? 0
      if (isOutlier(k)) p[`${key}_outlier`] = 1
    }
  }

  // The branch corridor, period by period, over the lines that have it.
  for (const p of points.values()) {
    const vals: [number, number][] = []
    for (const lid of used) {
      const v = p[shareKey(lid)]
      if (typeof v === 'number') vals.push([lid, v])
    }
    if (vals.length < MIN_LINES_FOR_BAND) continue
    const med = median(vals.map(([, v]) => v))
    const half =
      band === 'auto'
        ? Math.max(
            SIGMAS * MAD_SIGMA * median(vals.map(([, v]) => Math.abs(v - med))),
            (med * MIN_HALF_WIDTH_PCT) / 100,
          )
        : (med * band) / 100
    const lo = Math.max(0, med - half)
    const hi = med + half
    p.median = med
    p.band = [lo, hi]
    for (const [lid, v] of vals) if (v < lo || v > hi) p[`${shareKey(lid)}_out`] = 1
  }

  return [...points.values()].sort((a, b) => String(a.period).localeCompare(String(b.period)))
}

export function isOutside(p: TrendPoint, lid: number): boolean {
  return p[`${shareKey(lid)}_out`] === 1
}

export function trendLineStats(points: TrendPoint[], lineIds: number[]): Map<number, TrendLineStats> {
  const stats = new Map<number, TrendLineStats>()
  for (const lid of lineIds) {
    let outside = 0
    let outliers = 0
    for (const p of points) {
      if (isOutside(p, lid)) outside += 1
      if (p[`${shareKey(lid)}_outlier`] === 1) outliers += 1
    }
    stats.set(lid, { outside, outliers })
  }
  return stats
}

/**
 * Y-axis ceiling that keeps the ordinary days readable: a lone outlier must not
 * squash every other curve into the bottom tenth. Values above it run off the
 * top edge; the tooltip still reports them exactly.
 */
export function trendYCeiling(points: TrendPoint[], lineIds: number[]): number {
  const vals: number[] = []
  for (const p of points) {
    if (p.band) vals.push(p.band[1])
    for (const lid of lineIds) {
      const v = p[shareKey(lid)]
      if (typeof v === 'number') vals.push(v)
    }
  }
  if (vals.length === 0) return 1
  vals.sort((a, b) => a - b)
  const p98 = vals[Math.floor((vals.length - 1) * 0.98)]
  const max = vals[vals.length - 1]
  return Math.min(max, p98 * 1.5) * 1.05
}

/** Distinct, evenly spread hues so many lines stay tellable apart. */
export function trendColor(index: number, total: number): string {
  const hue = Math.round((index * 360) / Math.max(1, total))
  return `hsl(${hue} 70% 55%)`
}
