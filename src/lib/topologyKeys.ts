/**
 * Every cache key that holds topology — філії, ЛУМГ, обчислювачі, лінії — in
 * one place, so that caching it and invalidating it cannot drift apart.
 *
 * They drifted. `invalidateTopology` carried a hand-written list of dependent
 * keys, two screens cached topology under keys that were never added to it,
 * and renaming a line in the admin panel left the old name on the ФХП and
 * flow-rate screens until the five-minute staleTime ran out. The list is the
 * kind that is only correct until the next screen is written.
 *
 * A hook that takes its key from here is invalidated by construction. A hook
 * that invents its own is not, which is the point: adding a key to this file
 * is the visible step that adding a screen must not skip.
 */
export const TOPOLOGY_KEYS = {
  /** Archive tree: філія → ЛУМГ → обчислювач → лінія. */
  tree: ['tree'] as const,
  /** Overview page's own topology fetch. */
  overview: ['topology'] as const,
  /** Reports' shared select lists. */
  reportTopology: ['report-topology'] as const,
  /** Flow-rate page, which needs the same four lists. */
  flowCalcTopology: ['flow-calc-topology'] as const,
  /** Branch list used by the report pickers. */
  branches: ['branches'] as const,
  /** Enterprise mappings — they carry the line a point feeds. */
  enterpriseMappings: ['enterprise', 'mappings'] as const,
} as const

/** Per-branch line list. Invalidated by its root, so the branch id is free. */
export const reportLinesKey = (branchId: number | null | undefined) =>
  ['report-lines', branchId] as const

/**
 * The roots `invalidateTopology` clears. Derived from the map above rather
 * than written out again — the previous list was written out again, and that
 * is exactly how two of them went missing.
 */
export const TOPOLOGY_ROOTS: readonly (readonly unknown[])[] = [
  ...Object.values(TOPOLOGY_KEYS),
  ['report-lines'] as const,
  // Overview's per-branch summary is derived from topology, so a renamed line
  // reaches it too. Its root differs from TOPOLOGY_KEYS.overview by design:
  // ['overview'] is the summary, ['topology'] is the tree behind it.
  ['overview'] as const,
]
