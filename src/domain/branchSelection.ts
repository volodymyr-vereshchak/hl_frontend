/**
 * Which branch a screen should be showing.
 *
 * `branchId` is persisted in localStorage, so it outlives the data it points
 * at: a branch renamed away, one this user lost access to, or a leftover from
 * another deployment. Nothing used to check it against the list the server
 * actually returns, so every report quietly queried a branch that is not there
 * — no lines, no error, and a picker showing nothing, which reads as "the
 * branch was lost" rather than as a stale selection.
 */
export function resolveBranchId<T extends { id: number }>(
  branchId: number | null,
  branches: T[],
): number | null {
  if (branches.length === 0) return null
  if (branchId != null && branches.some((b) => b.id === branchId)) return branchId
  // Nothing valid selected: the first branch the user is allowed to see beats
  // an empty screen with no way to tell what went wrong.
  return branches[0].id
}
