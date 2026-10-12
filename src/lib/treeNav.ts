/**
 * Keyboard navigation for any of the app's trees.
 *
 * Three screens draw a tree of their own — the archive's branch→lumg→calc→line,
 * the enterprise poll's branch→line→enterprise, and the line-comparison picker —
 * each with its own data, its own open-state storage and its own idea of what
 * selecting a row means. What they share is the movement: ↓ to the next row on
 * screen whatever its depth, → / ← to unfold and fold, Enter to act, letters to
 * jump. That part lives here, over a flat list of rows the caller builds from
 * its own data.
 *
 * The caller owns the data and the open state; this hook owns the focus. The
 * flat list must be in the order the rows appear on screen and contain only the
 * rows actually visible — the arrows can otherwise move focus to a row nobody
 * can see.
 *
 * The movement helpers are pure and tested on their own (treeNav.test.ts).
 */
import { useCallback, useMemo, useRef, useState } from 'react'

export interface NavRow {
  /** Identity for the roving tabindex, and the DOM lookup key. */
  key: string
  parentKey: string | null
  expandable: boolean
  expanded: boolean
  /** Visible text — what type-ahead matches against. */
  label: string
}

/** Index of `key`, or -1. */
export const indexOfKey = (rows: NavRow[], key: string | null) =>
  key == null ? -1 : rows.findIndex((r) => r.key === key)

/** Move `delta` rows, stopping at the ends rather than wrapping. */
export function step(rows: NavRow[], from: number, delta: number): number {
  if (rows.length === 0) return -1
  const next = from + delta
  if (next < 0) return 0
  if (next > rows.length - 1) return rows.length - 1
  return next
}

/** First child of the row at `index` — it is simply the next row, when deeper. */
export function firstChild(rows: NavRow[], index: number): number | null {
  const row = rows[index]
  const next = rows[index + 1]
  if (!row || !next) return null
  return next.parentKey === row.key ? index + 1 : null
}

export function parentOf(rows: NavRow[], index: number): number | null {
  const row = rows[index]
  if (!row?.parentKey) return null
  const at = indexOfKey(rows, row.parentKey)
  return at === -1 ? null : at
}

/** Keys of the foldable rows sharing a parent with the one at `index`. */
export function siblingKeys(rows: NavRow[], index: number): string[] {
  const row = rows[index]
  if (!row) return []
  return rows.filter((r) => r.parentKey === row.parentKey && r.expandable).map((r) => r.key)
}

/**
 * Next row whose label starts with `query`, searching after `from` and wrapping
 * round. Both sides are lower-cased, which is all the comparison needs for
 * Cyrillic as well as Latin.
 */
export function typeAhead(rows: NavRow[], from: number, query: string): number | null {
  const q = query.toLowerCase()
  if (!q || rows.length === 0) return null
  for (let i = 1; i <= rows.length; i++) {
    const at = (from + i + rows.length) % rows.length
    if (rows[at].label.toLowerCase().startsWith(q)) return at
  }
  return null
}

/** How long a type-ahead stays open for the next letter. */
const TYPE_AHEAD_MS = 700

export interface TreeNavOptions<R extends NavRow> {
  /** The rows on screen, in the order they are drawn. */
  rows: R[]
  /** Where focus starts: usually the selected row. */
  preferredKey?: string | null
  /** Fold or unfold one node. */
  onToggle: (key: string, open: boolean) => void
  /** Enter / Space on a row. */
  onActivate: (row: R) => void
  /** Unfold several at once — `*` on a row. Falls back to onToggle per key. */
  onExpandMany?: (keys: string[]) => void
  /**
   * False while a search forces every node open: folding would then change
   * nothing on screen while quietly rewriting the stored state, so ← climbs to
   * the parent instead.
   */
  canFold?: boolean
  /** Escape on a row — usually "clear the search". */
  onEscape?: () => void
}

/** What a row element needs for the roving tabindex, ARIA and the focus ring. */
export interface TreeRowAria {
  'data-tree-key': string
  role: 'treeitem'
  tabIndex: number
  'aria-level': number
  'aria-selected': boolean
  'aria-expanded'?: boolean
  className: string
}

export interface RowPropsOptions {
  /** 1-based depth, for aria-level. */
  level: number
  selected?: boolean
  /** Added next to the focus-ring class. */
  className?: string
}

export function useTreeNav<R extends NavRow>({
  rows,
  preferredKey,
  onToggle,
  onActivate,
  onExpandMany,
  canFold = true,
  onEscape,
}: TreeNavOptions<R>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const typeAheadRef = useRef({ buffer: '', at: 0 })
  const [focusKey, setFocusKey] = useState<string | null>(null)

  // A focused row that a filter or a fold has taken off screen must not keep
  // the tab stop: fall back to the selection, then to the first row.
  const focusedKey =
    focusKey && indexOfKey(rows, focusKey) !== -1
      ? focusKey
      : preferredKey && indexOfKey(rows, preferredKey) !== -1
        ? preferredKey
        : (rows[0]?.key ?? null)

  /** Move the tab stop AND the real focus — the keyboard path. */
  const focusRow = useCallback((key: string | null) => {
    setFocusKey(key)
    if (!key) return
    // After a frame: unfolding a node adds its children on the next render, and
    // the row being moved to may be one of them.
    requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector<HTMLElement>(
        `[data-tree-key="${CSS.escape(key)}"]`,
      )
      el?.focus({ preventScroll: true })
      el?.scrollIntoView({ block: 'nearest' })
    })
  }, [])

  /** Put the keyboard in the tree, on the row it was last on. */
  const focusTree = useCallback(() => focusRow(focusedKey), [focusRow, focusedKey])

  /** Clicking a row only moves the tab stop; the pointer already has focus. */
  const pointerFocus = useCallback((key: string) => setFocusKey(key), [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (rows.length === 0) return
    const idx = Math.max(0, indexOfKey(rows, focusedKey))
    const row = rows[idx]
    const move = (to: number | null) => {
      if (to == null || to < 0) return
      focusRow(rows[to].key)
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        return move(step(rows, idx, 1))
      case 'ArrowUp':
        e.preventDefault()
        return move(step(rows, idx, -1))
      case 'PageDown':
        e.preventDefault()
        return move(step(rows, idx, 10))
      case 'PageUp':
        e.preventDefault()
        return move(step(rows, idx, -10))
      case 'Home':
        e.preventDefault()
        return move(0)
      case 'End':
        e.preventDefault()
        return move(rows.length - 1)
      case 'ArrowRight':
        e.preventDefault()
        if (row.expandable && !row.expanded) {
          // Unfold in place; the next → steps into the children.
          onToggle(row.key, true)
          return
        }
        return move(firstChild(rows, idx))
      case 'ArrowLeft':
        e.preventDefault()
        if (canFold && row.expandable && row.expanded) {
          onToggle(row.key, false)
          return
        }
        return move(parentOf(rows, idx))
      case 'Enter':
      case ' ':
        e.preventDefault()
        return onActivate(row)
      case '*':
        // Unfold everything at this level — the quickest way to see one
        // branch's worth of lumgs, or one lumg's worth of calculators.
        e.preventDefault()
        if (onExpandMany) onExpandMany(siblingKeys(rows, idx))
        else for (const key of siblingKeys(rows, idx)) onToggle(key, true)
        return
      case 'Escape':
        if (onEscape) {
          e.preventDefault()
          onEscape()
        }
        return
      default: {
        // Type-ahead: letters jump to the next row starting with what was
        // typed, the way a file list does. Single characters only, so this
        // never swallows a shortcut.
        if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return
        const now = Date.now()
        const prev = typeAheadRef.current
        const buffer = now - prev.at < TYPE_AHEAD_MS ? prev.buffer + e.key : e.key
        typeAheadRef.current = { buffer, at: now }
        // A growing buffer re-examines the current row first, so the focus
        // stays put while the word being typed still matches it.
        const hit = typeAhead(rows, buffer.length > 1 ? idx - 1 : idx, buffer)
        if (hit != null) {
          e.preventDefault()
          move(hit)
        }
      }
    }
  }

  /** Spread onto the element that draws one row. */
  const rowProps = (
    row: R,
    { level, selected = false, className }: RowPropsOptions,
  ): TreeRowAria => ({
    'data-tree-key': row.key,
    role: 'treeitem' as const,
    // Roving tabindex: exactly one row is a tab stop, so Tab crosses the whole
    // tree in one press and the arrows do the walking. Three hundred lines
    // meant three hundred tab stops before this.
    tabIndex: row.key === focusedKey ? 0 : -1,
    'aria-level': level,
    'aria-selected': selected,
    ...(row.expandable ? { 'aria-expanded': row.expanded } : {}),
    className: className ? `hlv-tree-row ${className}` : 'hlv-tree-row',
  })

  const rowIndex = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows])

  /**
   * Row props by key, for a tree drawn nested rather than from the flat list.
   * A row inside a folded node is missing from that list — Mantine keeps
   * collapsed children mounted — so it gets the same shape with no tab stop:
   * present in the DOM, not on screen.
   */
  const propsFor = (key: string, opts: RowPropsOptions): TreeRowAria => {
    const row = rowIndex.get(key)
    if (row) return rowProps(row, opts)
    return {
      'data-tree-key': key,
      role: 'treeitem',
      tabIndex: -1,
      'aria-level': opts.level,
      'aria-selected': !!opts.selected,
      className: opts.className ? `hlv-tree-row ${opts.className}` : 'hlv-tree-row',
    }
  }

  /** Spread onto the element wrapping the rows. */
  const containerProps = {
    ref: containerRef,
    role: 'tree' as const,
    onKeyDown,
  }

  return { focusedKey, focusRow, focusTree, pointerFocus, rowProps, propsFor, containerProps }
}
