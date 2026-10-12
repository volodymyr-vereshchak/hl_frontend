import { describe, it, expect } from 'vitest'
import {
  firstChild,
  indexOfKey,
  parentOf,
  siblingKeys,
  step,
  typeAhead,
} from '@/lib/treeNav'
import {
  branchKey,
  calcKey,
  flattenTree,
  isNodeOpen,
  lineKey,
  lumgKey,
} from './treeRows'
import type { TreeBranch, TreeLine } from './useTreeData'

const line = (id: number, name: string, kind: TreeLine['kind'] = 'physical'): TreeLine => ({
  id,
  name,
  kind,
  meta: { kind },
})

/**
 * Two branches; the first has a lumg with one calculator (two lines) plus a
 * virtual and a DPD line, the second is empty of lumgs.
 */
const TREE: TreeBranch[] = [
  {
    id: 1,
    name: 'Дніпропетровська',
    lumgs: [
      {
        id: 10,
        name: 'Кам’янське',
        calcs: [
          {
            id: 100,
            name: 'основа',
            typeName: 'ВЕГА',
            lines: [line(1000, 'Лінія 1'), line(1001, 'Лінія 2')],
          },
        ],
        virtualLines: [line(2000, 'Сума ГРС', 'virtual')],
        dpdLines: [line(3000, 'ДПД точка', 'dpd')],
      },
    ],
  },
  { id: 2, name: 'Запорізька', lumgs: [] },
]

describe('isNodeOpen', () => {
  it('prefers the stored state, then the default', () => {
    expect(isNodeOpen({ b1: false }, 'b1', { defaultOpen: true })).toBe(false)
    expect(isNodeOpen({}, 'b1', { defaultOpen: true })).toBe(true)
    expect(isNodeOpen({}, 'l10')).toBe(false)
  })

  it('a search in progress opens everything, stored state notwithstanding', () => {
    expect(isNodeOpen({ l10: false }, 'l10', { forceOpen: true })).toBe(true)
  })
})

describe('flattenTree', () => {
  it('lists branches only while they are folded', () => {
    const rows = flattenTree(TREE, { b1: false })
    expect(rows.map((r) => r.key)).toEqual([branchKey(1), branchKey(2)])
    expect(rows[0].expanded).toBe(false)
    // An empty branch offers nothing to unfold.
    expect(rows[1].expandable).toBe(false)
  })

  it('branches start open, so their lumgs are visible without a stored state', () => {
    const rows = flattenTree(TREE, {})
    expect(rows.map((r) => r.key)).toEqual([branchKey(1), lumgKey(10), branchKey(2)])
  })

  it('walks calcs, their lines, then the lumg-level virtual and DPD lines', () => {
    const rows = flattenTree(TREE, { l10: true, c100: true })
    expect(rows.map((r) => r.key)).toEqual([
      branchKey(1),
      lumgKey(10),
      calcKey(100),
      'pl1000',
      'pl1001',
      'vl2000',
      'dl3000',
      branchKey(2),
    ])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 3, 3, 2, 2, 0])
  })

  it('keeps line keys clear of node keys that share the number', () => {
    expect(lineKey(line(10, 'x'))).not.toBe(lumgKey(10))
  })

  it('carries the selection a node stands for', () => {
    const rows = flattenTree(TREE, { l10: true })
    expect(rows[1].group).toEqual({ kind: 'lumg', id: 10, name: 'Кам’янське' })
    expect(rows[0].group).toEqual({ kind: 'branch', id: 1, name: 'Дніпропетровська' })
  })

  it('a search forces every level open', () => {
    const rows = flattenTree(TREE, {}, true)
    expect(rows.some((r) => r.key === 'pl1000')).toBe(true)
  })
})

describe('movement', () => {
  const rows = flattenTree(TREE, { l10: true, c100: true })

  it('stops at the ends instead of wrapping', () => {
    expect(step(rows, 0, -1)).toBe(0)
    expect(step(rows, rows.length - 1, 1)).toBe(rows.length - 1)
    expect(step(rows, 0, 3)).toBe(3)
    // A page jump past the end lands on the last row, not nowhere.
    expect(step(rows, 2, 10)).toBe(rows.length - 1)
  })

  it('finds the first child only when the next row really is one', () => {
    expect(firstChild(rows, indexOfKey(rows, calcKey(100)))).toBe(
      indexOfKey(rows, 'pl1000'),
    )
    // A line has no children; the row after it is its sibling.
    expect(firstChild(rows, indexOfKey(rows, 'pl1001'))).toBe(null)
    expect(firstChild(rows, rows.length - 1)).toBe(null)
  })

  it('climbs to the parent from any depth', () => {
    expect(parentOf(rows, indexOfKey(rows, 'pl1000'))).toBe(indexOfKey(rows, calcKey(100)))
    expect(parentOf(rows, indexOfKey(rows, 'vl2000'))).toBe(indexOfKey(rows, lumgKey(10)))
    expect(parentOf(rows, 0)).toBe(null)
  })

  it('siblings for * are the foldable rows under the same parent', () => {
    const keys = siblingKeys(rows, indexOfKey(rows, lumgKey(10)))
    expect(keys).toEqual([lumgKey(10)])
    // Lines are not foldable, so they never appear.
    expect(siblingKeys(rows, indexOfKey(rows, 'pl1000'))).toEqual([])
  })
})

describe('typeAhead', () => {
  const rows = flattenTree(TREE, { l10: true, c100: true })

  it('searches forward and wraps round', () => {
    expect(typeAhead(rows, 0, 'лінія')).toBe(indexOfKey(rows, 'pl1000'))
    expect(typeAhead(rows, indexOfKey(rows, 'pl1000'), 'лінія')).toBe(
      indexOfKey(rows, 'pl1001'),
    )
    // Past the last match it comes back to the first.
    expect(typeAhead(rows, indexOfKey(rows, 'pl1001'), 'лінія')).toBe(
      indexOfKey(rows, 'pl1000'),
    )
  })

  it('ignores case and reports a miss', () => {
    expect(typeAhead(rows, 0, 'ЗАПОР')).toBe(indexOfKey(rows, branchKey(2)))
    expect(typeAhead(rows, 0, 'zzz')).toBe(null)
    expect(typeAhead(rows, 0, '')).toBe(null)
  })
})
