import { describe, expect, it } from 'vitest'
import { CRON_EXAMPLES } from './CronHelp'
import { cronError, describeCron } from '@/domain/cronSchedule'

/**
 * The help is text, and text about syntax goes stale silently. These examples
 * are clickable — one of them lands in the field and is saved — so a typo in
 * the reference is a schedule nobody can save, found by the operator and not
 * by us.
 */
describe('приклади в довідці про cron', () => {
  it('усі приймаються тією самою перевіркою, що й поле', () => {
    for (const example of CRON_EXAMPLES) {
      expect(cronError(example.cron), example.cron).toBeNull()
    }
  })

  it('кожен переказується словами, а не мовчить', () => {
    for (const example of CRON_EXAMPLES) {
      expect(describeCron(example.cron), example.cron).not.toBe('')
    }
  })

  it('однакових виразів немає', () => {
    const seen = new Set(CRON_EXAMPLES.map((e) => e.cron))
    expect(seen.size).toBe(CRON_EXAMPLES.length)
  })
})
