import { api } from '@/lib/apiClient'
import type { Branch, Lumg, Line, GasVolumeCalc, CalcType, VirtualLine, DpdLine, UserRole } from '@/types'

// ── Users ───────────────────────────────────────────────────────────────────
export interface AdminUser {
  id: number
  username: string
  display_name?: string | null
  role: UserRole
  active: boolean
  allowed_branch_ids?: number[]
}

export const userApi = {
  getAll: () => api.get<AdminUser[]>('/auth/users'),
  create: (data: Partial<AdminUser> & { password?: string }) => api.post<AdminUser>('/auth/users', data),
  update: (id: number, data: Partial<AdminUser>) => api.patch<AdminUser>(`/auth/users/${id}`, data),
  resetPassword: (id: number, password: string) =>
    api.post<true>(`/auth/users/${id}/reset-password`, { password }),
  remove: (id: number) => api.delete<true>(`/auth/users/${id}`),
}

// ── Topology CRUD ───────────────────────────────────────────────────────────
export const branchAdminApi = {
  getAll: () => api.get<Branch[]>('/grmu_branch/'),
  create: (data: Partial<Branch>) => api.post<Branch>('/grmu_branch/', data),
  update: (id: number, data: Partial<Branch>) => api.patch<Branch>(`/grmu_branch/${id}`, data),
  remove: (id: number) => api.delete<true>(`/grmu_branch/${id}`),
  // ASK.CFG name-config path + mappings
  getConfigPath: (id: number) => api.get<{ path?: string; active?: boolean }>(`/grmu_branch/${id}/data-path`),
  setConfigPath: (id: number, data: { path: string; active?: boolean }) =>
    api.put<unknown>(`/grmu_branch/${id}/data-path`, data),
  deleteConfigPath: (id: number) => api.delete<true>(`/grmu_branch/${id}/data-path`),
  updateNames: (id: number) => api.post<unknown>(`/grmu_branch/${id}/update-names`),
}

export const lumgAdminApi = {
  getAll: () => api.get<Lumg[]>('/lumgs/'),
  create: (data: Partial<Lumg>) => api.post<Lumg>('/lumgs/', data),
  update: (id: number, data: Partial<Lumg>) => api.patch<Lumg>(`/lumgs/${id}`, data),
  remove: (id: number) => api.delete<true>(`/lumgs/${id}`),
  getDataPath: (id: number) => api.get<DataPath>(`/lumgs/${id}/data-path`),
  setDataPath: (id: number, data: { path: string; active?: boolean }) =>
    api.put<DataPath>(`/lumgs/${id}/data-path`, data),
  deleteDataPath: (id: number) => api.delete<true>(`/lumgs/${id}/data-path`),
  getEisCodes: (id: number) => api.get<EisCode[]>(`/lumgs/${id}/eis-codes`),
  addEisCode: (id: number, code: string) => api.post<EisCode>(`/lumgs/${id}/eis-codes`, { code }),
  deleteEisCode: (id: number, codeId: number) => api.delete<true>(`/lumgs/${id}/eis-codes/${codeId}`),
  scanEis: (id: number) => api.get<{ codes?: string[] }>(`/lumgs/${id}/scan-eis`),
}

export interface DataPath {
  id?: number
  lumg_id?: number
  path: string
  active: boolean
}

export interface EisCode {
  id: number
  code: string
  lumg_id?: number
}

export const lineAdminApi = {
  getAll: (lumgId?: number) => api.get<Line[]>('/lines/', lumgId ? { lumg_id: lumgId } : undefined),
  create: (data: Partial<Line>) => api.post<Line>('/lines/', data),
  update: (id: number, data: Partial<Line>) => api.patch<Line>(`/lines/${id}`, data),
  remove: (id: number) => api.delete<true>(`/lines/${id}`),
}

export const calcAdminApi = {
  getAll: () => api.get<GasVolumeCalc[]>('/gas-volume-calcs/'),
  create: (data: Partial<GasVolumeCalc>) => api.post<GasVolumeCalc>('/gas-volume-calcs/', data),
  update: (id: number, data: Partial<GasVolumeCalc>) =>
    api.patch<GasVolumeCalc>(`/gas-volume-calcs/${id}`, data),
  remove: (id: number) => api.delete<true>(`/gas-volume-calcs/${id}`),
}

export const calcTypeAdminApi = {
  getAll: () => api.get<CalcType[]>('/gas-volume-calc-types/'),
  create: (data: Partial<CalcType>) => api.post<CalcType>('/gas-volume-calc-types/', data),
  update: (id: number, data: Partial<CalcType>) => api.patch<CalcType>(`/gas-volume-calc-types/${id}`, data),
  remove: (id: number) => api.delete<true>(`/gas-volume-calc-types/${id}`),
}

export const virtualLineAdminApi = {
  getAll: () => api.get<VirtualLine[]>('/virtual_lines/'),
  create: (data: Partial<VirtualLine>) => api.post<VirtualLine>('/virtual_lines/', data),
  update: (id: number, data: Partial<VirtualLine>) => api.patch<VirtualLine>(`/virtual_lines/${id}`, data),
  remove: (id: number) => api.delete<true>(`/virtual_lines/${id}`),
}

export const dpdLineAdminApi = {
  getAll: () => api.get<DpdLine[]>('/dpd_lines/'),
  create: (data: Partial<DpdLine>) => api.post<DpdLine>('/dpd_lines/', data),
  update: (id: number, data: Partial<DpdLine>) => api.patch<DpdLine>(`/dpd_lines/${id}`, data),
  remove: (id: number) => api.delete<true>(`/dpd_lines/${id}`),
  init: (id: number) => api.post<unknown>(`/dpd_lines/${id}/init`),
  initStatus: (id: number) => api.get<{ status?: string }>(`/dpd_lines/${id}/init/status`),
}

// ── Reference tables (paged) ────────────────────────────────────────────────
export interface SysType {
  id: number
  sys_type_id: number
  gas_volume_calc_type_id: number
  sys_name: string
}

export interface EditType {
  id: number
  edit_type_id: number
  gas_volume_calc_type_id: number
  edit_name: string
}

interface Paged<T> {
  total: number
  items: T[]
}

export const sysTypeApi = {
  getPaged: (skip = 0, limit = 50) => api.get<Paged<SysType>>('/sys-types/', { skip, limit }),
  create: (data: Partial<SysType>) => api.post<SysType>('/sys-types/', data),
  update: (id: number, data: Partial<SysType>) => api.patch<SysType>(`/sys-types/${id}`, data),
  remove: (id: number) => api.delete<true>(`/sys-types/${id}`),
}

export const editTypeApi = {
  getPaged: (skip = 0, limit = 50) => api.get<Paged<EditType>>('/edit-types/', { skip, limit }),
  create: (data: Partial<EditType>) => api.post<EditType>('/edit-types/', data),
  update: (id: number, data: Partial<EditType>) => api.patch<EditType>(`/edit-types/${id}`, data),
  remove: (id: number) => api.delete<true>(`/edit-types/${id}`),
}

// ── Device catalog ──────────────────────────────────────────────────────────
export interface Manufacturer {
  id: number
  short_name: string
  full_name?: string | null
  mf_dev: number
}

export interface CorectorType {
  id: number
  name?: string
  type_dev?: number
  mf_dev?: number
  model_name?: string
}

export const deviceCatalogApi = {
  manufacturers: () => api.get<Manufacturer[]>('/device-catalog/manufacturers/'),
  correctorTypes: () => api.get<CorectorType[]>('/device-catalog/corector-types/'),
}

// ── Enterprise mappings ─────────────────────────────────────────────────────
export interface EnterpriseMapping {
  id: number
  name?: string
  line_id?: number | null
  ser_num?: string | null
  branch_id?: number | null
  [key: string]: unknown
}

export const enterpriseMappingApi = {
  getAll: () => api.get<EnterpriseMapping[]>('/enterprise-mappings/'),
  create: (data: Partial<EnterpriseMapping>) => api.post<EnterpriseMapping>('/enterprise-mappings/', data),
  update: (id: number, data: Partial<EnterpriseMapping>) =>
    api.patch<EnterpriseMapping>(`/enterprise-mappings/${id}`, data),
  remove: (id: number) => api.delete<true>(`/enterprise-mappings/${id}`),
}

// ── DPD config / credentials ────────────────────────────────────────────────
export interface DpdGlobalConfig {
  api_base_url?: string
  auth_url?: string
  timeout_sec?: number
}

export const dpdConfigApi = {
  get: () => api.get<DpdGlobalConfig>('/grmu_branch/dpd-config'),
  upsert: (data: DpdGlobalConfig) => api.put<DpdGlobalConfig>('/grmu_branch/dpd-config', data),
}

export interface DpdCredential {
  username?: string
  password?: string
  branch_id?: number
}

export const dpdCredentialApi = {
  get: (branchId: number) => api.get<DpdCredential>(`/grmu_branch/${branchId}/dpd-credential`),
  upsert: (branchId: number, data: DpdCredential) =>
    api.put<DpdCredential>(`/grmu_branch/${branchId}/dpd-credential`, data),
  remove: (branchId: number) => api.delete<true>(`/grmu_branch/${branchId}/dpd-credential`),
}

// ── Hostlib update job ──────────────────────────────────────────────────────
export interface UpdateJobStatus {
  status: 'idle' | 'running' | 'done' | 'error' | string
  started_at?: string | null
  finished_at?: string | null
  error?: string | null
  lumg_id?: number | null
  lumgs?: Record<string, string>
}

export const updateApi = {
  status: () => api.get<UpdateJobStatus>('/update_data/status'),
  updateAll: () => api.post<unknown>('/update_data/'),
  updateLumg: (lumgId: number) => api.post<unknown>(`/update_data/${lumgId}`),
  updateDirect: (lumgId: number, path: string) =>
    api.post<unknown>('/update_data/direct', { lumg_id: lumgId, path }),
  reset: () => api.post<unknown>('/update_data/reset'),
}
