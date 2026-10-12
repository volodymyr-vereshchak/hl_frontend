/**
 * The tree as a flat list of the rows currently on screen.
 *
 * The tree itself renders nested (it folds with an animation, which a flat list
 * cannot do), but keyboard navigation is one-dimensional: ↓ goes to the next
 * *visible* row whatever its depth. Deriving that list from the same data and
 * the same open-state map the renderer uses keeps the two in step — the one
 * thing that must not drift, since the keyboard would otherwise move focus to a
 * row nobody can see.
 *
 * The movement rules themselves are generic and live in lib/treeNav, shared
 * with the other trees in the app; what is here is only the walk over THIS
 * tree's shape.
 */
import type { NavRow } from '@/lib/treeNav'
import type { GroupSelection } from '@/store/selectionStore'
import type { TreeBranch, TreeLine } from './useTreeData'

export type TreeRowKind = 'branch' | 'lumg' | 'calc' | 'line'

export interface TreeRow extends NavRow {
  kind: TreeRowKind
  id: number
  depth: number
  /** Lines only. */
  line?: TreeLine
  /** Nodes only — the selection the row stands for. */
  group?: GroupSelection
}

export type OpenMap = Record<string, boolean>

/**
 * Whether a node shows its children. Shared with the renderer: a search in
 * progress forces every node open, and branches start open.
 */
export function isNodeOpen(
  openMap: OpenMap,
  key: string,
  opts: { defaultOpen?: boolean; forceOpen?: boolean } = {},
): boolean {
  if (opts.forceOpen) return true
  return openMap[key] ?? opts.defaultOpen ?? false
}

/** Keys of the node rows, matching what the renderer persists in `openMap`. */
export const branchKey = (id: number) => `b${id}`
export const lumgKey = (id: number) => `l${id}`
export const calcKey = (id: number) => `c${id}`
/** Line keys live in their own namespace — a line id can equal a lumg id. */
export const lineKey = (line: TreeLine) =>
  `${line.kind === 'virtual' ? 'vl' : line.kind === 'dpd' ? 'dl' : 'pl'}${line.id}`

export function flattenTree(
  branches: TreeBranch[],
  openMap: OpenMap,
  forceOpen = false,
): TreeRow[] {
  const rows: TreeRow[] = []

  const pushLine = (line: TreeLine, depth: number, parentKey: string) =>
    rows.push({
      key: lineKey(line),
      kind: 'line',
      id: line.id,
      depth,
      parentKey,
      label: line.name,
      expandable: false,
      expanded: false,
      line,
    })

  for (const branch of branches) {
    const bKey = branchKey(branch.id)
    const bOpen = isNodeOpen(openMap, bKey, { defaultOpen: true, forceOpen })
    rows.push({
      key: bKey,
      kind: 'branch',
      id: branch.id,
      depth: 0,
      parentKey: null,
      label: branch.name,
      expandable: branch.lumgs.length > 0,
      expanded: bOpen,
      group: { kind: 'branch', id: branch.id, name: branch.name },
    })
    if (!bOpen) continue

    for (const lumg of branch.lumgs) {
      const lKey = lumgKey(lumg.id)
      const lOpen = isNodeOpen(openMap, lKey, { forceOpen })
      rows.push({
        key: lKey,
        kind: 'lumg',
        id: lumg.id,
        depth: 1,
        parentKey: bKey,
        label: lumg.name,
        expandable:
          lumg.calcs.length > 0 || lumg.virtualLines.length > 0 || lumg.dpdLines.length > 0,
        expanded: lOpen,
        group: { kind: 'lumg', id: lumg.id, name: lumg.name },
      })
      if (!lOpen) continue

      for (const calc of lumg.calcs) {
        const cKey = calcKey(calc.id)
        const cOpen = isNodeOpen(openMap, cKey, { forceOpen })
        rows.push({
          key: cKey,
          kind: 'calc',
          id: calc.id,
          depth: 2,
          parentKey: lKey,
          label: calc.typeName ? `${calc.name} · ${calc.typeName}` : calc.name,
          expandable: calc.lines.length > 0,
          expanded: cOpen,
          group: { kind: 'calc', id: calc.id, name: calc.name },
        })
        if (!cOpen) continue
        for (const line of calc.lines) pushLine(line, 3, cKey)
      }
      // Virtual and DPD lines hang off the lumg itself, as the renderer draws them.
      for (const line of lumg.virtualLines) pushLine(line, 2, lKey)
      for (const line of lumg.dpdLines) pushLine(line, 2, lKey)
    }
  }

  return rows
}
