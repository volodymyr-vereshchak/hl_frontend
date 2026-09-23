import { describe, expect, it } from 'vitest'
import { daysBetween, describeRange, humanDate } from './lineArchiveRange'

const extent = { first: '2024-01-01', last: '2026-09-23' }

describe('describeRange', () => {
  it('says what to do when neither end is filled', () => {
    const verdict = describeRange(null, null, extent)
    expect(verdict.kind).toBe('none')
    expect(verdict.text).toContain('Лишіть початок порожнім')
  })

  it('reads a start on its own as everything after it', () => {
    const verdict = describeRange('2026-09-01', null, extent)
    expect(verdict.kind).toBe('from')
    expect(verdict.text).toBe(
      'Буде видалено все від 01.09.2026 і новіше, до кінця архіву (23.09.2026)',
    )
  })

  it('reads an end on its own as everything up to it', () => {
    const verdict = describeRange(null, '2026-09-01', extent)
    expect(verdict.kind).toBe('to')
    expect(verdict.text).toBe(
      'Буде видалено все до 01.09.2026 включно, від початку архіву (01.01.2024)',
    )
  })

  it('leaves the archive out of it when the line has none', () => {
    const verdict = describeRange('2026-09-01', null, { first: null, last: null })
    expect(verdict.text).toBe('Буде видалено все від 01.09.2026 і новіше')
  })

  it('counts both days of a span', () => {
    const verdict = describeRange('2026-09-01', '2026-09-03', extent)
    expect(verdict).toMatchObject({ kind: 'span', days: 3 })
    expect(verdict.text).toContain('з 01.09.2026 по 03.09.2026 включно')
  })

  it('counts a single day as one', () => {
    expect(describeRange('2026-09-01', '2026-09-01', extent)).toMatchObject({ days: 1 })
  })

  it('refuses a start later than the end instead of guessing', () => {
    expect(describeRange('2026-09-03', '2026-09-01', extent).kind).toBe('backwards')
  })
})

describe('the small pieces', () => {
  it('shows a date the way it is written here', () => {
    expect(humanDate('2026-09-23')).toBe('23.09.2026')
    expect(humanDate(null)).toBe('')
  })

  it('counts days across a month boundary', () => {
    expect(daysBetween('2026-08-30', '2026-09-02')).toBe(4)
  })
})
