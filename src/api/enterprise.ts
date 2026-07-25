import { api } from '@/lib/apiClient'

export interface EnterpriseRecord {
  line_id?: number
  period: string
  volume?: number
  temperature?: number
  pressure?: number
  enterprise_id?: number
  name?: string
  ser_num?: string
  [key: string]: unknown
}

export interface EnterpriseMappingRow {
  id: number
  name?: string
  line_id?: number | null
  ser_num?: string | null
  mf_dev?: number | null
  type_dev?: number | null
  ch_num?: number | null
  branch_id?: number | null
  [key: string]: unknown
}

export interface VolumesParams {
  [key: string]: string | number | boolean | number[] | undefined
  line_id?: number[]
  from_date: string
  to_date: string
  period_type?: 'daily' | 'hourly'
  include_devices?: boolean
  live?: boolean
  serNum?: string
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
