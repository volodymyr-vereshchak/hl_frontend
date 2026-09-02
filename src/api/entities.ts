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

/**
 * Compact hourly archive: physical lines, rings and DPD lines in one answer.
 *
 * `rows` are [line_id, stampIdx, volume]; `stamps` holds each stamp once as
 * "YYYY-MM-DDTHH" — plant WALL-CLOCK time, the same key the enterprise
 * endpoint's periods reduce to. Deliberately not an instant: the two sides are
 * joined hour by hour, and an epoch would only line them up for a viewer whose
 * timezone matched the server's.
 */
export interface HourlyCompact {
  stamps: string[]
  rows: [number, number, number][]
}

// ── Archive data ──────────────────────────────────────────────────────────────
export const archiveDataApi = {
  getDailyData: (lineIds: number[], fromDate: string, toDate: string) =>
    api.get<HourlyRecord[]>('/daily/', { line_id: lineIds, from_date: fromDate, to_date: toDate }),
  getHourlyData: (lineIds: number[], fromDate: string, toDate: string) =>
    api.get<HourlyRecord[]>('/hourly/', { line_id: lineIds, from_date: fromDate, to_date: toDate }),

  /**
   * The three columns a bulk reader needs, for every kind of line at once.
   *
   * `/hourly/` sends all eight columns of every row through a response model
   * and two more full passes of the payload — a month over a branch cost 18 s
   * and 69 MB, of which the night report used three columns and nine hours of
   * the twenty-four. `hours` pushes that filter into the database.
   */
  getHourlyCompact: (
    lineIds: number[],
    fromDate: string,
    toDate: string,
    hours?: number[],
  ) =>
    api.get<HourlyCompact>('/hourly_compact/', {
      line_id: lineIds,
      from_date: fromDate,
      to_date: toDate,
      ...(hours?.length ? { hours } : {}),
    }),

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
  /** DPD lines only: the pressure unit the device reported, no line config. */
  press_unit?: string | null
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
  /**
   * Event codes to keep (sys_type_id / edit_type_id). EMPTY OR ABSENT MEANS NO
   * RESTRICTION — the filter narrows the server's own count as well as the
   * page, so the pagination keeps describing what the table actually shows.
   */
  typeIds?: number[]
}

/** Type filter, or nothing at all: `type_id=[]` would be read as "no filter"
 *  by FastAPI anyway, and an empty array in the query string is noise. */
const typeParam = (typeIds?: number[]) =>
  typeIds && typeIds.length ? { type_id: typeIds } : {}

function pagedParams(lineIds: number[], fromDate: string, toDate: string, o: PageOptions = {}) {
  return {
    line_id: lineIds,
    from_date: fromDate,
    to_date: toDate,
    skip: o.skip ?? 0,
    limit: o.limit ?? 50,
    order_by: o.orderBy ?? 'period',
    order_dir: o.orderDir ?? 'asc',
    ...typeParam(o.typeIds),
  }
}

/** One event code present in a period, with how many rows carry it. */
export interface TypeCount {
  type_id: number
  name: string
  count: number
}

export interface CountRow {
  line_id?: number
  period?: string
  hour_group?: string
  record_count?: number
}

/** Hourly counts of interventions (И) and alarms (А) for the archive table. */
export const archiveCountsApi = {
  getEditCounts: (lineIds: number[], fromDate: string, toDate: string) =>
    api.get<CountRow[]>('/edit_counts/', { line_id: lineIds, from_date: fromDate, to_date: toDate }),
  getSysCounts: (lineIds: number[], fromDate: string, toDate: string) =>
    api.get<CountRow[]>('/sys_counts/', { line_id: lineIds, from_date: fromDate, to_date: toDate }),
}

/**
 * Every event of a period, in the shape the accidents report reads.
 *
 * `rows` are tuples — [line_id, epoch ms, sys_type_id, volume, name index] —
 * and the name each index points at is in `names`. A month over every line is
 * ~435 000 events: as ordinary objects that is 160 MB of mostly repeated names
 * and ISO timestamps, and this is 21 MB of the same data.
 */
export interface SysEventsPayload {
  names: string[]
  rows: [number, number, number, number, number][]
}

export const sysArchiveApi = {
  getData: (lineIds: number[], fromDate: string, toDate: string, typeIds?: number[]) =>
    api.get<ArchiveRow[]>('/sys/', {
      line_id: lineIds,
      from_date: fromDate,
      to_date: toDate,
      ...typeParam(typeIds),
    }),
  /** Options for the table's type filter: the codes this period holds. */
  getTypeCounts: (lineIds: number[], fromDate: string, toDate: string) =>
    api.get<TypeCount[]>('/sys/type_counts/', {
      line_id: lineIds,
      from_date: fromDate,
      to_date: toDate,
    }),
  getEvents: (lineIds: number[], fromDate: string, toDate: string) =>
    api.get<SysEventsPayload>('/sys/events/', {
      line_id: lineIds,
      from_date: fromDate,
      to_date: toDate,
    }),
  getPaged: (lineIds: number[], fromDate: string, toDate: string, o?: PageOptions) =>
    api.get<PagedResult>('/sys/paged/', pagedParams(lineIds, fromDate, toDate, o)),
}

export const editArchiveApi = {
  getData: (lineIds: number[], fromDate: string, toDate: string, typeIds?: number[]) =>
    api.get<ArchiveRow[]>('/edit/', {
      line_id: lineIds,
      from_date: fromDate,
      to_date: toDate,
      ...typeParam(typeIds),
    }),
  getTypeCounts: (lineIds: number[], fromDate: string, toDate: string) =>
    api.get<TypeCount[]>('/edit/type_counts/', {
      line_id: lineIds,
      from_date: fromDate,
      to_date: toDate,
    }),
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
  /**
   * Gas-composition parameters.
   *
   * Three ways to ask, and the endpoint answers differently for each:
   *   - no dates → the current configuration, one record per line (the
   *     overview reads min_dp/max_dp from this);
   *   - `toDate` alone → the configuration AS OF that moment: the last record
   *     not later than it, which is what the flow calculator needs to
   *     reconstruct a past measurement;
   *   - both dates → the last record inside the range, or nothing when the
   *     line has no record there (the parameters archive).
   */
  async getParamsForLines(
    lineIds: number[],
    fromDate?: string,
    toDate?: string,
  ): Promise<ParamRecord[]> {
    if (!lineIds || lineIds.length === 0) return []
    try {
      const range = toDate
        ? fromDate
          ? { from_date: fromDate, to_date: toDate }
          : { to_date: toDate }
        : {}
      const result = await api.get<ParamRecord[]>('/param/', { line_id: lineIds, ...range })
      return Array.isArray(result) ? result : []
    } catch {
      return []
    }
  },
}
