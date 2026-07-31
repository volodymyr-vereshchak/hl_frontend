import { describe, it, expect } from 'vitest'
import {
  SLANTED_LABEL_W,
  SLANT_ABOVE,
  UPRIGHT_LABEL_W,
  labelPixels,
  timeAxisHeight,
} from './TimeAxisTick'

/** What ArchiveChart does with these numbers, kept in one place to check. */
function plan(points: number, plotArea: number, label: string) {
  const slanted = points > Math.floor(plotArea / UPRIGHT_LABEL_W) * SLANT_ABOVE
  const maxTicks = Math.max(2, Math.floor(plotArea / (slanted ? SLANTED_LABEL_W : UPRIGHT_LABEL_W)))
  const step = Math.max(1, Math.ceil(points / maxTicks))
  return {
    slanted,
    ticks: Math.ceil(points / step),
    height: slanted ? timeAxisHeight(true, labelPixels(label)) : timeAxisHeight(points > 31),
  }
}

const WIDE = 900 // a maximised pane
const NARROW = 420 // the tree takes 420 px of a 1366 screen

describe('axis label planning', () => {
  it('keeps a month upright — every other day still reads fine', () => {
    const month = plan(31, WIDE, '17.05')
    expect(month.slanted).toBe(false)
    expect(month.ticks).toBeGreaterThanOrEqual(15)
  })

  it('slants a year instead of dropping five sixths of the dates', () => {
    const upright = Math.floor(WIDE / UPRIGHT_LABEL_W)
    const year = plan(365, WIDE, '17.05')
    expect(year.slanted).toBe(true)
    expect(year.ticks).toBeGreaterThan(upright * 2)
  })

  it('slants sooner in a narrow pane, where less fits', () => {
    expect(plan(31, NARROW, '17.05').slanted).toBe(true)
    expect(plan(31, WIDE, '17.05').slanted).toBe(false)
  })

  it('gives the slanted axis room for the whole label', () => {
    // The bug this replaces: the axis kept the upright height and recharts
    // clipped the ends off the dates.
    const short = timeAxisHeight(true, labelPixels('17.05'))
    const long = timeAxisHeight(true, labelPixels('17.05 07:00'))
    expect(short).toBeGreaterThan(timeAxisHeight(false))
    expect(long).toBeGreaterThan(short)
    // Its own diagonal, not its full length.
    expect(long).toBeLessThan(labelPixels('17.05 07:00'))
  })

  it('never asks for fewer than two ticks, however cramped', () => {
    expect(plan(365, 40, '17.05').ticks).toBeGreaterThanOrEqual(2)
  })
})
