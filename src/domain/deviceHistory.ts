/**
 * Corrector history windows, for display.
 *
 * The backend decides attribution; this only renders the same rule so the
 * admin form can show what a history means before it is saved. A device is in
 * force from its install moment until it is removed, or until the next one is
 * fitted — whichever comes first. A removal earlier than the next install
 * leaves a gap that belongs to no device, and that gap is the point of having
 * a removal date at all: the corrector taken off is already measuring
 * somewhere else.
 */

export interface HistoryEntry {
  /** ISO stamp, or '' meaning "since forever". */
  installedFrom: string
  /** ISO stamp, or '' when the device ran until the next was fitted. */
  removedAt?: string
}

export interface HistoryWindow<T extends HistoryEntry> {
  entry: T
  from: string
  /** Exclusive end; null = still in place. */
  to: string | null
}

/** Ordered windows, one per entry. Input order does not matter. */
export function resolveWindows<T extends HistoryEntry>(entries: T[]): HistoryWindow<T>[] {
  const ordered = [...entries].sort((a, b) => (a.installedFrom < b.installedFrom ? -1 : 1))
  return ordered.map((entry, i) => {
    const nextFrom = i + 1 < ordered.length ? ordered[i + 1].installedFrom : null
    const removed = entry.removedAt || null
    const to = removed && (nextFrom === null || removed < nextFrom) ? removed : nextFrom
    return { entry, from: entry.installedFrom, to }
  })
}

/** True when the history leaves a stretch with no corrector fitted. */
export function hasGap<T extends HistoryEntry>(entries: T[]): boolean {
  const windows = resolveWindows(entries)
  return windows.some((w, i) => {
    const next = windows[i + 1]
    return next != null && w.to != null && w.to < next.from
  })
}
