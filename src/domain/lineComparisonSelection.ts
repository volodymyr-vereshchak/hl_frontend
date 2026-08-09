/**
 * Which lines the «Порівняння ліній» report compares: one main line and the
 * duplicates measured against it.
 *
 * Pure reducers over a plain `{ mainId, duplicateIds }` object, so the screen
 * only has to persist that and re-resolve names from the tree. Storing ONLY
 * ids is deliberate: a line renamed in the admin panel, or one whose pressure
 * unit was changed there, then shows up correctly without being re-picked.
 */

import type { TreeBranch } from '@/features/archive/useTreeData'
import { normalizeUnit } from './pressureUnits'

export interface StoredSelection {
  mainId: number | null
  duplicateIds: number[]
}

export interface ResolvedLine {
  id: number
  name: string
  /** From `gas_volume_line.pressure_unit`; null when the line has none set. */
  pressureUnit: string | null
  calcName?: string
  lumgName?: string
  branchName?: string
}

export interface ResolvedSelection {
  main: ResolvedLine | null
  duplicates: ResolvedLine[]
  /** Stored ids the tree no longer offers — deleted, or not permitted. */
  missingIds: number[]
}

export const EMPTY_SELECTION: StoredSelection = { mainId: null, duplicateIds: [] }

export function clearSelection(): StoredSelection {
  return { ...EMPTY_SELECTION, duplicateIds: [] }
}

/**
 * Every PHYSICAL line of the tree, by id.
 *
 * Only `branch.lumgs[].calcs[].lines` — the same walk `linesOfGroup` uses.
 * Кільця carry volume but no pressure or temperature, and ДПД lines come from
 * different endpoints with their unit in the row, so neither can be compared
 * here. The `kind` check is belt and braces against a future tree change.
 */
function physicalLines(tree: TreeBranch[] | undefined): Map<number, ResolvedLine> {
  const out = new Map<number, ResolvedLine>()
  for (const branch of tree ?? []) {
    for (const lumg of branch.lumgs) {
      for (const calc of lumg.calcs) {
        for (const line of calc.lines) {
          if (line.kind !== 'physical') continue
          out.set(line.id, {
            id: line.id,
            name: line.name,
            pressureUnit: normalizeUnit(line.meta?.pressure_unit),
            calcName: calc.name,
            lumgName: lumg.name,
            branchName: branch.name,
          })
        }
      }
    }
  }
  return out
}

/** The lines of the tree this report is allowed to offer, in tree order. */
export function comparableLines(tree: TreeBranch[] | undefined): ResolvedLine[] {
  return [...physicalLines(tree).values()]
}

/**
 * Names and units for the stored ids.
 *
 * Never mutates and never prunes: a transient tree-load failure must not wipe
 * the user's selection. Ids the tree does not offer come back in `missingIds`
 * so the screen can say so and let the user drop them explicitly.
 */
export function resolveSelection(
  tree: TreeBranch[] | undefined,
  stored: StoredSelection,
): ResolvedSelection {
  const known = physicalLines(tree)
  const missingIds: number[] = []

  const take = (id: number): ResolvedLine | null => {
    const hit = known.get(id)
    if (!hit) {
      missingIds.push(id)
      return null
    }
    return hit
  }

  const main = stored.mainId == null ? null : take(stored.mainId)
  const duplicates = stored.duplicateIds
    .filter((id) => id !== stored.mainId)
    .map(take)
    .filter((l): l is ResolvedLine => l !== null)

  return { main, duplicates, missingIds }
}

/**
 * Make `id` the main line, keeping the previous one as a duplicate.
 *
 * A swap rather than a replacement: «а якщо еталоном вважати другу?» is one
 * click, and nothing the user picked is lost answering it.
 */
export function promoteToMain(sel: StoredSelection, id: number): StoredSelection {
  if (sel.mainId === id) return sel
  const duplicateIds = sel.duplicateIds.filter((d) => d !== id)
  if (sel.mainId != null && !duplicateIds.includes(sel.mainId)) {
    duplicateIds.push(sel.mainId)
  }
  return { mainId: id, duplicateIds }
}

/** In or out of the comparison. The first line picked becomes the main. */
export function toggleLine(sel: StoredSelection, id: number): StoredSelection {
  if (sel.mainId === id) return removeLine(sel, id)
  if (sel.mainId == null && sel.duplicateIds.length === 0) {
    return { mainId: id, duplicateIds: [] }
  }
  return sel.duplicateIds.includes(id)
    ? { ...sel, duplicateIds: sel.duplicateIds.filter((d) => d !== id) }
    : { ...sel, duplicateIds: [...sel.duplicateIds, id] }
}

/**
 * Drop a line. Removing the MAIN promotes the first duplicate rather than
 * leaving a selection the report cannot be run with.
 */
export function removeLine(sel: StoredSelection, id: number): StoredSelection {
  if (sel.mainId !== id) {
    return { ...sel, duplicateIds: sel.duplicateIds.filter((d) => d !== id) }
  }
  const [next, ...rest] = sel.duplicateIds
  return next === undefined ? clearSelection() : { mainId: next, duplicateIds: rest }
}

/** Add several at once (the ГРС "add all" button), filling an empty main. */
export function addMany(sel: StoredSelection, ids: number[]): StoredSelection {
  let next = sel
  for (const id of ids) {
    if (next.mainId === id || next.duplicateIds.includes(id)) continue
    next =
      next.mainId == null && next.duplicateIds.length === 0
        ? { mainId: id, duplicateIds: [] }
        : { ...next, duplicateIds: [...next.duplicateIds, id] }
  }
  return next
}

/** Is this line part of the comparison at all? */
export function isSelected(sel: StoredSelection, id: number): boolean {
  return sel.mainId === id || sel.duplicateIds.includes(id)
}
