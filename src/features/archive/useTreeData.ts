import { useQuery } from '@tanstack/react-query'
import {
  branchApi,
  lumgApi,
  lineApi,
  gasVolumeApi,
  calcTypeApi,
  virtualLineApi,
  dpdLineApi,
} from '@/api/entities'
import type { LineKind } from '@/types'
import type { GroupSelection, LineMeta } from '@/store/selectionStore'
import { TOPOLOGY_KEYS } from '@/lib/topologyKeys'

/** Context shown in the tree's selection panel. */
export interface LineInfo {
  branchName?: string
  lumgName?: string
  calcName?: string
  typeName?: string | null
  address?: string | number | null
  lineNo?: number | null
}

export interface TreeLine {
  id: number
  name: string
  kind: LineKind
  meta: LineMeta
  lineNo?: number | null
  info?: LineInfo
}

export interface TreeCalc {
  id: number
  name: string
  typeName: string | null
  address?: string | number | null
  lines: TreeLine[]
}

export interface TreeLumg {
  id: number
  name: string
  calcs: TreeCalc[]
  virtualLines: TreeLine[]
  dpdLines: TreeLine[]
}

export interface TreeBranch {
  id: number
  name: string
  lumgs: TreeLumg[]
}

export function useTreeData() {
  return useQuery({
    queryKey: TOPOLOGY_KEYS.tree,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TreeBranch[]> => {
      const [branches, lumgs, calcs, calcTypes, lines, virtuals, dpds] = await Promise.all([
        branchApi.getAll(),
        lumgApi.getAll(),
        gasVolumeApi.getAll(),
        calcTypeApi.getAll(),
        lineApi.getAll(),
        virtualLineApi.getVisible().catch(() => []),
        dpdLineApi.getAll().catch(() => []),
      ])

      const typeNameById = new Map(calcTypes.map((ct) => [ct.type_id, ct.type_name]))
      const linesByCalc = new Map<number, TreeLine[]>()
      for (const l of lines) {
        if (l.gas_volume_calc_id == null) continue
        const name = l.name || `l${l.line ?? l.id}`
        const tl: TreeLine = {
          id: l.id,
          name,
          kind: 'physical',
          lineNo: l.line ?? null,
          meta: {
            kind: 'physical',
            name,
            meter: l.meter,
            is_high_pressure: l.is_high_pressure,
            pressure_unit: l.pressure_unit,
            dp_unit: l.dp_unit,
          },
        }
        if (!linesByCalc.has(l.gas_volume_calc_id)) linesByCalc.set(l.gas_volume_calc_id, [])
        linesByCalc.get(l.gas_volume_calc_id)!.push(tl)
      }

      const calcsByLumg = new Map<number, TreeCalc[]>()
      for (const c of calcs) {
        const tc: TreeCalc = {
          id: c.id,
          name: c.name,
          typeName: c.type_id != null ? typeNameById.get(c.type_id) ?? null : null,
          address: c.address ?? null,
          lines: (linesByCalc.get(c.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
        }
        if (!calcsByLumg.has(c.lumg_id)) calcsByLumg.set(c.lumg_id, [])
        calcsByLumg.get(c.lumg_id)!.push(tc)
      }

      const lumgIdsByBranch = new Map<number, number[]>()
      for (const l of lumgs) {
        if (!lumgIdsByBranch.has(l.branch_id)) lumgIdsByBranch.set(l.branch_id, [])
        lumgIdsByBranch.get(l.branch_id)!.push(l.id)
      }
      const firstLumgOfBranch = (branchId: number) => lumgIdsByBranch.get(branchId)?.[0] ?? null

      // Virtual & DPD lines group under their lumg (or the branch's first lumg).
      const virtualByLumg = new Map<number, TreeLine[]>()
      for (const v of virtuals) {
        const lumgId = v.lumg_id ?? (v.branch_id != null ? firstLumgOfBranch(v.branch_id) : null)
        if (lumgId == null) continue
        const tl: TreeLine = {
          id: v.id,
          name: v.name,
          kind: 'virtual',
          meta: { kind: 'virtual', name: v.name },
        }
        if (!virtualByLumg.has(lumgId)) virtualByLumg.set(lumgId, [])
        virtualByLumg.get(lumgId)!.push(tl)
      }
      const dpdByLumg = new Map<number, TreeLine[]>()
      for (const d of dpds) {
        const lumgId = d.lumg_id ?? (d.branch_id != null ? firstLumgOfBranch(d.branch_id) : null)
        if (lumgId == null) continue
        const tl: TreeLine = {
          id: d.id,
          name: d.name,
          kind: 'dpd',
          meta: { kind: 'dpd', name: d.name },
        }
        if (!dpdByLumg.has(lumgId)) dpdByLumg.set(lumgId, [])
        dpdByLumg.get(lumgId)!.push(tl)
      }

      const lumgById = new Map(lumgs.map((l) => [l.id, l]))
      const tree = branches
        .map((b) => ({
          id: b.id,
          name: b.name,
          lumgs: (lumgIdsByBranch.get(b.id) ?? [])
            .map((lumgId): TreeLumg => ({
              id: lumgId,
              name: lumgById.get(lumgId)?.name ?? `ЛУМГ ${lumgId}`,
              calcs: (calcsByLumg.get(lumgId) ?? []).sort((a, b2) => a.name.localeCompare(b2.name)),
              virtualLines: virtualByLumg.get(lumgId) ?? [],
              dpdLines: dpdByLumg.get(lumgId) ?? [],
            }))
            .filter(
              (l) => l.calcs.length > 0 || l.virtualLines.length > 0 || l.dpdLines.length > 0,
            ),
        }))
        .filter((b) => b.lumgs.length > 0)

      // Attach the branch/lumg/calc context each line shows in the info panel.
      for (const branch of tree) {
        for (const lumg of branch.lumgs) {
          const base = { branchName: branch.name, lumgName: lumg.name }
          for (const calc of lumg.calcs) {
            for (const line of calc.lines) {
              line.info = {
                ...base,
                calcName: calc.name,
                typeName: calc.typeName,
                address: calc.address,
                lineNo: line.lineNo,
              }
            }
          }
          for (const line of [...lumg.virtualLines, ...lumg.dpdLines]) line.info = { ...base }
        }
      }
      return tree
    },
  })
}

/**
 * The lines a selected node stands for.
 *
 * PHYSICAL lines only. A кільце is itself a sum of physical lines, and a ДПД
 * line measures the same gas from the other side — including either would make
 * the node's total count the same gas twice.
 */
export function linesOfGroup(
  tree: TreeBranch[] | undefined,
  sel: GroupSelection | null,
): TreeLine[] {
  if (!tree || !sel) return []
  const fromLumg = (lumg: TreeLumg) => lumg.calcs.flatMap((c) => c.lines)

  for (const branch of tree) {
    if (sel.kind === 'branch' && branch.id === sel.id) {
      return branch.lumgs.flatMap(fromLumg)
    }
    for (const lumg of branch.lumgs) {
      if (sel.kind === 'lumg' && lumg.id === sel.id) return fromLumg(lumg)
      for (const calc of lumg.calcs) {
        if (sel.kind === 'calc' && calc.id === sel.id) return calc.lines
      }
    }
  }
  return []
}
