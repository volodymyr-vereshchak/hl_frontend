/**
 * GRS consumption trends (ported from GRSTrends.jsx).
 *
 * For every line the NET volume of a period is the metered volume minus what
 * industry took (clamped at zero). Each period is then expressed as a share of
 * that line's total over the whole range, so every line sums to 100% and lines
 * of very different sizes stay comparable on one chart.
 */
import { buildEnterpriseByLinePeriod, enterprisePeriodKey, type PeriodType } from './enterpriseVolumes'
import type { EnterpriseRecord } from '@/api/enterprise'
import type { ArchiveRow } from '@/api/entities'

export interface TrendPoint {
  period: string
  [seriesKey: string]: string | number
}

export function calculateTrendPercentages(
  rows: ArchiveRow[],
  enterpriseData: EnterpriseRecord[],
  periodType: PeriodType,
): TrendPoint[] {
  const byLine = new Map<number, ArchiveRow[]>()
  for (const r of rows) {
    const lid = r.line_id as number
    if (lid == null) continue
    if (!byLine.has(lid)) byLine.set(lid, [])
    byLine.get(lid)!.push(r)
  }

  const enterpriseMap = buildEnterpriseByLinePeriod(enterpriseData, periodType)
  const net = (lid: number, r: ArchiveRow) => {
    const key = enterprisePeriodKey(r.period, periodType)
    const gs = Number(r.volume) || 0
    const ent = enterpriseMap[lid]?.[key] ?? 0
    return Math.max(0, gs - ent)
  }

  const points = new Map<string, TrendPoint>()
  for (const [lid, records] of byLine) {
    const total = records.reduce((s, r) => s + net(lid, r), 0)
    if (total <= 0) continue
    for (const r of records) {
      const key = enterprisePeriodKey(r.period, periodType)
      const value = net(lid, r)
      if (!points.has(key)) points.set(key, { period: key })
      const point = points.get(key)!
      point[`line_${lid}`] = (value / total) * 100
      point[`line_${lid}_volume`] = value
      point[`line_${lid}_enterprise`] = enterpriseMap[lid]?.[key] ?? 0
    }
  }

  return [...points.values()].sort((a, b) => String(a.period).localeCompare(String(b.period)))
}

/** Distinct, evenly spread hues so many lines stay tellable apart. */
export function trendColor(index: number, total: number): string {
  const hue = Math.round((index * 360) / Math.max(1, total))
  return `hsl(${hue} 70% 55%)`
}
