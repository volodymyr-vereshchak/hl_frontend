import { api, apiBaseUrl } from '@/lib/apiClient'
import type {
  Branch,
  Lumg,
  Line,
  GasVolumeCalc,
  CalcType,
  VirtualLine,
  DpdLine,
  UserRole,
  GasRoute,
  FreeLine,
} from '@/types'

// ── Users ───────────────────────────────────────────────────────────────────
export interface AdminUser {
  id: number
  username: string
  display_name?: string | null
  role: UserRole
  active: boolean
  /** Empty = access to every branch; non-empty = only those listed. */
  allowed_branch_ids?: number[]
  /**
   * False = a domain account: it signs in against Active Directory and has no
   * password stored here, so there is nothing for an admin to reset.
   */
  has_password?: boolean
}

/**
 * Write shape of a user. Note the asymmetry with `AdminUser`: the API READS
 * `allowed_branch_ids` but WRITES `branch_ids`.
 */
export interface UserWrite {
  username?: string
  display_name?: string | null
  role?: UserRole
  active?: boolean
  branch_ids?: number[]
  password?: string
}

/** POST /auth/users generates a password when none is supplied and returns it. */
export interface UserCreated {
  user: AdminUser
  password: string
}

/**
 * How the server authenticates. Deployment switches, not settings — the panel
 * reads them to explain which accounts the current mode leaves stranded.
 */
export interface AuthMode {
  ldap_enabled: boolean
  auto_login: boolean
}

export const userApi = {
  getAll: () => api.get<AdminUser[]>('/auth/users'),
  getMode: () => api.get<AuthMode>('/auth/mode'),
  create: (data: UserWrite) => api.post<UserCreated>('/auth/users', data),
  update: (id: number, data: UserWrite) => api.patch<AdminUser>(`/auth/users/${id}`, data),
  /** Server-side reset; the new password comes back in the response. */
  resetPassword: (id: number) => api.post<{ password: string }>(`/auth/users/${id}/reset-password`),
  remove: (id: number) => api.delete<true>(`/auth/users/${id}`),
}

// ── Topology CRUD ───────────────────────────────────────────────────────────
export const branchAdminApi = {
  getAll: () => api.get<Branch[]>('/grmu_branch/'),
  create: (data: Partial<Branch>) => api.post<Branch>('/grmu_branch/', data),
  update: (id: number, data: Partial<Branch>) => api.patch<Branch>(`/grmu_branch/${id}`, data),
  remove: (id: number) => api.delete<true>(`/grmu_branch/${id}`),
  // ASK.CFG — the file line/ГРС names are read from, plus its ЛУМГ mapping
  getConfigPath: (id: number) => api.get<DataPath | null>(`/grmu_branch/${id}/data-path`),
  setConfigPath: (id: number, data: { path: string; active?: boolean }) =>
    api.put<DataPath>(`/grmu_branch/${id}/data-path`, data),
  deleteConfigPath: (id: number) => api.delete<true>(`/grmu_branch/${id}/data-path`),
  previewConfig: (id: number) => api.get<ConfigGis[]>(`/grmu_branch/${id}/config-preview`),
  getConfigMappings: (id: number) => api.get<ConfigMapping[]>(`/grmu_branch/${id}/config-mappings`),
  setConfigMappings: (id: number, data: ConfigMapping[]) =>
    api.put<ConfigMapping[]>(`/grmu_branch/${id}/config-mappings`, data),
  updateNames: (id: number) => api.post<unknown>(`/grmu_branch/${id}/update-names`),
}

/** One ГРС block found inside ASK.CFG. */
export interface ConfigGis {
  gis_name: string
  flow_count: number
  line_count: number
}

/** Which ЛУМГ a CFG block's names belong to. */
export interface ConfigMapping {
  gis_name: string
  lumg_id: number | null
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
  addEisCode: (id: number, eisCode: string) =>
    api.post<EisCode>(`/lumgs/${id}/eis-codes`, { eis_code: eisCode }),
  deleteEisCode: (id: number, eisCode: string) =>
    api.delete<true>(`/lumgs/${id}/eis-codes/${encodeURIComponent(eisCode)}`),
  /** Folder names found under the ЛУМГ's archive path, as raw code strings. */
  scanEis: (id: number) => api.get<string[]>(`/lumgs/${id}/scan-eis`),
}

export interface DataPath {
  id?: number
  lumg_id?: number
  path: string
  active: boolean
}

export interface EisCode {
  id: number
  eis_code: string
  lumg_id?: number
}

/** Rows of a line's archive, by kind — the five engines fill one archive. */
export interface LineArchiveCounts {
  daily: number
  hourly: number
  edits: number
  alarms: number
  params: number
}

export interface LineArchivePreview {
  line_id: number
  name: string
  counts: LineArchiveCounts
  /** The first and last day the line has anything on; null when it is empty. */
  extent: { first: string | null; last: string | null }
}

/**
 * A range with either end left open: only `from_date` means everything from
 * that day on, only `to_date` everything up to it, both the span between them
 * with both days included.
 */
export interface LineArchiveRange {
  from_date?: string
  to_date?: string
  /** Read as query parameters, which the client types as an index signature. */
  [key: string]: string | undefined
}

export const lineAdminApi = {
  getAll: (lumgId?: number) => api.get<Line[]>('/lines/', lumgId ? { lumg_id: lumgId } : undefined),
  create: (data: Partial<Line>) => api.post<Line>('/lines/', data),
  update: (id: number, data: Partial<Line>) => api.patch<Line>(`/lines/${id}`, data),
  remove: (id: number) => api.delete<true>(`/lines/${id}`),
  previewArchive: (id: number, range: LineArchiveRange = {}) =>
    api.get<LineArchivePreview>(`/lines/${id}/archive/preview`, range),
  purgeArchive: (id: number, range: LineArchiveRange) =>
    api.delete<{ removed: LineArchiveCounts }>(
      `/lines/${id}/archive${queryOf(range)}`,
    ),
}

/** `api.delete` takes a whole URL, so the range is spelled out here. */
function queryOf(range: LineArchiveRange): string {
  const sp = new URLSearchParams()
  if (range.from_date) sp.append('from_date', range.from_date)
  if (range.to_date) sp.append('to_date', range.to_date)
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

export const calcAdminApi = {
  getAll: () => api.get<GasVolumeCalc[]>('/gas-volume-calcs/'),
  create: (data: Partial<GasVolumeCalc>) => api.post<GasVolumeCalc>('/gas-volume-calcs/', data),
  update: (id: number, data: Partial<GasVolumeCalc>) =>
    api.patch<GasVolumeCalc>(`/gas-volume-calcs/${id}`, data),
  remove: (id: number) => api.delete<true>(`/gas-volume-calcs/${id}`),
}

/** Row counts a transfer of the event-type dictionaries moved. */
export interface EventTypeTransferResult {
  ok: boolean
  /** Only on load: the dictionaries were emptied before the file was read. */
  wiped?: boolean
  exported: { flowtype: number; sysname: number; editname: number }
}

export const calcTypeAdminApi = {
  getAll: () => api.get<CalcType[]>('/gas-volume-calc-types/'),
  create: (data: Partial<CalcType>) => api.post<CalcType>('/gas-volume-calc-types/', data),
  update: (id: number, data: Partial<CalcType>) =>
    api.patch<CalcType>(`/gas-volume-calc-types/${id}`, data),
  remove: (id: number) => api.delete<true>(`/gas-volume-calc-types/${id}`),

  /**
   * Write the three dictionaries — calculator types, accidents, changes — into
   * FLOWTYPE.json, SYSNAME.json and EDITNAME.json.
   *
   * The backend reloads those files into the database on every start, so an
   * edit made only in the admin panel lives until the next restart and nowhere
   * else. This is what makes it permanent, and what carries it to the offline
   * server — the files are committed with the code.
   */
  exportPreload: () =>
    api.post<EventTypeTransferResult>('/gas-volume-calc-types/export-preload', {}),

  /**
   * The other direction. Without `force` names are updated from the files and
   * missing rows added; with it the accident and change dictionaries are
   * emptied first, so rows absent from the files are lost. Calculator types are
   * never wiped — deleting one cascades to its lines and their archive.
   */
  preload: (force = false) =>
    api.post<EventTypeTransferResult>(`/gas-volume-calc-types/preload?force=${force}`, {}),
}

export const virtualLineAdminApi = {
  getAll: () => api.get<VirtualLine[]>('/virtual_lines/'),
  create: (data: Partial<VirtualLine>) => api.post<VirtualLine>('/virtual_lines/', data),
  update: (id: number, data: Partial<VirtualLine>) =>
    api.patch<VirtualLine>(`/virtual_lines/${id}`, data),
  remove: (id: number) => api.delete<true>(`/virtual_lines/${id}`),
}

export const gasRouteAdminApi = {
  getAll: (branchId?: number) =>
    api.get<GasRoute[]>('/gas_routes/', branchId ? { branch_id: branchId } : undefined),
  create: (data: Partial<GasRoute>) => api.post<GasRoute>('/gas_routes/', data),
  update: (id: number, data: Partial<GasRoute>) => api.patch<GasRoute>(`/gas_routes/${id}`, data),
  remove: (id: number) => api.delete<true>(`/gas_routes/${id}`),
  /** Lines of the branch free to be claimed; `routeId` keeps its own members. */
  freeLines: (branchId: number, routeId?: number) =>
    api.get<FreeLine[]>('/gas_routes/free_lines/', {
      branch_id: branchId,
      ...(routeId ? { route_id: routeId } : {}),
    }),
}

export const dpdLineAdminApi = {
  getAll: () => api.get<DpdLine[]>('/dpd_lines/'),
  create: (data: Partial<DpdLine>) => api.post<DpdLine>('/dpd_lines/', data),
  update: (id: number, data: Partial<DpdLine>) => api.patch<DpdLine>(`/dpd_lines/${id}`, data),
  remove: (id: number) => api.delete<true>(`/dpd_lines/${id}`),
  init: (id: number) => api.post<unknown>(`/dpd_lines/${id}/init`),
  initStatus: (id: number) => api.get<DpdJobStatus>(`/dpd_lines/${id}/init/status`),
}

/** Init/refresh job of one DPD line. */
export interface DpdJobStatus {
  status: 'idle' | 'running' | 'done' | 'error' | string
  kind?: 'init' | 'update' | string
  progress_done?: number | null
  progress_total?: number | null
  started_at?: string | null
  finished_at?: string | null
  error?: string | null
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

/**
 * Server-side filters of the type dictionaries. `calcTypeId` is the device type
 * CODE (gas_vol_calc_type.type_id), not the row id; `search` matches the name
 * or the event code.
 */
export interface TypeQuery {
  skip?: number
  limit?: number
  calcTypeId?: number | null
  search?: string
}

const typeParams = (q: TypeQuery) => ({
  skip: q.skip ?? 0,
  limit: q.limit ?? 50,
  ...(q.calcTypeId != null ? { calc_type_id: q.calcTypeId } : {}),
  ...(q.search ? { search: q.search } : {}),
})

/**
 * How many archive rows carry this event code. Nothing references the
 * dictionaries by foreign key, so a type can always be deleted — those rows
 * just start showing a number where the name used to be. `capped` means the
 * count stopped early; the exact figure would cost a full scan and the answer
 * only has to be "none" or "a lot".
 */
export interface TypeUsage {
  archive_rows: number
  capped: boolean
}

export const sysTypeApi = {
  getPaged: (q: TypeQuery = {}) => api.get<Paged<SysType>>('/sys-types/', typeParams(q)),
  create: (data: Partial<SysType>) => api.post<SysType>('/sys-types/', data),
  update: (id: number, data: Partial<SysType>) => api.patch<SysType>(`/sys-types/${id}`, data),
  remove: (id: number) => api.delete<true>(`/sys-types/${id}`),
  usage: (id: number) => api.get<TypeUsage>(`/sys-types/${id}/usage`),
}

export const editTypeApi = {
  getPaged: (q: TypeQuery = {}) => api.get<Paged<EditType>>('/edit-types/', typeParams(q)),
  create: (data: Partial<EditType>) => api.post<EditType>('/edit-types/', data),
  update: (id: number, data: Partial<EditType>) => api.patch<EditType>(`/edit-types/${id}`, data),
  remove: (id: number) => api.delete<true>(`/edit-types/${id}`),
  usage: (id: number) => api.get<TypeUsage>(`/edit-types/${id}/usage`),
}

// ── Device catalog ──────────────────────────────────────────────────────────
export interface Manufacturer {
  id: number
  short_name: string
  full_name: string
  mf_dev: number
}

export interface CorectorType {
  /** Ask2 driver that can speak to this model: 7 Універсал, 33 Флоутек ВР-1,
   *  52 КПЛГ, 54 ВЕГА, 70 Флоутек ВР-2, 77 ПК-В. null = none covers it. */
  protocol_id?: number | null
  id: number
  manufacturer_id: number
  model_name: string
  type_dev: number
}

/** What a catalog export wrote into device_catalog.json. */
export interface CatalogExportResult {
  ok: boolean
  exported: { manufacturers: number; corector_types: number }
}

/**
 * What loading device_catalog.json changed.
 *
 * Manufacturers are matched by `mf_dev`, so a rename made on another
 * installation arrives as a rename here. Models are matched by name and left
 * alone once they exist — their `type_dev` is not unique, so a renamed model
 * comes in as a new one and `warnings` says where the two sides disagree.
 */
export interface CatalogSyncResult {
  message: string
  added_manufacturers: number
  renamed_manufacturers: number
  added_models: number
  warnings: string[]
}

export const deviceCatalogApi = {
  manufacturers: () => api.get<Manufacturer[]>('/device-catalog/manufacturers/'),
  createManufacturer: (data: Partial<Manufacturer>) =>
    api.post<Manufacturer>('/device-catalog/manufacturers/', data),
  updateManufacturer: (id: number, data: Partial<Manufacturer>) =>
    api.patch<Manufacturer>(`/device-catalog/manufacturers/${id}`, data),
  removeManufacturer: (id: number) => api.delete<true>(`/device-catalog/manufacturers/${id}`),

  correctorTypes: () => api.get<CorectorType[]>('/device-catalog/corector-types/'),
  createCorrectorType: (data: Partial<CorectorType>) =>
    api.post<CorectorType>('/device-catalog/corector-types/', data),
  updateCorrectorType: (id: number, data: Partial<CorectorType>) =>
    api.patch<CorectorType>(`/device-catalog/corector-types/${id}`, data),
  removeCorrectorType: (id: number) => api.delete<true>(`/device-catalog/corector-types/${id}`),

  /**
   * Write the catalog as it stands in the DB back into
   * backend/db/preload_db/device_catalog.json.
   *
   * That file is how the catalog reaches the offline server: it is committed
   * with the code and seeded there by `preload`. Edits made only in the admin
   * panel live in this database and nowhere else until this runs.
   */
  exportPreload: () => api.post<CatalogExportResult>('/device-catalog/export-preload', {}),

  /**
   * Load device_catalog.json into the DB. Without `force` only missing entries
   * are added; with it the catalog is wiped and rebuilt from the file.
   */
  preload: (force = false) =>
    api.post<CatalogSyncResult>(`/device-catalog/preload?force=${force}`, {}),
}

// ── Enterprise mappings ─────────────────────────────────────────────────────
/**
 * One industrial consumer behind a metering line. It points at EITHER a physical
 * line (`line_id`) or a DPD line (`dpd_line_id`) — the backend rejects both.
 *
 * The corrector lives in `devices`, not on the point: correctors get moved
 * between points, so each entry records which one stood here and from when.
 * The one in force now is the last entry — see `currentEnterpriseDevice`.
 */
export interface EnterpriseMapping {
  id: number
  enterprise_name: string
  branch_id?: number | null
  line_id?: number | null
  dpd_line_id?: number | null
  active: boolean
  enabled: boolean
  devices: EnterpriseDevice[]
  /** The modem at this site, when there is one. It belongs to the enterprise
   *  rather than to the corrector because that is where it is bolted: the
   *  correctors under it get replaced, the phone number does not change. */
  gsm?: EnterpriseGsm | null
}

/** What an operator sets for a site's modem — and nothing else.
 *
 *  Timeouts, retry counts and the init string live on the poll card with
 *  their defaults. Nobody has needed to change them, and a box nobody needs
 *  collects the typo that reads later as a dead meter. */
export interface EnterpriseGsm {
  phone: string | null
  /** Poll on a schedule. Off still leaves «Опитати» available — those are
   *  different questions. */
  auto_poll: boolean
  /** When to poll, as cron — "0 8 * * *" every morning, every four hours,
   *  every hour. Empty follows the schedule set globally. */
  poll_cron: string | null
  /** Machines that dial this number. Empty means nobody does — the site is
   *  set up in every other respect and is never polled. Several mean a shared
   *  queue: whichever agent asks first takes it, the rest skip it. */
  agent_ids: number[]
  /** What a Floutek ТМ-2 asks for in its archive requests — the vendor's
   *  default "11" unless the corrector was set otherwise. */
  password: string
}

/** What ДПД says the modem number of a site is. */
export interface PhoneFromDpd {
  /** Ready for the card, or null when ДПД has nothing usable. */
  phone: string | null
  /** Exactly what ДПД holds — "+380" and nothing else is common. */
  raw: string | null
  message: string
}

/**
 * One entry of a point's corrector history. `bound_to` is derived by the
 * backend: an explicit `removed_at`, else the next install, else null (still
 * in place). A gap between one entry's `removed_at` and the next install
 * belongs to no device — that is when the point was left without a corrector.
 */
export interface EnterpriseDevice {
  id?: number
  device_id?: number
  ser_num: number
  corector_type_id?: number | null
  ch_num: number
  installed_from: string
  removed_at?: string | null
  mf_dev?: number | null
  type_dev?: number | null
  model_name?: string | null
  manufacturer_short_name?: string | null
  bound_to?: string | null
}

/** The corrector standing at a point now, or null while it has none. */
export function currentEnterpriseDevice(e: EnterpriseMapping): EnterpriseDevice | null {
  const devices = e.devices ?? []
  return devices.length ? devices[devices.length - 1] : null
}

export interface UploadResult {
  imported: number
  errors?: string[]
}

export const enterpriseMappingApi = {
  getAll: () => api.get<EnterpriseMapping[]>('/enterprise-mappings/'),
  create: (data: Partial<EnterpriseMapping>) =>
    api.post<EnterpriseMapping>('/enterprise-mappings/', data),
  update: (id: number, data: Partial<EnterpriseMapping>) =>
    api.patch<EnterpriseMapping>(`/enterprise-mappings/${id}`, data),
  remove: (id: number) => api.delete<true>(`/enterprise-mappings/${id}`),
  /** The modem number ДПД keeps for this site's fitted corrector. Offered,
   *  not written: nothing reaches the card until the form is saved. */
  phoneFromDpd: (id: number) =>
    api.get<PhoneFromDpd>(`/enterprise-mappings/${id}/phone-from-dpd`),

  downloadTemplate: () => window.open(`${apiBaseUrl()}/enterprise-mappings/template`, '_blank'),
  downloadExport: () => window.open(`${apiBaseUrl()}/enterprise-mappings/export`, '_blank'),

  /** Excel import; multipart, so it goes around the JSON client. */
  async uploadExcel(file: File, branchId?: number): Promise<UploadResult> {
    const form = new FormData()
    form.append('file', file)
    const url = branchId
      ? `${apiBaseUrl()}/enterprise-mappings/upload?branch_id=${branchId}`
      : `${apiBaseUrl()}/enterprise-mappings/upload`
    const res = await fetch(url, { method: 'POST', body: form, credentials: 'include' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail))
    }
    return res.json()
  },
}

// ── DPD archive job (industry data cache) ───────────────────────────────────
export interface ArchiveRefreshStatus {
  status: 'idle' | 'running' | 'done' | 'error' | string
  started_at?: string | null
  finished_at?: string | null
  progress_done?: number | null
  progress_total?: number | null
  error?: string | null
  /** Local times (HH:MM) the scheduler refreshes at. */
  refresh_times?: string[]
  /** What applies when the schedule is cleared (DPD_REFRESH_TIMES). */
  default_refresh_times?: string[]
}

export const enterpriseArchiveApi = {
  status: () => api.get<ArchiveRefreshStatus>('/enterprise/archive/refresh/status'),
  refresh: () => api.post<unknown>('/enterprise/archive/refresh'),
  clearCache: () => api.delete<unknown>('/enterprise/cache/'),
  setSchedule: (times: string[]) =>
    api.put<{ refresh_times: string[] }>('/enterprise/archive/refresh/schedule', { times }),
}

// ── DPD credentials ─────────────────────────────────────────────────────────
/**
 * Per-branch DPD access. Every branch has its OWN endpoints and login — there is
 * no shared configuration (grmu_branch_dpd_credential is 1:1 with the branch).
 * `password` is write-only: the API never returns it.
 */
export interface DpdCredential {
  branch_id?: number
  username?: string
  password?: string
  api_base_url?: string | null
  auth_url?: string | null
  timeout_sec?: number
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

// ── Branch configuration transfer ───────────────────────────────────────────
/**
 * Carrying a configured branch to the central server: one JSON file down from
 * the branch, the same file up on the other side. Both go around the JSON
 * client — a download needs the browser to save it, and `api.post` cannot send
 * FormData (it stringifies the body and forces Content-Type: application/json).
 */
export interface BranchImportReport {
  branch_name: string
  /**
   * How the target was decided: `chosen` — the administrator picked it; the
   * rest is what the file matched by itself (transfer id, name, or nothing).
   */
  matched_by: 'chosen' | 'uid' | 'name' | 'new'
  /** The branch this lands on, so the screen can preselect it. null = new. */
  branch_id: number | null
  dry_run: boolean
  created: Record<string, number>
  updated: Record<string, number>
  /** Rows here and not in the file — listed only, never touched. */
  local_only: Record<string, string[]>
  /** ЛУМГ in the file with no counterpart here — each would be created. */
  new_lumgs: string[]
  /** ЛУМГ here with no counterpart in the file — candidates for a rename. */
  unmatched_lumgs: { id: number; name: string }[]
  warnings: string[]
  errors: string[]
  notes: Record<string, unknown>
  applied: boolean
}

export interface BranchImportTarget {
  /** Branch to update. Omit together with `createNew` to let the file decide. */
  targetBranchId?: number | null
  createNew?: boolean
  /** File ЛУМГ name → id of the existing ЛУМГ it renames. */
  lumgMap?: Record<string, number>
}

export const branchTransferApi = {
  download: (branchId: number, includeSecrets = true) =>
    window.open(
      `${apiBaseUrl()}/grmu_branch/${branchId}/config-export?include_secrets=${includeSecrets}`,
      '_blank',
    ),

  async upload(
    file: File,
    dryRun: boolean,
    target: BranchImportTarget = {},
  ): Promise<BranchImportReport> {
    const form = new FormData()
    form.append('file', file)
    if (target.lumgMap && Object.keys(target.lumgMap).length) {
      form.append('lumg_map', JSON.stringify(target.lumgMap))
    }
    const qs = new URLSearchParams({ dry_run: String(dryRun) })
    if (target.targetBranchId != null) qs.set('target_branch_id', String(target.targetBranchId))
    if (target.createNew) qs.set('create_new', 'true')

    const res = await fetch(`${apiBaseUrl()}/grmu_branch/config-import?${qs}`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail))
    }
    return res.json()
  },
}
