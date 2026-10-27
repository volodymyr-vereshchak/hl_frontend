import { describe, it, expect } from 'vitest'
import { OverviewCalculator, type HourlyRecord } from './overviewCalculator'
import type { Line } from '@/types'

const line = (over: Partial<Line> & { id: number }): Line =>
  ({
    name: `Лінія ${over.id}`,
    meter: false,
    is_high_pressure: false,
    ...over,
  }) as Line

const record = (over: Partial<HourlyRecord> & { line_id: number }): HourlyRecord => ({
  period: '2026-08-22T10:00:00',
  volume: 100,
  pressure: 5,
  w_volume_dp: 0,
  ...over,
})

/**
 * Which unit a card is captioned with. A ДПД line has no unit configuration
 * anywhere in this app — the corrector reports its own, usually kPa, and it
 * travels in the archive row. Captioning that кгс/см² makes the number under
 * it read as a hundredfold error.
 */
describe('getLastPressures — pressure unit', () => {
  it('takes the configured unit of a physical line', () => {
    const out = OverviewCalculator.getLastPressures(
      [record({ line_id: 1 })],
      [1],
      [line({ id: 1, pressure_unit: 'бар' })],
    )
    expect(out[1].pressureUnit).toBe('бар')
  })

  it('takes the unit off the row when the line has none — the ДПД case', () => {
    const out = OverviewCalculator.getLastPressures(
      [record({ line_id: 2, press_unit: 'кПа' })],
      [2],
      [line({ id: 2, pressure_unit: null })],
    )
    expect(out[2].pressureUnit).toBe('кПа')
    expect(out[2].pressure).toBe(5)
  })

  it('keeps the configured unit even when a row carries one', () => {
    const out = OverviewCalculator.getLastPressures(
      [record({ line_id: 3, press_unit: 'кПа' })],
      [3],
      [line({ id: 3, pressure_unit: 'бар' })],
    )
    expect(out[3].pressureUnit).toBe('бар')
  })

  it('falls back to the project default when neither side says anything', () => {
    // "None" is what part of the correctors send instead of omitting the field.
    const out = OverviewCalculator.getLastPressures(
      [record({ line_id: 4, press_unit: 'None' })],
      [4],
      [line({ id: 4, pressure_unit: null })],
    )
    expect(out[4].pressureUnit).toBe('кгс/см²')
  })
})

/**
 * An idle line can store float noise like 1e-19 instead of 0. As the previous
 * hour it used to be the divisor, and the card showed a ~1e23 % change.
 */
describe('change percent over a near-zero previous value', () => {
  it('last-hour flow treats float noise as zero', () => {
    const [out] = OverviewCalculator.calculateLastHourFlow(
      [
        record({ line_id: 1, period: '2026-08-22T10:00:00', volume: 6.76 }),
        record({ line_id: 1, period: '2026-08-22T09:00:00', volume: 1e-19 }),
      ],
      [1],
    )
    expect(out.previousHour).toBe(0)
    expect(out.change).toBe(6.76)
    expect(out.changePercent).toBe(0)
  })

  it('noise on both hours is no change at all', () => {
    const [out] = OverviewCalculator.calculateLastHourFlow(
      [
        record({ line_id: 1, period: '2026-08-22T10:00:00', volume: 3e-18 }),
        record({ line_id: 1, period: '2026-08-22T09:00:00', volume: 1e-19 }),
      ],
      [1],
    )
    expect(out.change).toBe(0)
    expect(out.isIncrease).toBe(false)
    expect(out.isDecrease).toBe(false)
  })

  it('24h volume treats float noise as zero', () => {
    const [out] = OverviewCalculator.calculate24hVolumeByLine(
      [record({ line_id: 1, volume: 120 })],
      [record({ line_id: 1, volume: 1e-19 })],
      [1],
    )
    expect(out.changePercent).toBe(0)
  })
})

/**
 * An idle line can store float noise like 1e-19 instead of 0. As the previous
 * hour it used to be the divisor, and the card showed a ~1e23 % change.
 */
describe('change percent over a near-zero previous value', () => {
  it('last-hour flow treats float noise as zero', () => {
    const [out] = OverviewCalculator.calculateLastHourFlow(
      [
        record({ line_id: 1, period: '2026-08-22T10:00:00', volume: 6.76 }),
        record({ line_id: 1, period: '2026-08-22T09:00:00', volume: 1e-19 }),
      ],
      [1],
    )
    expect(out.previousHour).toBe(0)
    expect(out.change).toBe(6.76)
    expect(out.changePercent).toBe(0)
  })

  it('noise on both hours is no change at all', () => {
    const [out] = OverviewCalculator.calculateLastHourFlow(
      [
        record({ line_id: 1, period: '2026-08-22T10:00:00', volume: 3e-18 }),
        record({ line_id: 1, period: '2026-08-22T09:00:00', volume: 1e-19 }),
      ],
      [1],
    )
    expect(out.change).toBe(0)
    expect(out.isIncrease).toBe(false)
    expect(out.isDecrease).toBe(false)
  })

  it('a real small previous value still gives a percentage', () => {
    const [out] = OverviewCalculator.calculateLastHourFlow(
      [
        record({ line_id: 1, period: '2026-08-22T10:00:00', volume: 0.2 }),
        record({ line_id: 1, period: '2026-08-22T09:00:00', volume: 0.1 }),
      ],
      [1],
    )
    expect(out.changePercent).toBeCloseTo(100)
  })

  it('24h volume treats float noise as zero', () => {
    const [out] = OverviewCalculator.calculate24hVolumeByLine(
      [record({ line_id: 1, volume: 120 })],
      [record({ line_id: 1, volume: 1e-19 })],
      [1],
    )
    expect(out.changePercent).toBe(0)
  })

  it('total comparison treats float noise as zero', () => {
    const out = OverviewCalculator.calculateComparison(500, 1e-19)
    expect(out.changePercent).toBe(0)
    expect(out.previous).toBe(0)
  })
})
