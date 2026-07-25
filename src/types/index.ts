/** Core domain types shared across features. Extend as screens are ported. */

export type UserRole = 'admin' | 'viewer'

export interface User {
  username: string
  role: UserRole
  allowed_branch_ids?: number[] | null
}

export interface Branch {
  id: number
  name: string
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

export interface VirtualLine {
  id: number
  name: string
  lumg_id?: number | null
  branch_id?: number | null
  include_in_trends?: boolean
  include_in_report?: boolean
}

export interface DpdLine {
  id: number
  name: string
  lumg_id?: number | null
  branch_id?: number | null
  active?: boolean
  include_in_trends?: boolean
  include_in_report?: boolean
}

/** Line kind for routing archive requests to the right endpoints. */
export type LineKind = 'physical' | 'virtual' | 'dpd'

export type ArchiveType = 'daily' | 'hourly' | 'sys' | 'edit' | 'param'
