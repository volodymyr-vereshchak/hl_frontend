import { api } from '@/lib/apiClient'
import type { GasRoute } from '@/types'

/**
 * «Звірка ФХП». The response is COLUMNAR: every array in a block lines up with
 * `periods`, index for index. An hourly month over ten lines is ~22k points,
 * and objects-per-point would cost about four times the bytes.
 */
export interface FhpLineStats {
  n: number
  mean_delta: number
  mean_abs_delta: number
  max_abs_delta: number
  max_abs_delta_at: string
  mean_abs_delta_pct?: number | null
  max_abs_delta_pct?: number | null
  max_abs_delta_pct_at?: string | null
  out_of_tolerance: number
  out_of_tolerance_share: number
}

export interface FhpLineSeries {
  line_id: number
  line_name: string
  calc_name?: string | null
  is_reference: boolean
  status: 'ok' | 'no_data'
  values: (number | null)[]
  /** Absent for reference lines and for routes without a reference. */
  deltas?: (number | null)[] | null
  delta_pcts?: (number | null)[] | null
  /** The value in force at this period is older than `stale_after_hours`. */
  stale: boolean[]
  stats?: FhpLineStats | null
}

export interface FhpParamBlock {
  param: string
  label: string
  unit: string
  decimals: number
  tolerance: number
  tolerance_mode: 'abs' | 'pct'
  has_reference: boolean
  periods: string[]
  /** Daily granularity only; fewer than 24 means an incomplete day. */
  hours_present?: number[] | null
  reference?: (number | null)[] | null
  /** How many reference lines backed the reference at each period. */
  reference_count?: number[] | null
  spread_min: (number | null)[]
  spread_max: (number | null)[]
  spread: (number | null)[]
  lines: FhpLineSeries[]
  rejected_changes: number
}

/** One line's reported volume against what the reference gas would have given. */
export interface FhpVolumeLine {
  line_id: number
  line_name: string
  /** Лічильник vs діафрагма — a wrong composition costs them differently. */
  is_meter: boolean
  status: 'ok' | 'no_data'
  volume: (number | null)[]
  delta: (number | null)[]
  delta_pct: (number | null)[]
  total_volume?: number | null
  total_delta?: number | null
  total_delta_pct?: number | null
}

/**
 * ΔV = V_еталонний − V_звітний. Negative means the reported volume was
 * overstated. Absent for a route with no reference — nothing to correct to.
 */
export interface FhpVolumeBlock {
  periods: string[]
  lines: FhpVolumeLine[]
  total_delta?: number | null
  unit: string
}

export interface RouteFhpReport {
  route_id: number
  route_number: string
  route_name?: string | null
  branch_id: number
  granularity: 'hourly' | 'daily'
  date_from: string
  date_to: string
  contract_hour: number
  stale_after_hours: number
  /** How far the archive reaches — the moment the overview screen shows. */
  data_until?: string | null
  range_clipped_at?: string | null
  params: FhpParamBlock[]
  volume?: FhpVolumeBlock | null
  warnings: string[]
}

export interface FhpReportQuery {
  date_from: string
  date_to: string
  granularity?: 'hourly' | 'daily'
  tolerance_mode?: 'abs' | 'pct'
  stale_after_hours?: number
}

export const fhpReportApi = {
  routesOfBranch: (branchId: number) =>
    api.get<GasRoute[]>('/gas_routes/', { branch_id: branchId, active: true }),
  report: (routeId: number, query: FhpReportQuery) =>
    api.get<RouteFhpReport>(`/gas_routes/${routeId}/fhp_report`, { ...query }),
  /** Asked before a period is chosen, so the screen can say where data ends. */
  dataUntil: (routeId: number) =>
    api.get<{ data_until: string | null }>(`/gas_routes/${routeId}/data_until`),
}
