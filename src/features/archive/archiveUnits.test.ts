/**
 * One unit on screen, whatever the rows are stored in.
 *
 * The archive does not hold one unit: each DPD row carries what its corrector
 * reported, and correctors of this fleet report different ones — twelve of
 * them even changed theirs mid-history, so a single period holds both.
 */
import { describe, it, expect } from 'vitest'
import { inOneUnit, reportedUnit } from './useArchiveData'
import { normalizeUnit, convertPressureValue } from '@/domain/pressureUnits'
import type { ArchiveRow } from '@/api/entities'

const row = (period: string, pressure: number, press_unit: string | null): ArchiveRow =>
  ({ period, pressure, press_unit }) as unknown as ArchiveRow

describe('одиниця, в якій приходять рядки', () => {
  it('кгс/см3 — це кгс/см², а не невідома одиниця', () => {
    // What the DPD API calls it, on 157k rows. Taken literally it is unknown,
    // and the value would be shown unconverted under someone else's caption.
    expect(normalizeUnit('кгс/см3')).toBe('кгс/см²')
    expect(normalizeUnit('КГС/СМ3')).toBe('кгс/см²')
    expect(normalizeUnit('kgf/cm2')).toBe('кгс/см²')
    expect(normalizeUnit('MPa')).toBe('МПа')
    expect(normalizeUnit('None')).toBeNull()
    expect(normalizeUnit('МПа')).toBe('МПа')
  })

  it('береться з найновішого рядка, який її назвав', () => {
    const rows = [
      row('2026-09-01', 1.0, 'кгс/см3'),
      row('2026-09-02', 1.0, null),
      row('2026-09-03', 0.1, 'МПа'),
    ]
    expect(reportedUnit(rows)).toBe('МПа')
    expect(reportedUnit([row('2026-09-01', 1, null)])).toBeNull()
    expect(reportedUnit(undefined)).toBeNull()
  })
})

describe('приведення до однієї одиниці', () => {
  it('місяць, у якого одиниця змінилася посеред історії, читається рівно', () => {
    // Прилад 248: кгс/см² до 03.09, МПа після. Той самий тиск.
    const rows = [row('2026-09-02', 1.0198, 'кгс/см3'), row('2026-09-04', 0.1, 'МПа')]

    const inKgf = inOneUnit(rows, 'кгс/см²', 'кгс/см²')
    expect(inKgf[0].pressure).toBeCloseTo(1.0198, 4)
    expect(inKgf[1].pressure).toBeCloseTo(1.0197, 3)
    expect(inKgf.every((r) => r.press_unit === 'кгс/см²')).toBe(true)

    const inMpa = inOneUnit(rows, 'МПа', 'кгс/см²')
    expect(inMpa[0].pressure).toBeCloseTo(0.1, 4)
    expect(inMpa[1].pressure).toBeCloseTo(0.1, 4)
  })

  it('рядок без одиниці читається в тій, що вказана як запасна', () => {
    const rows = [row('2026-09-02', 1.0197, null)]
    expect(inOneUnit(rows, 'МПа', 'кгс/см²')[0].pressure).toBeCloseTo(0.1, 4)
  })

  it('той самий масив назад, коли переводити нічого', () => {
    // ArchiveTable мемоїзована й вимагає стабільних пропсів.
    const rows = [row('2026-09-02', 1.0, 'МПа')]
    expect(inOneUnit(rows, 'МПа', 'МПа')).toBe(rows)
  })

  it('невідома одиниця не перетворюється навмання', () => {
    const rows = [row('2026-09-02', 5, 'папуги')]
    expect(inOneUnit(rows, 'МПа', 'кгс/см²')[0].pressure).toBe(5)
    expect(convertPressureValue(5, 'папуги', 'МПа')).toBe(5)
  })
})
