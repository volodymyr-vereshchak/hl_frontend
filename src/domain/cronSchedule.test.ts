import { describe, expect, it } from 'vitest'
import { cronError, describeCron, nextRuns, CRON_PRESETS } from './cronSchedule'

describe('розклад опитування у вигляді cron', () => {
  it('приймає вирази, якими задають опитування', () => {
    for (const { value } of CRON_PRESETS) expect(cronError(value)).toBeNull()
    expect(cronError('30 6-18/2 * * mon-fri')).toBeNull()
  })

  it('порожнє поле — це «за загальним розкладом», а не помилка', () => {
    expect(cronError('')).toBeNull()
    expect(describeCron('')).toBe('За загальним розкладом')
  })

  it('каже, що саме не так', () => {
    expect(cronError('0 8 * *')).toContain("п'ять полів")
    expect(cronError('0 25 * * *')).toContain('поза межами')
    expect(cronError('0 8 * * блабла')).toContain('Не розумію')
    expect(cronError('0 18-6 * * *')).toContain('навпаки')
  })

  it('переказує словами те, що оператор щойно вибрав', () => {
    expect(describeCron('0 * * * *')).toBe('Щогодини')
    expect(describeCron('0 */4 * * *')).toBe('Кожні 4 год')
    expect(describeCron('0 8 * * *')).toBe('Щодня о 08:00')
    expect(describeCron('0 8,20 * * *')).toBe('О 08:00, 20:00')
  })

  it('не називає дві фіксовані години «кожні 12 год»', () => {
    // 8 і 20 стоять на 12 годин одна від одної, але це не ритм від півночі:
    // о 21:00 наступний слот буде о 08:00, а не через 12 годин.
    expect(describeCron('0 8,20 * * *')).not.toContain('Кожні')
  })

  it('усе складніше за добовий ритм називає своїм іменем', () => {
    expect(describeCron('0 8 * * mon')).toBe('За власним розкладом')
    expect(describeCron('0 8 1 * *')).toBe('За власним розкладом')
  })
})

describe('коли вираз спрацює — перевірка без інтернету', () => {
  // The help used to send people to an online cron editor for this. The server
  // has no way out, so the answer is computed here — and has to be right.
  const at = (d: Date) =>
    `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

  it('щоденний розклад дає наступні дні о тій самій годині', () => {
    const runs = nextRuns('0 8 * * *', new Date(2026, 8, 20, 9, 15), 3)
    expect(runs.map(at)).toEqual(['21.09 08:00', '22.09 08:00', '23.09 08:00'])
  })

  it('крок у годинах рахується від півночі', () => {
    const runs = nextRuns('0 */4 * * *', new Date(2026, 8, 20, 9, 15), 3)
    expect(runs.map(at)).toEqual(['20.09 12:00', '20.09 16:00', '20.09 20:00'])
  })

  it('«будні» пропускають суботу й неділю', () => {
    // 2026-09-18 — п'ятниця.
    const runs = nextRuns('0 7 * * 1-5', new Date(2026, 8, 18, 8, 0), 2)
    expect(runs.map(at)).toEqual(['21.09 07:00', '22.09 07:00'])
  })

  it('день місяця і день тижня разом — це «або», а не збіг', () => {
    const runs = nextRuns('0 7 1 * mon', new Date(2026, 8, 20, 8, 0), 3)
    // Понеділки 21 і 28 вересня, а між ними — перше жовтня.
    expect(runs.map(at)).toEqual(['21.09 07:00', '28.09 07:00', '01.10 07:00'])
  })

  it('слот у поточній годині, який уже минув, не пропонується', () => {
    const runs = nextRuns('30 * * * *', new Date(2026, 8, 20, 9, 30), 1)
    expect(runs.map(at)).toEqual(['20.09 10:30'])
  })

  it('порожній і помилковий вираз нічого не обіцяють', () => {
    expect(nextRuns('', new Date())).toEqual([])
    expect(nextRuns('0 8 * *', new Date())).toEqual([])
  })

  it('те, чого не буває, не шукається вічно', () => {
    expect(nextRuns('0 8 30 2 *', new Date(2026, 8, 20), 1)).toEqual([])
  })
})
