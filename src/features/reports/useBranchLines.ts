import { useQuery } from '@tanstack/react-query'
import { branchApi, lumgApi, lineApi, virtualLineApi, dpdLineApi } from '@/api/entities'
import type { Line, VirtualLine, DpdLine } from '@/types'

export interface ReportLine {
  id: number
  name: string
  kind: 'physical' | 'virtual' | 'dpd'
  include_in_report?: boolean
  include_in_trends?: boolean
}

/**
 * Branch list plus every line (physical + virtual + DPD) of the selected
 * branch — the shared selection source for all report screens.
 */
export function useBranches() {
  return useQuery({ queryKey: ['branches'], queryFn: branchApi.getAll, staleTime: 5 * 60_000 })
}

export function useBranchLines(branchId: number | null) {
  return useQuery({
    queryKey: ['report-lines', branchId],
    enabled: branchId != null,
    staleTime: 60_000,
    queryFn: async (): Promise<ReportLine[]> => {
      const lumgs = await lumgApi.getAll()
      const branchLumgs = lumgs.filter((l) => l.branch_id === branchId)

      const [physicalGroups, virtuals, dpds] = await Promise.all([
        Promise.all(branchLumgs.map((l) => lineApi.getByLumg(l.id).catch((): Line[] => []))),
        virtualLineApi.getByBranch(branchId!).catch((): VirtualLine[] => []),
        dpdLineApi.getByBranch(branchId!).catch((): DpdLine[] => []),
      ])

      const physical: ReportLine[] = physicalGroups.flat().map((l) => ({
        id: l.id,
        name: l.name,
        kind: 'physical',
        include_in_report: l.include_in_report,
        include_in_trends: l.include_in_trends,
      }))
      const virtual: ReportLine[] = virtuals.map((v) => ({
        id: v.id,
        name: v.name,
        kind: 'virtual',
        include_in_report: v.include_in_report,
        include_in_trends: v.include_in_trends,
      }))
      const dpd: ReportLine[] = dpds
        .filter((d) => d.active !== false)
        .map((d) => ({
          id: d.id,
          name: d.name,
          kind: 'dpd',
          include_in_report: d.include_in_report,
          include_in_trends: d.include_in_trends,
        }))

      return [...physical, ...virtual, ...dpd]
    },
  })
}
