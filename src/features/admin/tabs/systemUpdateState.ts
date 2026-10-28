import type { RepoKind, UpdateCheck, UpdateResult } from '@/api/systemUpdate'

export const REPO_LABEL: Record<RepoKind, string> = { backend: 'Бекенд', frontend: 'Фронтенд' }
export const REPO_KINDS: RepoKind[] = ['backend', 'frontend']

export const RESULT_META: Record<UpdateResult, { label: string; color: string }> = {
  updated: { label: 'Оновлено', color: 'teal' },
  up_to_date: { label: 'Вже остання версія', color: 'teal' },
  rolled_back: { label: 'Повернено попередню', color: 'yellow' },
  not_done: { label: 'Не виконано', color: 'red' },
  failed: { label: 'Збій', color: 'red' },
}

/** New commits across both repositories, per the last check. */
export function pendingCommits(check: UpdateCheck | null | undefined): number {
  if (!check) return 0
  return REPO_KINDS.reduce((sum, kind) => sum + (check.repos[kind]?.ahead ?? 0), 0)
}

/**
 * What «Оновити» installs: exactly the commits the admin was shown. Taken from
 * the check, not fetched again at start — a push that lands while the dialog
 * is open must not ride along unseen.
 */
export function updateTarget(check: UpdateCheck): Partial<Record<RepoKind, string>> {
  const target: Partial<Record<RepoKind, string>> = {}
  for (const kind of REPO_KINDS) {
    const repo = check.repos[kind]
    if (repo?.remote && (repo.ahead ?? 0) > 0) target[kind] = repo.remote.sha
  }
  return target
}

/** A check older than this is asked again before it is acted on. */
export const CHECK_STALE_MS = 30 * 60 * 1000

/** Why «Оновити» is greyed out, or null when it may be pressed. */
export function updateBlocker(
  check: UpdateCheck | null | undefined,
  busy: boolean,
  now = Date.now(),
): string | null {
  if (busy) return 'Оновлення вже виконується'
  if (!check) return 'Спершу перевірте, чи є оновлення'
  if (check.problems.length) return 'Є перешкоди — див. вище'
  if (pendingCommits(check) === 0) return 'Нових змін немає'
  if (checkIsStale(check, now)) return 'Перевірка застаріла — перевірте ще раз'
  return null
}

export function checkIsStale(check: UpdateCheck | null | undefined, now = Date.now()): boolean {
  if (!check) return true
  const at = Date.parse(check.checked_at)
  return Number.isNaN(at) || now - at > CHECK_STALE_MS
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('uk-UA')
}
