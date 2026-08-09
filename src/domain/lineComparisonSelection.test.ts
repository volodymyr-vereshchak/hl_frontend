import { describe, it, expect } from 'vitest'
import {
  addMany,
  clearSelection,
  comparableLines,
  isSelected,
  promoteToMain,
  removeLine,
  resolveSelection,
  toggleLine,
  type StoredSelection,
} from './lineComparisonSelection'
import type { TreeBranch } from '@/features/archive/useTreeData'

const sel = (mainId: number | null, duplicateIds: number[] = []): StoredSelection => ({
  mainId,
  duplicateIds,
})

/** Branch → ЛУМГ → ГРС → lines, plus a кільце and a ДПД line alongside. */
const TREE: TreeBranch[] = [
  {
    id: 100,
    name: 'Філія',
    lumgs: [
      {
        id: 10,
        name: 'ЛУМГ',
        calcs: [
          {
            id: 1,
            name: 'ГРС основа',
            typeName: null,
            lines: [
              {
                id: 1,
                name: 'Нитка 1',
                kind: 'physical',
                meta: { kind: 'physical', name: 'Нитка 1', pressure_unit: 'кгс/см²' },
              },
              {
                id: 2,
                name: 'Нитка 2',
                kind: 'physical',
                meta: { kind: 'physical', name: 'Нитка 2', pressure_unit: 'бар' },
              },
            ],
          },
        ],
        virtualLines: [
          { id: 900, name: 'Кільце', kind: 'virtual', meta: { kind: 'virtual', name: 'Кільце' } },
        ],
        dpdLines: [
          { id: 800, name: 'ДПД', kind: 'dpd', meta: { kind: 'dpd', name: 'ДПД' } },
        ],
      },
    ],
  },
]

describe('resolveSelection', () => {
  it('resolves names, ГРС context and the pressure unit', () => {
    const r = resolveSelection(TREE, sel(1, [2]))
    expect(r.main).toMatchObject({ id: 1, name: 'Нитка 1', pressureUnit: 'кгс/см²' })
    expect(r.main?.calcName).toBe('ГРС основа')
    expect(r.duplicates.map((d) => d.pressureUnit)).toEqual(['бар'])
    expect(r.missingIds).toEqual([])
  })

  it('never offers a кільце or a ДПД line', () => {
    // They have no pressure/temperature to compare, and DPD carries its unit
    // per row from another endpoint entirely.
    expect(comparableLines(TREE).map((l) => l.id)).toEqual([1, 2])
    const r = resolveSelection(TREE, sel(900, [800]))
    expect(r.main).toBeNull()
    expect(r.duplicates).toEqual([])
    expect(r.missingIds).toEqual([900, 800])
  })

  it('reports unknown ids instead of dropping them', () => {
    const r = resolveSelection(TREE, sel(1, [2, 777]))
    expect(r.duplicates.map((d) => d.id)).toEqual([2])
    expect(r.missingIds).toEqual([777])
  })

  it('keeps the duplicates when the stored main is gone', () => {
    const r = resolveSelection(TREE, sel(777, [1, 2]))
    expect(r.main).toBeNull()
    expect(r.duplicates.map((d) => d.id)).toEqual([1, 2])
  })

  it('a tree that has not loaded yet does not wipe anything', () => {
    const stored = sel(1, [2])
    const r = resolveSelection(undefined, stored)
    expect(r.missingIds).toEqual([1, 2])
    // The input is untouched — the screen keeps its selection and retries.
    expect(stored).toEqual({ mainId: 1, duplicateIds: [2] })
  })

  it('never lets the main appear among the duplicates', () => {
    const r = resolveSelection(TREE, sel(1, [1, 2]))
    expect(r.duplicates.map((d) => d.id)).toEqual([2])
  })
})

describe('promoteToMain', () => {
  it('swaps without losing the previous main', () => {
    expect(promoteToMain(sel(1, [2, 3]), 2)).toEqual({ mainId: 2, duplicateIds: [3, 1] })
  })

  it('promoting the current main changes nothing', () => {
    const s = sel(1, [2])
    expect(promoteToMain(s, 1)).toBe(s)
  })

  it('promoting into an empty selection just sets the main', () => {
    expect(promoteToMain(clearSelection(), 5)).toEqual({ mainId: 5, duplicateIds: [] })
  })
})

describe('toggleLine', () => {
  it('the first line picked becomes the main', () => {
    expect(toggleLine(clearSelection(), 7)).toEqual({ mainId: 7, duplicateIds: [] })
  })

  it('adds and removes duplicates', () => {
    const added = toggleLine(sel(1), 2)
    expect(added.duplicateIds).toEqual([2])
    expect(toggleLine(added, 2).duplicateIds).toEqual([])
  })

  it('toggling the main off removes it and promotes a duplicate', () => {
    expect(toggleLine(sel(1, [2, 3]), 1)).toEqual({ mainId: 2, duplicateIds: [3] })
  })
})

describe('removeLine', () => {
  it('removing the main promotes the first duplicate', () => {
    expect(removeLine(sel(1, [2, 3]), 1)).toEqual({ mainId: 2, duplicateIds: [3] })
  })

  it('removing the last line clears the selection', () => {
    expect(removeLine(sel(1), 1)).toEqual({ mainId: null, duplicateIds: [] })
  })

  it('removing a duplicate leaves the main alone', () => {
    expect(removeLine(sel(1, [2, 3]), 2)).toEqual({ mainId: 1, duplicateIds: [3] })
  })
})

describe('addMany', () => {
  it('fills an empty main from the first id, the rest become duplicates', () => {
    expect(addMany(clearSelection(), [4, 5, 6])).toEqual({
      mainId: 4,
      duplicateIds: [5, 6],
    })
  })

  it('dedupes against what is already selected', () => {
    expect(addMany(sel(1, [2]), [2, 3, 3, 1])).toEqual({ mainId: 1, duplicateIds: [2, 3] })
  })

  it('preserves the order it was given', () => {
    expect(addMany(sel(1), [5, 3, 4]).duplicateIds).toEqual([5, 3, 4])
  })
})

describe('isSelected', () => {
  it('covers the main and the duplicates', () => {
    const s = sel(1, [2])
    expect(isSelected(s, 1)).toBe(true)
    expect(isSelected(s, 2)).toBe(true)
    expect(isSelected(s, 3)).toBe(false)
  })
})
