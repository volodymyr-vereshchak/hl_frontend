/**
 * Form ↔ API conversion for the corrector history.
 *
 * The rules that matter here are the ones the archive depends on: «від
 * початку» must survive a round trip without inventing an install date, and a
 * date entered without an hour must land on the start of the commercial day
 * rather than midnight — with 00:00 the hours before it belong to the previous
 * commercial day and would be attributed to the wrong device.
 */
import { describe, expect, it } from 'vitest'
import type { EnterpriseDevice } from '@/api/admin'
import { EMPTY_DEVICE, parseTypedDate, toDeviceForms, toDevicePayload } from './deviceHistoryForm'

const TYPES = [{ id: 7, manufacturer_id: 3, model_name: 'ВЕГА-1.01', type_dev: 3 }]

const device = (over: Partial<EnterpriseDevice> = {}): EnterpriseDevice => ({
  ser_num: 4501,
  corector_type_id: 7,
  ch_num: 0,
  installed_from: '2026-03-10T14:00:00',
  ...over,
})

describe('toDeviceForms', () => {
  it('shows a from-the-beginning device as an empty date', () => {
    const [row] = toDeviceForms([device({ installed_from: '2000-01-01T00:00:00' })], TYPES)
    expect(row.installed_date).toBe('')
    // Re-saving it must not invent 01.01.2000 as a real install moment.
    expect(toDevicePayload([row])[0].installed_from).toBe('2000-01-01T00:00:00')
  })

  it('keeps the install hour through a round trip', () => {
    const [row] = toDeviceForms([device()], TYPES)
    expect(row.installed_date).toBe('2026-03-10')
    expect(row.installed_hour).toBe(14)
    expect(toDevicePayload([row])[0].installed_from).toBe('2026-03-10T14:00:00')
  })

  it('back-derives the manufacturer so the model select is filtered', () => {
    const [row] = toDeviceForms([device()], TYPES)
    expect(row.manufacturer_id).toBe('3')
    expect(row.corector_type_id).toBe('7')
  })

  it('carries an explicit removal, and leaves it out when there is none', () => {
    const [withRemoval] = toDeviceForms([device({ removed_at: '2026-03-05T07:00:00' })], TYPES)
    expect(withRemoval.removed_date).toBe('2026-03-05')
    expect(toDevicePayload([withRemoval])[0].removed_at).toBe('2026-03-05T07:00:00')

    const [open] = toDeviceForms([device()], TYPES)
    expect(toDevicePayload([open])[0].removed_at).toBeNull()
  })
})

describe('toDevicePayload', () => {
  it('defaults a dated install to the start of the commercial day', () => {
    const payload = toDevicePayload([
      { ...EMPTY_DEVICE, ser_num: '4501', installed_date: '2026-03-10' },
    ])
    expect(payload[0].installed_from).toBe('2026-03-10T07:00:00')
  })

  it('sends a missing corrector type as null, not 0', () => {
    const payload = toDevicePayload([{ ...EMPTY_DEVICE, ser_num: '4501' }])
    expect(payload[0].corector_type_id).toBeNull()
  })
})

/**
 * Typing a date instead of clicking through a calendar. The refusals matter
 * more than the acceptances: a date the field silently drops leaves the row
 * looking filled in while the form holds nothing, and a date that rolls over
 * (31.02 → 03.03) attributes the archive to the wrong corrector.
 */
describe('parseTypedDate', () => {
  it('takes the format the field shows', () => {
    expect(parseTypedDate('05.03.2026')).toBe('2026-03-05')
  })

  it('takes a single-digit day and month', () => {
    expect(parseTypedDate('5.3.2026')).toBe('2026-03-05')
  })

  it('takes eight digits with no separators', () => {
    expect(parseTypedDate('05032026')).toBe('2026-03-05')
  })

  it('takes slashes and dashes', () => {
    expect(parseTypedDate('05/03/2026')).toBe('2026-03-05')
    expect(parseTypedDate('05-03-2026')).toBe('2026-03-05')
  })

  it('takes the stored form back, for a pasted value', () => {
    expect(parseTypedDate('2026-03-05')).toBe('2026-03-05')
  })

  it('ignores surrounding spaces', () => {
    expect(parseTypedDate('  05.03.2026 ')).toBe('2026-03-05')
  })

  it('refuses a day that month does not have', () => {
    expect(parseTypedDate('31.02.2026')).toBeNull()
    expect(parseTypedDate('31.04.2026')).toBeNull()
  })

  it('knows which februaries have 29 days', () => {
    expect(parseTypedDate('29.02.2028')).toBe('2028-02-29')
    expect(parseTypedDate('29.02.2026')).toBeNull()
  })

  it('refuses a month out of range', () => {
    expect(parseTypedDate('05.13.2026')).toBeNull()
    expect(parseTypedDate('05.00.2026')).toBeNull()
  })

  it('refuses a year that is clearly a typo', () => {
    expect(parseTypedDate('05.03.226')).toBeNull()
    expect(parseTypedDate('05.03.1026')).toBeNull()
  })

  it('refuses half-typed and non-date text', () => {
    expect(parseTypedDate('05.03')).toBeNull()
    expect(parseTypedDate('вчора')).toBeNull()
    expect(parseTypedDate('')).toBeNull()
    expect(parseTypedDate('   ')).toBeNull()
  })
})
