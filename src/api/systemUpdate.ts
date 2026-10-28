import { api } from '@/lib/apiClient'

/**
 * «Версія програми» — updating the application itself from the admin panel.
 *
 * Everything that decides something goes through the backend (/system-update),
 * which checks the admin and forwards to the updater container. The one
 * exception is the progress of a running update: it is read from the updater
 * directly through nginx (/updater/watch), because while it runs the backend
 * is the thing being restarted. That read needs the watch token the start
 * returned, not the session.
 */

export type RepoKind = 'backend' | 'frontend'

export interface CommitInfo {
  sha: string
  short: string
  date: string
  author: string
  subject: string
}

export interface RepoCheck {
  url: string
  branch: string
  error: string | null
  head: CommitInfo
  remote?: CommitInfo
  ahead?: number
  commits?: CommitInfo[]
  dirty?: string[]
  diverged?: boolean
  migrations?: boolean
  image_rebuild?: boolean
  updater_changed?: boolean
}

export interface UpdateCheck {
  checked_at: string
  repos: Partial<Record<RepoKind, RepoCheck>>
  /** Each blocks the update until it is dealt with on the server. */
  problems: string[]
  /** Worth knowing before pressing «Оновити», blocks nothing. */
  notes: string[]
}

export type UpdateResult = 'updated' | 'up_to_date' | 'rolled_back' | 'not_done' | 'failed'
export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface UpdateStep {
  id: string
  label: string
  state: StepState
  note: string | null
}

export interface UpdateJobSummary {
  id: string
  status: 'running' | 'finished'
  result: UpdateResult | null
  message: string | null
  started_at: string
  finished_at: string | null
  started_by: string
  target: Partial<Record<RepoKind, string>>
  from: Partial<Record<RepoKind, string>>
  warnings: string[]
}

export interface UpdateJob extends UpdateJobSummary {
  steps: UpdateStep[]
  log: string[]
}

export interface RepoConfig {
  url: string
  branch: string
}

export interface UpdaterConfig {
  repos: Record<RepoKind, RepoConfig>
  token_set: boolean
}

export interface InstalledRepo extends Partial<CommitInfo> {
  dir: string
  error?: string
}

export interface UpdaterStatus {
  installed: Record<RepoKind, InstalledRepo>
  config: UpdaterConfig
  check: UpdateCheck | null
  busy: boolean
  job: UpdateJob | null
  last_job: UpdateJobSummary | null
  /** The commit the backend process was started from. */
  running_backend: string | null
}

export interface StartedUpdate {
  job_id: string
  watch_token: string
}

export const systemUpdateApi = {
  enabled: () => api.get<{ enabled: boolean }>('/system-update/enabled'),
  status: () => api.get<UpdaterStatus>('/system-update/status'),
  check: () => api.post<UpdateCheck>('/system-update/check'),
  start: (target: Partial<Record<RepoKind, string>>) =>
    api.post<StartedUpdate>('/system-update/start', { target }),
  saveConfig: (repos: Record<RepoKind, RepoConfig>, token: string | null) =>
    api.put<UpdaterConfig>('/system-update/config', { repos, token }),
  history: () => api.get<UpdateJobSummary[]>('/system-update/history'),
  job: (id: string) => api.get<UpdateJob>(`/system-update/jobs/${id}`),
}

/**
 * One read of a running update's progress. Not through the API client: it
 * would retry, re-authenticate and drop to the login form on errors that,
 * here, only mean "nginx is being restarted, ask again in a moment".
 */
export async function watchUpdate(jobId: string, token: string): Promise<UpdateJob> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const resp = await fetch(`/updater/watch/${encodeURIComponent(jobId)}`, {
      headers: { 'X-Watch-Token': token, Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!resp.ok) throw new WatchError(resp.status)
    return (await resp.json()) as UpdateJob
  } finally {
    clearTimeout(timer)
  }
}

export class WatchError extends Error {
  status: number
  constructor(status: number) {
    super(`watch failed: ${status}`)
    this.status = status
  }
}
