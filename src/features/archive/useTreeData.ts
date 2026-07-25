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
import type { LineMeta } from '@/store/selectionStore'

export interface TreeLine {
  id: number
  name: string
  kind: LineKind
  meta: LineMeta
}

export interface TreeCalc {
  id: number
  name: string
  typeName: string | null
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
    queryKey: ['tree'],
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
        const tl: TreeLine = {
          id: l.id,
          name: l.name || `l${l.line ?? l.id}`,
          kind: 'physical',
          meta: {
            kind: 'physical',
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
        const tl: TreeLine = { id: v.id, name: v.name, kind: 'virtual', meta: { kind: 'virtual' } }
        if (!virtualByLumg.has(lumgId)) virtualByLumg.set(lumgId, [])
        virtualByLumg.get(lumgId)!.push(tl)
      }
      const dpdByLumg = new Map<number, TreeLine[]>()
      for (const d of dpds) {
        const lumgId = d.lumg_id ?? (d.branch_id != null ? firstLumgOfBranch(d.branch_id) : null)
        if (lumgId == null) continue
        const tl: TreeLine = { id: d.id, name: d.name, kind: 'dpd', meta: { kind: 'dpd' } }
        if (!dpdByLumg.has(lumgId)) dpdByLumg.set(lumgId, [])
        dpdByLumg.get(lumgId)!.push(tl)
      }

      const lumgById = new Map(lumgs.map((l) => [l.id, l]))
      return branches
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
    },
  })
}
