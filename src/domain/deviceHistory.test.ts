import { describe, it, expect } from 'vitest'
import { hasGap, resolveWindows } from './deviceHistory'

const entry = (installedFrom: string, removedAt = '') => ({ installedFrom, removedAt })

/**
 * These mirror the backend's window rule. They matter because the admin form
 * shows the resulting «з … до …» before anything is saved: if the two ever
 * disagree, the form promises one thing and the archive does another.
 */
describe('resolveWindows', () => {
  it('leaves a single device open-ended', () => {
    expect(resolveWindows([entry('2026-03-01T07:00:00')])).toEqual([
      { entry: entry('2026-03-01T07:00:00'), from: '2026-03-01T07:00:00', to: null },
    ])
  })

  it('chains one device to the next install', () => {
    const windows = resolveWindows([entry('2026-03-10T07:00:00'), entry('2026-03-01T07:00:00')])
    expect(windows.map((w) => [w.from, w.to])).toEqual([
      ['2026-03-01T07:00:00', '2026-03-10T07:00:00'],
      ['2026-03-10T07:00:00', null],
    ])
  })

  it('closes a window at the removal when it precedes the next install', () => {
    const windows = resolveWindows([
      entry('2026-03-01T07:00:00', '2026-03-05T07:00:00'),
      entry('2026-03-10T07:00:00'),
    ])
    expect(windows[0].to).toBe('2026-03-05T07:00:00')
    expect(windows[1].from).toBe('2026-03-10T07:00:00')
  })

  it('ignores a removal later than the next install', () => {
    // Two devices can never both be in force; the chain wins.
    const windows = resolveWindows([
      entry('2026-03-01T07:00:00', '2026-03-20T07:00:00'),
      entry('2026-03-10T07:00:00'),
    ])
    expect(windows[0].to).toBe('2026-03-10T07:00:00')
  })

  it('splits on the hour, not the day', () => {
    const windows = resolveWindows([
      entry('2026-03-01T07:00:00'),
      entry('2026-03-10T14:00:00'),
    ])
    expect(windows[0].to).toBe('2026-03-10T14:00:00')
  })
})

describe('hasGap', () => {
  it('is false for a plain chain', () => {
    expect(hasGap([entry('2026-03-01T07:00:00'), entry('2026-03-10T07:00:00')])).toBe(false)
  })

  it('is true when the device was taken off before the next arrived', () => {
    expect(
      hasGap([
        entry('2026-03-01T07:00:00', '2026-03-05T07:00:00'),
        entry('2026-03-10T07:00:00'),
      ]),
    ).toBe(true)
  })

  it('is false for a trailing removal — the point simply has no device now', () => {
    expect(hasGap([entry('2026-03-01T07:00:00', '2026-03-05T07:00:00')])).toBe(false)
  })
})
