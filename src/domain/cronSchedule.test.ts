import { describe, expect, it } from 'vitest'
import { cronError, describeCron, CRON_PRESETS } from './cronSchedule'

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
