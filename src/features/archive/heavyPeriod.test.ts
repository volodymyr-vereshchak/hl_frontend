import { describe, it, expect } from 'vitest'
import { uk } from '@/locales/uk'
import { ru } from '@/locales/ru'
import { overlayWarningLines } from './heavyPeriod'

const t = (dict: Record<string, string>) => (key: string) => dict[key] ?? key
const YEAR = { fromDate: '2026-01-01', toDate: '2026-12-31' }

describe('overlayWarningLines', () => {
  it('names the period, what will run and how long it takes', () => {
    expect(overlayWarningLines(YEAR, t(uk as unknown as Record<string, string>))).toEqual([
      'Період: 01.01.2026 – 31.12.2026 (365 дн.)',
      'Опитування промисловості звертається до ДПД по кожному підприємству лінії.',
      'За період понад 30 днів дані тягнуться з ДПД на вимогу — це може тривати кілька хвилин.',
    ])
  })

  it('is fully translated in both languages', () => {
    for (const dict of [uk, ru]) {
      const lines = overlayWarningLines(YEAR, t(dict as unknown as Record<string, string>))
      // A missing key falls through as the key itself — catch that.
      for (const line of lines) expect(line).not.toMatch(/^(period|overlay)[A-Z]/)
    }
  })
})
