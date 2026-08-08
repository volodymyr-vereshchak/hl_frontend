/**
 * HTTP client for the HLViewer backend — a TypeScript port of the old
 * `services/api.js` ApiClient. Preserves its battle-tested behavior:
 *   - per-endpoint timeouts (a stalled TCP connection looks like a slow
 *     backend to fetch(), so heavy work gets generous timeouts and hot
 *     metadata fails fast so the idempotent retry can reconnect);
 *   - idempotent-only retries with exponential backoff (never retry
 *     POST/PATCH — a network blip after the server processed it would
 *     duplicate the submission);
 *   - transparent 401 re-auth via /auth/me (AUTO_LOGIN re-mints the cookie),
 *     replaying the original request once before dropping to login.
 * Auth is cookie/JWT — the token is HttpOnly and never touched by JS.
 */

const DEFAULT_API_URL = '/api'

// ── Per-endpoint request timeouts ──────────────────────────────────────────
const TIMEOUT_DPD = 610_000 // enterprise DPD polls — just above nginx's 600s
const TIMEOUT_HEAVY = 120_000 // report generation
const TIMEOUT_LIGHT = 12_000 // instant, high-frequency metadata/config
const TIMEOUT_DEFAULT = 30_000 // archive data queries (daily/hourly/counts/…)

function timeoutForEndpoint(endpoint: string): number {
  if (/^\/enterprise\/volumes/.test(endpoint)) return TIMEOUT_DPD
  if (/^\/get_report/.test(endpoint)) return TIMEOUT_HEAVY
  // Звірка ФХП rebuilds a step function per line per parameter over the range.
  if (/^\/gas_routes\/\d+\/fhp_report/.test(endpoint)) return TIMEOUT_HEAVY
  if (/^\/(auth|config|lines|virtual_lines)/.test(endpoint)) return TIMEOUT_LIGHT
  return TIMEOUT_DEFAULT
}

// Enterprise volume fetches fan out into hundreds of DPD requests server-side;
// auto-retrying multiplies that load and never helps. One attempt only.
function retriesForEndpoint(endpoint: string, maxRetries: number): number {
  return /^\/enterprise\/volumes/.test(endpoint) ? 1 : maxRetries
}

export class ApiError extends Error {
  status: number | null
  url: string | null
  constructor(message: string, status: number | null = null, url: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.url = url
  }
}

/** One entry of FastAPI's 422 body: which field failed and why. */
interface ValidationIssue {
  loc?: (string | number)[]
  msg?: string
}

/**
 * Error text out of a FastAPI `detail`. A 422 sends an ARRAY of per-field
 * issues, and stringifying it put the raw JSON in front of the user — the
 * field name that actually explains the failure was buried inside a `loc`
 * array. Name the fields instead: "c_time: Field required".
 */
export function formatDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (!Array.isArray(detail)) return JSON.stringify(detail)
  const lines = (detail as ValidationIssue[])
    .map((issue) => {
      if (!issue || typeof issue !== 'object') return String(issue)
      // Drop the leading "body"/"query"/"path" — it names the part of the
      // request, not the field the person filled in.
      const field = (issue.loc ?? []).slice(1).join('.')
      const msg = issue.msg ?? 'Помилка валідації'
      return field ? `${field}: ${msg}` : msg
    })
    .filter(Boolean)
  return lines.length ? lines.join('; ') : JSON.stringify(detail)
}

// ── Session-expiry handling ────────────────────────────────────────────────
let _onSessionLost: (() => void) | null = null
let _reauthPromise: Promise<boolean> | null = null

export function setSessionHandlers({ onSessionLost }: { onSessionLost?: () => void } = {}) {
  _onSessionLost = onSessionLost ?? null
}

/** Base URL for requests that bypass the JSON client (file download / upload). */
export function apiBaseUrl(): string {
  return resolveBaseUrl()
}

function resolveBaseUrl(): string {
  const w = window as unknown as { APP_CONFIG?: { API_URL?: string } }
  return w.APP_CONFIG?.API_URL || import.meta.env.VITE_API_URL || DEFAULT_API_URL
}

function tryReauth(baseUrl: string): Promise<boolean> {
  if (!_reauthPromise) {
    _reauthPromise = fetch(`${baseUrl}/auth/me`, { credentials: 'include' })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        _reauthPromise = null
      })
  }
  return _reauthPromise
}

type RequestOptions = RequestInit & { timeout?: number; _reauthTried?: boolean }

const MAX_RETRIES = 3
const RETRY_DELAY = 1000

async function makeRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const baseUrl = resolveBaseUrl()
  const url = `${baseUrl}${endpoint}`
  const { timeout: timeoutOpt, headers, _reauthTried = false, ...rest } = options
  const timeout = timeoutOpt ?? timeoutForEndpoint(endpoint)
  const maxRetries = retriesForEndpoint(endpoint, MAX_RETRIES)
  const method = (rest.method || 'GET').toUpperCase()
  const isIdempotent =
    method === 'GET' || method === 'PUT' || method === 'DELETE' || method === 'HEAD'

  const requestOptions: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(headers as Record<string, string>),
    },
    credentials: 'include',
    mode: 'cors',
    ...rest,
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const response = await fetch(url, { ...requestOptions, signal: controller.signal })
      clearTimeout(timer)

      if (!response.ok) {
        if (response.status === 401 && !endpoint.startsWith('/auth/')) {
          if (!_reauthTried && (await tryReauth(baseUrl))) {
            return await makeRequest<T>(endpoint, { ...options, _reauthTried: true })
          }
          if (_onSessionLost) _onSessionLost()
        }

        let detail = response.statusText
        try {
          const body = await response.json()
          if (body.detail) detail = formatDetail(body.detail)
        } catch {
          /* non-JSON error body */
        }
        throw new ApiError(detail, response.status, url)
      }

      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return true as T
      }
      return (await response.json()) as T
    } catch (error) {
      clearTimeout(timer)

      if (error instanceof ApiError && error.status && error.status >= 400 && error.status < 500) {
        throw error
      }

      const err = error as Error
      const isTimeout = err.name === 'AbortError'
      const canRetry = isIdempotent && attempt < maxRetries

      if (!canRetry) {
        if (isTimeout) throw new ApiError(`Request timed out after ${timeout}ms`, null, url)
        if (error instanceof ApiError) throw error
        if (err.name === 'TypeError' && /fetch|Failed to fetch/.test(err.message)) {
          throw new ApiError(`Connection failed — check if backend is running: ${err.message}`, null, url)
        }
        throw new ApiError(`Request failed: ${err.message || String(error)}`, null, url)
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * attempt))
    }
  }
  // Unreachable — loop either returns or throws.
  throw new ApiError('Request failed', null, url)
}

type QueryParams = Record<string, string | number | boolean | Array<string | number> | null | undefined>

function buildQuery(params?: QueryParams): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value)) value.forEach((v) => sp.append(key, String(v)))
    else sp.append(key, String(value))
  }
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

export const api = {
  get: <T>(endpoint: string, params?: QueryParams) =>
    makeRequest<T>(`${endpoint}${buildQuery(params)}`, { method: 'GET' }),
  post: <T>(endpoint: string, data?: unknown) =>
    makeRequest<T>(endpoint, {
      method: 'POST',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }),
  put: <T>(endpoint: string, data?: unknown) =>
    makeRequest<T>(endpoint, {
      method: 'PUT',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }),
  patch: <T>(endpoint: string, data?: unknown) =>
    makeRequest<T>(endpoint, {
      method: 'PATCH',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }),
  delete: <T>(endpoint: string) => makeRequest<T>(endpoint, { method: 'DELETE' }),
  /** Escape hatch for streaming/custom requests (e.g. NDJSON enterprise stream). */
  raw: makeRequest,
  resolveBaseUrl,
}
