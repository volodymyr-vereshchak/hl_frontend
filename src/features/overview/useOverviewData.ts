import { useQuery } from '@tanstack/react-query'
import {
  branchApi,
  lumgApi,
  lineApi,
  dpdLineApi,
  paramArchiveApi,
  archiveDataApi,
} from '@/api/entities'
import {
  OverviewCalculator,
  type HourlyRecord,
  type ParamsMap,
  type PressureReading,
  type VolumeComparison,
  type FlowComparison,
  type LineVolumeComparison,
} from '@/domain/overviewCalculator'
import type { Line } from '@/types'

export interface LumgGroup {
  lumgId: number
  lumgName: string
  lineIds: number[]
}

export interface OverviewData {
  totalVolume24h: number
  volumeComparison: VolumeComparison
  flowComparisons: FlowComparison[]
  volumeComparisons: LineVolumeComparison[]
  pressures: Record<number, PressureReading>
  lineNames: Record<number, string>
  lumgGroups: LumgGroup[]
  activeLines: number
  totalLines: number
  currentPeriod: { start: Date; end: Date }
}

const fmtDate = (d: Date) => d.toISOString().split('T')[0]
const maxTs = (rows: HourlyRecord[]): number | null => {
  const ts = rows.map((r) => (r.period ? new Date(r.period).getTime() : NaN)).filter((t) => !isNaN(t))
  return ts.length ? Math.max(...ts) : null
}

/** Branches + lumgs, loaded once (topology is stable). */
export function useTopology() {
  return useQuery({
    queryKey: ['topology'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [branches, lumgs] = await Promise.all([branchApi.getAll(), lumgApi.getAll()])
      return { branches, lumgs }
    },
  })
}

/**
 * Overview metrics for a branch — ported from the old useOverviewData.loadData:
 * load report lines (physical + DPD), dP params, and last-24h hourly data, then
 * compute totals/comparisons/pressures via OverviewCalculator.
 */
export function useOverviewData(branchId: number | null) {
  const topology = useTopology()
  const lumgs = topology.data?.lumgs ?? []

  const query = useQuery({
    queryKey: ['overview', branchId],
    enabled: branchId != null && topology.isSuccess,
    queryFn: async (): Promise<OverviewData> => {
      const branchLumgIds = lumgs.filter((l) => l.branch_id === branchId).map((l) => l.id)
      if (branchLumgIds.length === 0) throw new Error('Немає ЛУМГ для філії')

      const lineToLumg: Record<number, number> = {}
      const linesResponses = await Promise.all(
        branchLumgIds.map(async (lumgId) => {
          const arr = await lineApi.getByLumg(lumgId)
          arr.forEach((line) => (lineToLumg[line.id] = lumgId))
          return arr
        }),
      )
      let lines: Line[] = linesResponses.flat().filter((l) => (l as { include_in_report?: boolean }).include_in_report)
      const physReportIds = lines.map((l) => l.id)

      // DPD report lines join next to physical ones.
      const dpdAll = await dpdLineApi.getByBranch(branchId!).catch(() => [])
      const dpdReportLines = dpdAll.filter((l) => l.include_in_report && l.active !== false)
      dpdReportLines.forEach((dl) => {
        lineToLumg[dl.id] =
          dl.lumg_id && branchLumgIds.includes(dl.lumg_id) ? dl.lumg_id : branchLumgIds[0]
      })
      const dpdReportIds = dpdReportLines.map((l) => l.id)
      lines = [...lines, ...(dpdReportLines as unknown as Line[])]
      const reportLineIds = [...physReportIds, ...dpdReportIds]
      if (reportLineIds.length === 0) throw new Error('Немає ліній для звіту в цій філії')

      // dP params.
      const paramsMap: ParamsMap = {}
      try {
        const paramsData = await paramArchiveApi.getParamsForLines(physReportIds)
        paramsData.forEach((p) => {
          if (p && p.line_id != null) {
            paramsMap[p.line_id] = { min_dp: p.min_dp || 0, max_dp: p.max_dp || 100 }
          }
        })
      } catch {
        /* defaults */
      }

      const dpdWindow = (() => {
        const now = new Date()
        return { from: fmtDate(new Date(now.getTime() - 3 * 864e5)), to: fmtDate(new Date(now.getTime() + 2 * 864e5)) }
      })()
      const [physHourly, dpdHourly] = await Promise.all([
        physReportIds.length ? archiveDataApi.getHourlyDataLast24h(physReportIds) : Promise.resolve([]),
        dpdReportIds.length
          ? dpdLineApi.getHourlyData(dpdReportIds, dpdWindow.from, dpdWindow.to).catch(() => [])
          : Promise.resolve([]),
      ])
      const allHourlyData: HourlyRecord[] = [...physHourly, ...dpdHourly]
      if (allHourlyData.length === 0) throw new Error('Немає даних за останні 24 години')

      const physEndMs = maxTs(physHourly)
      const dpdEndMs = maxTs(dpdHourly)
      if (physEndMs === null && dpdEndMs === null) throw new Error('Не вдалося визначити часові межі')

      // Per-line 24h windows anchored on each line's own latest record.
      const window24 = (rows: HourlyRecord[], endMs: number | null) => {
        if (endMs === null) return { current: [] as HourlyRecord[], previous: [] as HourlyRecord[] }
        const currentStartMs = endMs - 23 * 36e5
        const previousEndMs = currentStartMs - 36e5
        const previousStartMs = previousEndMs - 23 * 36e5
        const current: HourlyRecord[] = []
        const previous: HourlyRecord[] = []
        for (const r of rows) {
          const ts = new Date(r.period).getTime()
          if (ts >= currentStartMs && ts <= endMs) current.push(r)
          else if (ts >= previousStartMs && ts <= previousEndMs) previous.push(r)
        }
        return { current, previous }
      }
      const rowsByLine = new Map<number, HourlyRecord[]>()
      for (const r of allHourlyData) {
        if (!rowsByLine.has(r.line_id)) rowsByLine.set(r.line_id, [])
        rowsByLine.get(r.line_id)!.push(r)
      }
      const last24hData: HourlyRecord[] = []
      const previous24hData: HourlyRecord[] = []
      for (const rows of rowsByLine.values()) {
        const win = window24(rows, maxTs(rows))
        last24hData.push(...win.current)
        previous24hData.push(...win.previous)
      }

      const currentEnd = new Date(physEndMs ?? dpdEndMs!)
      const currentStart = new Date(currentEnd.getTime() - 23 * 36e5)

      const lineNames: Record<number, string> = {}
      lines.forEach((l) => (lineNames[l.id] = l.name || `Лінія ${l.id}`))

      const lumgNameById: Record<number, string> = {}
      lumgs.forEach((l) => (lumgNameById[l.id] = l.name))
      const lumgGroups: LumgGroup[] = branchLumgIds
        .map((lumgId) => ({
          lumgId,
          lumgName: lumgNameById[lumgId] || `ЛУМГ ${lumgId}`,
          lineIds: lines.filter((l) => lineToLumg[l.id] === lumgId).map((l) => l.id),
        }))
        .filter((g) => g.lineIds.length > 0)

      const currentTotal = OverviewCalculator.calculate24hTotal(last24hData, reportLineIds)
      const previousTotal = OverviewCalculator.calculate24hTotal(previous24hData, reportLineIds)
      const volumeComparison = OverviewCalculator.calculateComparison(currentTotal, previousTotal)
      const flowComparisons = OverviewCalculator.calculateLastHourFlow(allHourlyData, reportLineIds)
      const volumeComparisons = OverviewCalculator.calculate24hVolumeByLine(
        last24hData,
        previous24hData,
        reportLineIds,
      )
      const pressures = OverviewCalculator.getLastPressures(allHourlyData, reportLineIds, lines, paramsMap)

      const activeAnchorMs = physEndMs ?? dpdEndMs
      const activeLines = Object.values(pressures).filter(
        (p) =>
          activeAnchorMs !== null &&
          p.timestamp &&
          Math.abs(new Date(p.timestamp).getTime() - activeAnchorMs) < 60_000,
      ).length

      return {
        totalVolume24h: currentTotal,
        volumeComparison,
        flowComparisons,
        volumeComparisons,
        pressures,
        lineNames,
        lumgGroups,
        activeLines,
        totalLines: reportLineIds.length,
        currentPeriod: { start: currentStart, end: currentEnd },
      }
    },
  })

  return { topology, ...query }
}
