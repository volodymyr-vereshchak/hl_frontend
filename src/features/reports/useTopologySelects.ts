import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { branchApi, lumgApi, lineApi, gasVolumeApi } from '@/api/entities'
import { TOPOLOGY_KEYS } from '@/lib/topologyKeys'

/**
 * Flat topology for the cascading report selectors (branch → calc → line).
 * Everything is loaded once and filtered client-side, mirroring the old
 * AccidentsPage, so "all branches / all calcs / all lines" stay available.
 */
export function useTopologySelects(branchId: string, calcId: string) {
  const query = useQuery({
    queryKey: TOPOLOGY_KEYS.reportTopology,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [branches, lumgs, calcs, lines] = await Promise.all([
        branchApi.getAll(),
        lumgApi.getAll(),
        gasVolumeApi.getAll(),
        lineApi.getAll(),
      ])
      return { branches, lumgs, calcs, lines }
    },
  })

  const { branches = [], lumgs = [], calcs = [], lines = [] } = query.data ?? {}

  const filteredCalcs = useMemo(() => {
    if (!branchId) return calcs
    const lumgIds = lumgs.filter((l) => String(l.branch_id) === branchId).map((l) => l.id)
    return calcs.filter((c) => lumgIds.includes(c.lumg_id))
  }, [branchId, calcs, lumgs])

  const filteredLines = useMemo(() => {
    if (calcId) return lines.filter((l) => String(l.gas_volume_calc_id) === calcId)
    if (branchId) {
      const calcIds = new Set(filteredCalcs.map((c) => c.id))
      return lines.filter((l) => l.gas_volume_calc_id != null && calcIds.has(l.gas_volume_calc_id))
    }
    return lines
  }, [calcId, branchId, lines, filteredCalcs])

  return {
    ...query,
    branches,
    lumgs,
    calcs: filteredCalcs,
    lines: filteredLines,
    // Unfiltered, for resolving a line's calc/LUMG/branch names in the results:
    // the report may show lines outside the current selector scope.
    allCalcs: calcs,
    allLines: lines,
  }
}
