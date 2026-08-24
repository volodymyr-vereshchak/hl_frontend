import { api } from '@/lib/apiClient'

/**
 * One device's reading inside an enterprise volume record. The enterprise name
 * lives HERE, on the device, and is called `enterprise_name` — the record above
 * carries no name at all. Reading a `name` off the record silently produced
 * "ID ?" column headers in the Excel export instead of the enterprises.
 *
 * `volume` is null when the device was not polled for that period, which is not
 * the same as a polled zero — consumers must keep the two apart.
 */
export interface EnterpriseDeviceVolume {
  serNum: number
  mfDev: number
  typeDev: number
  chNum: number
  enterprise_name: string
  volume?: number | null
  temperature?: number | null
  pressure?: number | null
  pressure_unit?: string | null
}

/**
 * One (line, period) row from `/enterprise/volumes/` — mirrors the backend's
 * EnterpriseVolumeResponse exactly. Deliberately has NO index signature: the
 * previous `[key: string]: unknown` let the export read fields the endpoint
 * never returns without a single type error.
 */
export interface EnterpriseRecord {
  line_id?: number | null
  period: string
  total_volume?: number | null
  device_count?: number
  devices?: EnterpriseDeviceVolume[]
}

/**
 * One enterprise from `/enterprise-mappings/` (EnterpriseRead). The name column
 * is `enterprise_name`, NOT `name` — reading the wrong one silently degrades the
 * whole list to bare serial numbers.
 *
 * `mf_dev`/`type_dev` come back as the EFFECTIVE codes: resolved through
 * `corector_type` when it is linked, legacy columns otherwise. The poll needs
 * exactly that quadruple (ser_num, mf_dev, type_dev, ch_num) to address a device.
 *
 * A row points at EITHER a physical line (`line_id`) or a DPD line
 * (`dpd_line_id`); ids never collide between the two.
 *
 * No index signature, on purpose. Everything about the corrector itself lives
 * in `devices[]`, and while `[key: string]: unknown` was here the poll screen
 * went on reading `manufacturer_short_name` off the point long after the field
 * had moved onto the device — undefined, no type error, a blank column.
 */
export interface EnterpriseMappingRow {
  id: number
  enterprise_name?: string
  line_id?: number | null
  dpd_line_id?: number | null
  branch_id?: number | null
  active?: boolean
  enabled?: boolean
  /** Corrector history, ordered by install moment. */
  devices?: EnterpriseDeviceRow[]
}

/**
 * One entry of a point's corrector history: this device stood here from
 * `installed_from` until `bound_to` (the derived window end — an explicit
 * `removed_at`, else the next install, else still in place).
 */
export interface EnterpriseDeviceRow {
  id: number
  device_id: number
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

/**
 * The corrector standing at a point now — the last entry of its history.
 * Everything that used to read `ser_num` off the point itself goes through
 * here, so a replaced device shows the current one rather than the first.
 */
export function currentDevice(m: EnterpriseMappingRow): EnterpriseDeviceRow | null {
  const devices = m.devices ?? []
  return devices.length ? devices[devices.length - 1] : null
}

/** Display name of a mapping, however sparse the row is. */
export function enterpriseLabel(m: EnterpriseMappingRow): string {
  const device = currentDevice(m)
  return m.enterprise_name || (device ? `S/N ${device.ser_num}` : `#${m.id}`)
}

/**
 * "Виробник Модель" of the corrector standing at a point now, or '' when it is
 * unknown (no history, or a device not linked to the catalog).
 *
 * The model names live on the DEVICE, not on the point: once correctors got
 * their own history and a foreign key into the catalog, `manufacturer_short_name`
 * and `model_name` moved into `devices[]` and reading them off the mapping row
 * quietly returned undefined everywhere — which the row's index signature made
 * invisible to the type checker.
 */
export function correctorLabel(m: EnterpriseMappingRow): string {
  const device = currentDevice(m)
  if (!device) return ''
  return [device.manufacturer_short_name, device.model_name].filter(Boolean).join(' ')
}

export interface VolumesParams {
  [key: string]: string | number | boolean | number[] | undefined
  line_id?: number[]
  from_date: string
  to_date: string
  period_type?: 'daily' | 'hourly'
  include_devices?: boolean
  /** Hourly only: fetch just these wall-clock hours (0-23). */
  hours?: number[]
  live?: boolean
  serNum?: number | string
  mfDev?: number
  typeDev?: number
  chNum?: number
  virtual?: boolean
}

export const enterpriseApi = {
  /**
   * Enterprise list. The DB-backed table (managed in the admin panel) is the
   * source of truth; the legacy /enterprise/mappings/ endpoint reads an
   * enterprise.xlsx file and 404s when that file was never deployed.
   */
  getMappings: async (): Promise<EnterpriseMappingRow[]> => {
    const db = await api.get<EnterpriseMappingRow[]>('/enterprise-mappings/').catch(() => [])
    if (db.length > 0) return db
    return api.get<EnterpriseMappingRow[]>('/enterprise/mappings/').catch(() => [])
  },
  getVolumes: (p: VolumesParams) =>
    api.get<EnterpriseRecord[]>('/enterprise/volumes/', p),
  getVolumesVirtual: (p: VolumesParams) =>
    api.get<EnterpriseRecord[]>('/enterprise/volumes_virtual/', p),
  clearCache: () => api.delete<true>('/enterprise/cache/'),
}

export interface StreamProgress {
  done?: number
  total?: number
  phase?: string
}

interface StreamOpts {
  onProgress?: (p: StreamProgress) => void
  signal?: AbortSignal
}

/**
 * Enterprise volumes over the NDJSON progress stream — same data as the plain
 * GET, but the backend emits progress events while the DPD poll runs so long
 * polls can show a real progress bar. A transport failure throws with
 * `fallback = true`, telling the caller to retry over the plain GET; in-band
 * `error` events throw without it (the GET would fail the same way).
 */
export async function streamEnterpriseVolumes(
  params: VolumesParams,
  { onProgress, signal }: StreamOpts = {},
): Promise<EnterpriseRecord[]> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value)) value.forEach((v) => query.append(key, String(v)))
    else query.append(key, String(value))
  }
  const url = `${api.resolveBaseUrl()}/enterprise/volumes/stream?${query}`

  let response: Response
  try {
    response = await fetch(url, {
      credentials: 'include',
      mode: 'cors',
      signal,
      headers: { Accept: 'application/x-ndjson' },
    })
  } catch (err) {
    const e = err as Error & { fallback?: boolean }
    if (e.name !== 'AbortError') e.fallback = true
    throw e
  }

  if (!response.ok || !response.body) {
    const e = new Error(`Stream HTTP ${response.status}`) as Error & { fallback?: boolean }
    e.fallback = true
    throw e
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  // Fragments of the current (possibly multi-chunk) line — joined once per
  // newline; repeated concatenation would be O(n²) on the huge result line.
  let parts: string[] = []
  let result: EnterpriseRecord[] | null = null

  const handleLine = (line: string) => {
    if (!line) return
    let event: { type?: string; done?: number; total?: number; phase?: string; data?: EnterpriseRecord[]; detail?: string }
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    if (event.type === 'progress') onProgress?.({ done: event.done, total: event.total, phase: 'polling' })
    else if (event.type === 'status') onProgress?.({ phase: event.phase })
    else if (event.type === 'result') result = event.data ?? []
    else if (event.type === 'error') throw new Error(event.detail || 'Enterprise poll failed')
    // ping events only keep the connection alive
  }

  const processChunk = (text: string) => {
    let start = 0
    for (;;) {
      const nl = text.indexOf('\n', start)
      if (nl < 0) break
      parts.push(text.slice(start, nl))
      const line = parts.join('').trim()
      parts = []
      handleLine(line)
      start = nl + 1
    }
    if (start < text.length) parts.push(start === 0 ? text : text.slice(start))
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    processChunk(decoder.decode(value, { stream: true }))
  }
  processChunk(decoder.decode())
  if (parts.length) handleLine(parts.join('').trim())

  if (result === null) {
    const e = new Error('Stream ended without a result') as Error & { fallback?: boolean }
    e.fallback = true
    throw e
  }
  return result
}
