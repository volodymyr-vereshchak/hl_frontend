/**
 * The table's width used to be written out by hand in a `colSpan`, next to
 * four other places that re-derived the same split of `lines`. These tests pin
 * the arithmetic so the filler row can no longer drift away from the header
 * that it has to span.
 */
import { describe, expect, it } from 'vitest'

import type { FhpLineSeries, FhpParamBlock } from '@/api/fhpReport'
import { fhpLayout } from './fhpColumns'

function line(id: number, isReference: boolean): FhpLineSeries {
  return {
    line_id: id,
    line_name: `Лінія ${id}`,
    is_reference: isReference,
    status: 'ok',
    values: [],
    stale: [],
  }
}

function block(lines: FhpLineSeries[], hasReference: boolean): FhpParamBlock {
  return {
    param: 'density',
    label: 'Густина',
    unit: 'кг/м³',
    decimals: 4,
    tolerance: 0.1,
    tolerance_mode: 'abs',
    has_reference: hasReference,
    periods: [],
    spread_min: [],
    spread_max: [],
    spread: [],
    lines,
    rejected_changes: 0,
  } as FhpParamBlock
}

describe('fhpLayout', () => {
  it('splits the lines the way the header does', () => {
    const l = fhpLayout(block([line(1, true), line(2, false), line(3, false)], true))
    expect(l.reference.map((x) => x.line_id)).toEqual([1])
    expect(l.comparison.map((x) => x.line_id)).toEqual([2, 3])
  })

  it('gives a compared line three columns when there is a reference', () => {
    // Період + еталонна + Еталон + 2×(Знач./Δ/Δ%) = 9
    const l = fhpLayout(block([line(1, true), line(2, false), line(3, false)], true))
    expect(l.perComparison).toBe(3)
    expect(l.total).toBe(9)
  })

  it('gives it one column and adds the spread trio when there is none', () => {
    // Період + 2 лінії + Мін/Макс/Розкид = 6. Nothing to compare against, so
    // no Δ and no Еталон column.
    const l = fhpLayout(block([line(2, false), line(3, false)], false))
    expect(l.perComparison).toBe(1)
    expect(l.total).toBe(6)
  })

  it('counts several reference lines', () => {
    // Два потокові хроматографи: обидва показані, еталон — їх середнє.
    const l = fhpLayout(block([line(1, true), line(2, true), line(3, false)], true))
    expect(l.reference).toHaveLength(2)
    expect(l.total).toBe(1 + 2 + 1 + 3)
  })

  it('handles a block with nothing to compare', () => {
    const l = fhpLayout(block([line(1, true)], true))
    expect(l.comparison).toEqual([])
    expect(l.total).toBe(1 + 1 + 1)
  })

  it('handles an empty block without going negative', () => {
    const l = fhpLayout(block([], false))
    expect(l.total).toBe(1 + 3)
  })
})
