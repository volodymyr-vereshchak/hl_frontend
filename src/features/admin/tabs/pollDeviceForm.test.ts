import { describe, expect, it } from 'vitest'

import { normalisePhone, normalisePollTimes, phoneError } from './pollDeviceForm'

describe('normalisePhone', () => {
  it('accepts the shapes people write and gives back one', () => {
    // All the same line, written however it was written down. The agent hands
    // the result straight to ATDP, so it has to be one shape.
    for (const raw of [
      '+380501234567',
      '380501234567',
      '0501234567',
      '80501234567',
      ' +38 (050) 123-45-67 ',
    ]) {
      expect(normalisePhone(raw)).toBe('+380501234567')
    }
  })

  it('refuses what a modem cannot dial', () => {
    for (const raw of ['050123456', '05012345678', '+7501234567', 'у бухгалтерії']) {
      expect(normalisePhone(raw)).toBeNull()
    }
  })

  it('treats an empty box as no number rather than a bad one', () => {
    // A card can exist before somebody finds out the number.
    expect(normalisePhone('')).toBeNull()
    expect(phoneError('')).toBeNull()
    expect(phoneError('050123456')).toBeTruthy()
  })
})

describe('normalisePollTimes', () => {
  it('sorts and pads, because the list is read as a daily rhythm', () => {
    expect(normalisePollTimes(['18:00', '6:5'])).toEqual(['06:05', '18:00'])
  })

  it('drops duplicates and anything that is not an hour', () => {
    expect(normalisePollTimes(['06:00', '06:00', '25:00', 'ранок'])).toEqual(['06:00'])
  })

  it('turns nothing into the global hours, not into no hours', () => {
    // `[]` would leave the device scheduled and never due — a meter simply
    // never dialled, with nothing on screen to say so.
    expect(normalisePollTimes([])).toBeNull()
    expect(normalisePollTimes(null)).toBeNull()
  })
})

