import type { QueryClient } from '@tanstack/react-query'
import { TOPOLOGY_ROOTS } from './topologyKeys'

/**
 * Refetch everything that caches a line's NAME, units or membership.
 *
 * The admin tabs used to invalidate only their own `['admin', …]` key, but the
 * screens that show a line do not read those: the archive tree has `['tree']`
 * (five-minute staleTime), the reports have `['topology']` and their own
 * branch-line list. So renaming a line in the admin panel left the old name in
 * every tree until the cache aged out or the page was reloaded.
 *
 * The roots now come from `topologyKeys`, next to the hooks that cache under
 * them. When this file held its own copy of the list, `['report-topology']`
 * and `['flow-calc-topology']` were added as query keys and never added here,
 * so the ФХП and flow-rate screens kept the stale name — the same bug this
 * helper exists to prevent, one screen further along.
 *
 * Deliberately broad: a topology edit is rare and manual, and a few extra
 * refetches cost less than a stale name pointing at the wrong line.
 */
export function invalidateTopology(qc: QueryClient) {
  for (const queryKey of TOPOLOGY_ROOTS) qc.invalidateQueries({ queryKey })
}
