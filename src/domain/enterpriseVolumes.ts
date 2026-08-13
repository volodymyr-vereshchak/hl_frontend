/**
 * Shared helpers for the enterprise (промисловість) volume overlay — ported
 * from utils/enterpriseVolumes.js. Only builds the period/line lookups: the NET
 * calculation stays at each call site because they differ on purpose (trends and
 * night report clamp with Math.max(0, …); the chart overlay and Excel export
 * show the raw line − enterprise difference).
 */
import {
  enterpriseApi,
  streamEnterpriseVolumes,
  type EnterpriseDeviceVolume,
  type EnterpriseRecord,
} from '@/api/enterprise'

export type PeriodType = 'daily' | 'hourly'

/**
 * Normalize a period to the key joining enterprise records with archive rows.
 * Hourly → "YYYY-MM-DDTHH" (13 chars), daily → "YYYY-MM-DD" (10).
 */
export function enterprisePeriodKey(period: unknown, periodType: PeriodType): string {
  const raw = String(period || '').replace(' ', 'T')
  return periodType === 'hourly' ? raw.slice(0, 13) : raw.slice(0, 10)
}

/** Total enterprise volume of one record (API `total_volume` or device sum). */
export function enterpriseRecordTotal(record: EnterpriseRecord | undefined): number {
  if (record && record.total_volume !== undefined && record.total_volume !== null) {
    return record.total_volume
  }
  return (record?.devices ?? []).reduce((sum, d) => sum + (d.volume || 0), 0)
}

/** Column label of a device: its enterprise, else something identifying. */
export function enterpriseDeviceLabel(device: EnterpriseDeviceVolume): string {
  const name = device.enterprise_name?.trim()
  if (name) return name
  return device.serNum != null ? `S/N ${device.serNum}` : 'Без назви'
}

export interface EnterpriseBreakdown {
  /** Sorted enterprise names — one spreadsheet column each. */
  names: string[]
  /** periodKey → { enterpriseName: volume }; null = that device was not polled. */
  byPeriod: Map<string, Record<string, number | null>>
}

/**
 * Per-enterprise breakdown for the Excel export: which enterprises appear at
 * all, and how much each consumed in every period.
 *
 * Null and zero are NOT interchangeable here. A device that was never polled
 * contributes null (exported as an empty cell); a device polled with no
 * consumption contributes 0. Collapsing both to 0 made an unreachable corrector
 * look like an idle one.
 */
export function buildEnterpriseBreakdown(
  records: EnterpriseRecord[] | undefined,
  periodType: PeriodType,
): EnterpriseBreakdown {
  const names = new Set<string>()
  const byPeriod = new Map<string, Record<string, number | null>>()

  for (const record of records ?? []) {
    const key = enterprisePeriodKey(record.period, periodType)
    let entry = byPeriod.get(key)
    if (!entry) {
      entry = {}
      byPeriod.set(key, entry)
    }
    for (const device of record.devices ?? []) {
      const label = enterpriseDeviceLabel(device)
      names.add(label)
      if (device.volume != null) {
        // Several devices can belong to one enterprise — they add up.
        entry[label] = (entry[label] ?? 0) + device.volume
      } else if (entry[label] === undefined) {
        entry[label] = null
      }
      // Already has a number from a sibling device: a partial poll must not
      // wipe what did come back.
    }
  }

  return { names: [...names].sort(), byPeriod }
}

/**
 * Column order of the breakdown export: NET and the enterprise total come
 * FIRST, right after the line's own columns, and only then one column per
 * enterprise.
 *
 * The enterprise set differs from line to line and is sorted by name, so with
 * the per-enterprise columns in front the two numbers people actually compare
 * landed in a different spreadsheet column for every line. Fixed positions are
 * the whole point. This is also the order the on-screen table uses
 * (ArchiveTable adds netVolume then totalEnterprise), so file and screen agree.
 */
export function breakdownHeader(lineLabels: string[], enterpriseNames: string[]): string[] {
  return [
    ...lineLabels,
    'NET (лінія − підприємства)',
    'Разом підприємства',
    ...enterpriseNames,
  ]
}

/**
 * One exported row in that order. `lineCells` is the already-formatted line
 * part; `volume` is the line volume NET is measured against.
 *
 * The total is summed from the per-enterprise cells rather than taken from the
 * API, so the row always adds up on screen — an unpolled enterprise is an empty
 * cell and contributes nothing.
 */
export function breakdownRow(
  lineCells: (string | number)[],
  volume: unknown,
  enterpriseNames: string[],
  entry: Record<string, number | null> | undefined,
): (string | number)[] {
  // Unpolled periods stay blank rather than reading as a measured zero.
  const perEnterprise = enterpriseNames.map((name) => entry?.[name] ?? '')
  const totalEnt = perEnterprise.reduce<number>((s, v) => s + (typeof v === 'number' ? v : 0), 0)
  const net = (Number(volume) || 0) - totalEnt
  return [...lineCells, net, totalEnt, ...perEnterprise]
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
