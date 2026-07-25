/**
 * Shared helpers for the enterprise (промисловість) volume overlay — ported
 * from utils/enterpriseVolumes.js. Only builds the period/line lookups: the NET
 * calculation stays at each call site because they differ on purpose (trends and
 * night report clamp with Math.max(0, …); the chart overlay and Excel export
 * show the raw line − enterprise difference).
 */
import { enterpriseApi, streamEnterpriseVolumes, type EnterpriseRecord } from '@/api/enterprise'

export type PeriodType = 'daily' | 'hourly'

/**
 * Normalize a period to the key joining enterprise records with archive rows.
 * Hourly → "YYYY-MM-DDTHH" (13 chars), daily → "YYYY-MM-DD" (10).
 */
export function enterprisePeriodKey(period: unknown, periodType: PeriodType): string {
  const raw = String(period || '').replace(' ', 'T')
  return periodType === 'hourly' ? raw.slice(0, 13) : raw.slice(0, 10)
}

interface RecordWithDevices extends EnterpriseRecord {
  total_volume?: number | null
  devices?: { volume?: number }[]
}

/** Total enterprise volume of one record (API `total_volume` or device sum). */
export function enterpriseRecordTotal(record: RecordWithDevices | undefined): number {
  if (record && record.total_volume !== undefined && record.total_volume !== null) {
    return record.total_volume
  }
  return (record?.devices ?? []).reduce((sum, d) => sum + (d.volume || 0), 0)
}

/**
 * Fetch enterprise volumes over the NDJSON progress stream, falling back to the
 * plain GET when the stream transport itself is unavailable.
 *
 * `includeDevices` controls response size, not the data source: a month of
 * hourly data with per-device breakdowns is ~18 MB. Totals-only consumers
 * (chart overlay) keep false; breakdown consumers (Excel, poll page) pass true.
 */
export function getEnterpriseFetchFn(
  isVirtualLine: boolean,
  { includeDevices = false }: { includeDevices?: boolean } = {},
) {
  return async (
    lines: number[],
    from: string,
    to: string,
    type: PeriodType,
    onProgress?: (p: { done?: number; total?: number; phase?: string }) => void,
  ): Promise<EnterpriseRecord[]> => {
    const params = {
      line_id: lines,
      from_date: from,
      to_date: to,
      period_type: type,
      virtual: isVirtualLine || undefined,
      include_devices: includeDevices ? undefined : false,
    }
    try {
      return await streamEnterpriseVolumes(params, { onProgress })
    } catch (err) {
      const e = err as Error & { fallback?: boolean }
      if (!e.fallback) throw e
      return isVirtualLine ? enterpriseApi.getVolumesVirtual(params) : enterpriseApi.getVolumes(params)
    }
  }
}

/** Enterprise totals keyed by line then period: { lineId: { periodKey: total } }. */
export function buildEnterpriseByLinePeriod(
  records: EnterpriseRecord[] | undefined,
  periodType: PeriodType,
): Record<number, Record<string, number>> {
  const map: Record<number, Record<string, number>> = {}
  for (const entry of records ?? []) {
    const lid = entry.line_id as number
    const key = enterprisePeriodKey(entry.period, periodType)
    if (!map[lid]) map[lid] = {}
    map[lid][key] = enterpriseRecordTotal(entry)
  }
  return map
}

/**
 * Enterprise totals keyed by period, summed across all lines/devices. Used by
 * the archive chart overlay, which shows one aggregate series.
 */
export function buildEnterpriseByPeriod(
  records: EnterpriseRecord[] | undefined,
  periodType: PeriodType,
): Record<string, number> {
  const map: Record<string, number> = {}
  for (const entry of records ?? []) {
    const key = enterprisePeriodKey(entry.period, periodType)
    map[key] = (map[key] || 0) + enterpriseRecordTotal(entry)
  }
  return map
}
