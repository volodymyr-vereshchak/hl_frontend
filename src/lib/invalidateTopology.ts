import type { QueryClient } from '@tanstack/react-query'

/**
 * Everything that caches a line's NAME, units or membership.
 *
 * The admin tabs used to invalidate only their own `['admin', …]` key, but the
 * screens that show a line do not read those: the archive tree has `['tree']`
 * (five-minute staleTime), the reports have `['topology']` and their own
 * branch-line list. So renaming a line in the admin panel left the old name in
 * every tree until the cache aged out or the page was reloaded.
 *
 * Deliberately broad: a topology edit is rare and manual, and a few extra
 * refetches cost less than a stale name pointing at the wrong line.
 */
const DEPENDENT_KEYS = [
  ['tree'],
  ['topology'],
  ['overview'],
  ['branches'],
  ['report-lines'],
  ['enterprise', 'mappings'],
]

export function invalidateTopology(qc: QueryClient) {
  for (const queryKey of DEPENDENT_KEYS) qc.invalidateQueries({ queryKey })
}
