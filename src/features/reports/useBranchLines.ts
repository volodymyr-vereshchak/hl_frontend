import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { branchApi, lumgApi, lineApi, virtualLineApi, dpdLineApi } from '@/api/entities'
import { resolveBranchId } from '@/domain/branchSelection'
import { useSelectionStore } from '@/store/selectionStore'
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

/**
 * Keep the shared branch selection pointing at a branch that exists.
 *
 * Runs on every screen that shows the branch picker: the selection is persisted
 * and shared, so a stale id survives reloads and follows the user from screen
 * to screen until something reconciles it (see resolveBranchId). `branches`
 * being undefined means "not loaded yet" — never "none".
 */
export function useEnsureValidBranch<T extends { id: number }>(branches: T[] | undefined) {
  const { branchId, setBranchId } = useSelectionStore()
  useEffect(() => {
    if (!branches) return
    const next = resolveBranchId(branchId, branches)
    if (next !== branchId) setBranchId(next)
  }, [branches, branchId, setBranchId])
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
