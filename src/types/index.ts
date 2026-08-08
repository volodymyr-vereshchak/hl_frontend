/** Core domain types shared across features. Extend as screens are ported. */

export type UserRole = 'admin' | 'viewer'

export interface User {
  id?: number
  username: string
  /** Human name; the UI shows this and falls back to `username`. */
  display_name?: string | null
  role: UserRole
  active?: boolean
  /** Empty/absent = every branch. Non-empty = only these. */
  allowed_branch_ids?: number[] | null
}

export interface Branch {
  id: number
  name: string
  short_name?: string | null
  region?: string | null
  active?: boolean
}

export interface Lumg {
  id: number
  name: string
  branch_id: number
}

export interface GasVolumeCalc {
  id: number
  name: string
  lumg_id: number
  type_id?: number | null
  address?: string | number | null
  /** Poll cycle from the HostLib config. Stored, never read; the API defaults it. */
  c_time?: number
}

export interface CalcType {
  id: number
  type_id: number
  type_name: string
}

/** A physical metering line. Virtual/DPD lines reuse the same id space via flags. */
export interface Line {
  id: number
  name: string
  line?: number
  gas_volume_calc_id?: number | null
  lumg_id?: number | null
  meter?: boolean
  include_in_report?: boolean
  include_in_trends?: boolean
  is_high_pressure?: boolean
  pressure_unit?: string | null
  dp_unit?: string | null
}

/**
 * A "кільце" — a named sum of several real lines (physical and/or DPD). It
 * behaves like a line everywhere else: it shows up in the archives, in the
 * reports and in the trends. Members live in `physical_line_ids`.
 */
export interface VirtualLine {
  id: number
  name: string
  description?: string | null
  lumg_id?: number | null
  branch_id?: number | null
  active?: boolean
  include_in_trends?: boolean
  include_in_report?: boolean
  physical_line_ids?: number[]
}

/** One corrector in a DPD line's history; it is in force from `installed_from`. */
export interface DpdDevice {
  ser_num: number
  corector_type_id: number
  ch_num: number
  installed_from: string
  model_name?: string | null
  manufacturer?: string | null
}

export interface DpdLine {
  id: number
  name: string
  description?: string | null
  lumg_id?: number | null
  branch_id?: number | null
  active?: boolean
  include_in_trends?: boolean
  include_in_report?: boolean
  devices?: DpdDevice[]
}

/**
 * A gas transport route: the lines along which the SAME gas moves, so their
 * ФХП must agree. A line belongs to at most one route. Members flagged
 * `is_reference` carry the composition the others are checked against —
 * usually a line with a stream chromatograph, but every route needs one
 * whether it has a chromatograph or not.
 */
export interface GasRouteMember {
  line_id: number
  is_reference: boolean
  id?: number
  line_name?: string | null
  sort_order?: number
}

export interface GasRoute {
  id: number
  number: string
  name?: string | null
  description?: string | null
  branch_id: number
  active: boolean
  members: GasRouteMember[]
}

/** A line of a branch that no other route has claimed. */
export interface FreeLine {
  id: number
  name: string
  calc_name?: string | null
}

/** Line kind for routing archive requests to the right endpoints. */
export type LineKind = 'physical' | 'virtual' | 'dpd'

export type ArchiveType = 'daily' | 'hourly' | 'sys' | 'edit' | 'param'
