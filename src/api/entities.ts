import { api } from '@/lib/apiClient'
import { grsConfig } from '@/domain/grsConfig'
import type { HourlyRecord } from '@/domain/overviewCalculator'
import type { Branch, Lumg, Line, GasVolumeCalc, CalcType, VirtualLine, DpdLine } from '@/types'

// ── Topology ────────────────────────────────────────────────────────────────
export const branchApi = {
  getAll: () => api.get<Branch[]>('/grmu_branch/'),
}

export const lumgApi = {
  getAll: () => api.get<Lumg[]>('/lumgs/'),
}

export const lineApi = {
  getAll: () => api.get<Line[]>('/lines/'),
  getByLumg: (lumgId: number) => api.get<Line[]>('/lines/', { lumg_id: lumgId }),
}

export const gasVolumeApi = {
  getAll: () => api.get<GasVolumeCalc[]>('/gas-volume-calcs/'),
}

export const calcTypeApi = {
  getAll: () => api.get<CalcType[]>('/gas-volume-calc-types/'),
}

export const virtualLineApi = {
  getVisible: () => api.get<VirtualLine[]>('/virtual_lines/visible'),
  getByBranch: (branchId: number, trendsOnly = false) =>
    api.get<VirtualLine[]>('/virtual_lines/', {
      branch_id: branchId,
      ...(trendsOnly ? { include_in_trends: true } : {}),
    }),
}

export const dpdLineApi = {
  getAll: () => api.get<DpdLine[]>('/dpd_lines/'),
  getByBranch: (branchId: number, trendsOnly = false) =>
    api.get<DpdLine[]>('/dpd_lines/', {
      branch_id: branchId,
      ...(trendsOnly ? { include_in_trends: true } : {}),
    }),
  getDailyData: (lineIds: number[], fromDate: string, toDate: string) =>
    api.get<HourlyRecord[]>('/daily_dpd/', { line_id: lineIds, from_date: fromDate, to_date: toDate }),
  getHourlyData: (lineIds: number[], fromDate: string, toDate: string) =>
    api.get<HourlyRecord[]>('/hourly_dpd/', { line_id: lineIds, from_date: fromDate, to_date: toDate }),
}

// ── Archive data ──────────────────────────────────────────────────────────────
export const archiveDataApi = {
  getDailyData: (lineIds: number[], fromDate: string, toDate: string) =>
    api.get<HourlyRecord[]>('/daily/', { line_id: lineIds, from_date: fromDate, to_date: toDate }),
  getHourlyData: (lineIds: number[], fromDate: string, toDate: string) =>
    api.get<HourlyRecord[]>('/hourly/', { line_id: lineIds, from_date: fromDate, to_date: toDate }),

  async getLastPeriod(lineIds: number[] = []): Promise<Date | null> {
    const result = await api.get<{ last_period?: string }>(
      '/hourly_last_period/',
      lineIds.length ? { line_id: lineIds } : undefined,
    )
    return result?.last_period ? new Date(result.last_period) : null
  },

  async getHourlyDataLast24h(lineIds: number[] = grsConfig.LINES_IDS): Promise<HourlyRecord[]> {
    try {
      const lastPeriod = await this.getLastPeriod(lineIds)
      const anchor = lastPeriod || new Date()
      const endDate = new Date(anchor.getTime() + 2 * 864e5).toISOString().split('T')[0]
      const startDate = new Date(anchor.getTime() - 3 * 864e5).toISOString().split('T')[0]
      const result = await this.getHourlyData(lineIds, startDate, endDate)
      return result && result.length > 0 ? result : []
    } catch (error) {
      console.error('Error in getHourlyDataLast24h:', error)
      return []
    }
  },
}

export const archiveDataVirtualApi = {
  getDailyData: (lineIds: number[], fromDate: string, toDate: string) =>
    api.get<HourlyRecord[]>('/daily_virtual/', { line_id: lineIds, from_date: fromDate, to_date: toDate }),
  getHourlyData: (lineIds: number[], fromDate: string, toDate: string) =>
    api.get<HourlyRecord[]>('/hourly_virtual/', { line_id: lineIds, from_date: fromDate, to_date: toDate }),
}

export interface ArchiveRow {
  line_id?: number
  period: string
  volume?: number
  w_volume_dp?: number
  pressure?: number
  output_pressure?: number
  temperature?: number
  density?: number
  edit_counts?: number
  sys_counts?: number
  edit_name?: string
  sys_name?: string
  old_value?: number | string
  new_value?: number | string
  [key: string]: number | string | null | undefined
}

export interface PagedResult {
  total: number
  items: ArchiveRow[]
}

export interface PageOptions {
  skip?: number
  limit?: number
  orderBy?: string
  orderDir?: 'asc' | 'desc'
}

function pagedParams(lineIds: number[], fromDate: string, toDate: string, o: PageOptions = {}) {
  return {
    line_id: lineIds,
    from_date: fromDate,
    to_date: toDate,
    skip: o.skip ?? 0,
    limit: o.limit ?? 50,
    order_by: o.orderBy ?? 'period',
    order_dir: o.orderDir ?? 'asc',
  }
}

export const sysArchiveApi = {
  getData: (lineIds: number[], fromDate: string, toDate: string) =>
    api.get<ArchiveRow[]>('/sys/', { line_id: lineIds, from_date: fromDate, to_date: toDate }),
  getPaged: (lineIds: number[], fromDate: string, toDate: string, o?: PageOptions) =>
    api.get<PagedResult>('/sys/paged/', pagedParams(lineIds, fromDate, toDate, o)),
}

export const editArchiveApi = {
  getData: (lineIds: number[], fromDate: string, toDate: string) =>
    api.get<ArchiveRow[]>('/edit/', { line_id: lineIds, from_date: fromDate, to_date: toDate }),
  getPaged: (lineIds: number[], fromDate: string, toDate: string, o?: PageOptions) =>
    api.get<PagedResult>('/edit/paged/', pagedParams(lineIds, fromDate, toDate, o)),
}

export interface ParamRecord {
  line_id: number
  min_dp?: number
  max_dp?: number
  [key: string]: number | string | null | undefined
}

export const paramArchiveApi = {
  async getParamsForLines(lineIds: number[]): Promise<ParamRecord[]> {
    if (!lineIds || lineIds.length === 0) return []
    try {
      const result = await api.get<ParamRecord[]>('/param/', { line_id: lineIds })
      return Array.isArray(result) ? result : []
    } catch {
      return []
    }
  },
}
