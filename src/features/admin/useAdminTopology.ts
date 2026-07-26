import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { branchAdminApi, lumgAdminApi, calcAdminApi, lineAdminApi } from '@/api/admin'
import type { Branch, Lumg, GasVolumeCalc, Line } from '@/types'

/**
 * Branch → ЛУМГ → обчислювач → лінія, loaded once and shared by the admin tabs.
 * Everything is small enough to filter client-side, which is what makes the
 * cascading selectors (branch narrows calcs, calc narrows lines) instant.
 */
export function useAdminTopology() {
  const branches = useQuery({ queryKey: ['admin', 'branches'], queryFn: branchAdminApi.getAll })
  const lumgs = useQuery({ queryKey: ['admin', 'lumgs'], queryFn: lumgAdminApi.getAll })
  const calcs = useQuery({ queryKey: ['admin', 'calcs'], queryFn: calcAdminApi.getAll })
  const lines = useQuery({ queryKey: ['admin', 'lines'], queryFn: () => lineAdminApi.getAll() })

  const branchList: Branch[] = useMemo(() => branches.data ?? [], [branches.data])
  const lumgList: Lumg[] = useMemo(() => lumgs.data ?? [], [lumgs.data])
  const calcList: GasVolumeCalc[] = useMemo(() => calcs.data ?? [], [calcs.data])
  const lineList: Line[] = useMemo(() => lines.data ?? [], [lines.data])

  const branchName = useMemo(() => {
    const m = new Map(branchList.map((b) => [b.id, b.name]))
    return (id?: number | null) => (id == null ? '—' : (m.get(id) ?? String(id)))
  }, [branchList])

  const lumgName = useMemo(() => {
    const m = new Map(lumgList.map((l) => [l.id, l.name]))
    return (id?: number | null) => (id == null ? '—' : (m.get(id) ?? String(id)))
  }, [lumgList])

  const calcName = useMemo(() => {
    const m = new Map(calcList.map((c) => [c.id, c.name || `#${c.id}`]))
    return (id?: number | null) => (id == null ? '—' : (m.get(id) ?? String(id)))
  }, [calcList])

  /** ЛУМГ ids of a branch, for narrowing calcs. */
  const lumgIdsOfBranch = useMemo(() => {
    const m = new Map<number, number[]>()
    for (const l of lumgList) {
      if (l.branch_id == null) continue
      m.set(l.branch_id, [...(m.get(l.branch_id) ?? []), l.id])
    }
    return (branchId: number) => m.get(branchId) ?? []
  }, [lumgList])

  /** Calc ids of a branch, for narrowing lines. */
  const calcIdsOfBranch = useMemo(() => {
    return (branchId: number) => {
      const ids = new Set(lumgIdsOfBranch(branchId))
      return calcList.filter((c) => c.lumg_id != null && ids.has(c.lumg_id)).map((c) => c.id)
    }
  }, [calcList, lumgIdsOfBranch])

  /** The branch a line belongs to, resolved through its calc's ЛУМГ. */
  const branchOfLine = useMemo(() => {
    const calcToLumg = new Map(calcList.map((c) => [c.id, c.lumg_id]))
    const lumgToBranch = new Map(lumgList.map((l) => [l.id, l.branch_id]))
    return (line: Line): number | null => {
      const lumgId = line.gas_volume_calc_id != null ? calcToLumg.get(line.gas_volume_calc_id) : null
      return lumgId != null ? (lumgToBranch.get(lumgId) ?? null) : null
    }
  }, [calcList, lumgList])

  return {
    branches: branchList,
    lumgs: lumgList,
    calcs: calcList,
    lines: lineList,
    branchName,
    lumgName,
    calcName,
    lumgIdsOfBranch,
    calcIdsOfBranch,
    branchOfLine,
    isLoading: branches.isLoading || lumgs.isLoading || calcs.isLoading || lines.isLoading,
  }
}

/** `<Select>` option list helper. */
export const toOptions = <T extends { id: number; name?: string }>(items: T[]) =>
  items.map((i) => ({ value: String(i.id), label: i.name || `#${i.id}` }))
