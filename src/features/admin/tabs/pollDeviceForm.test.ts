import { describe, expect, it } from 'vitest'

import {
  normalisePhone,
  normalisePollTimes,
  phoneError,
  pollDevicePayload,
} from './pollDeviceForm'

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

describe('pollDevicePayload', () => {
  it('leaves an untouched card switched on', () => {
    // The tab seeds these through createDefaults, because CrudTable starts
    // every checkbox unticked — without that a card added without touching
    // them was created switched off, and nothing on screen said so.
    const body = pollDevicePayload({})
    expect(body.enabled).toBe(true)
    expect(body.auto_poll).toBe(true)
  })

  it('respects an explicit off', () => {
    const body = pollDevicePayload({ enabled: false, auto_poll: false })
    expect(body.enabled).toBe(false)
    expect(body.auto_poll).toBe(false)
  })

  it('drops the hours when the schedule is off', () => {
    // Keeping them would leave a card that looks scheduled and is not.
    const body = pollDevicePayload({ auto_poll: false, poll_times: ['06:00'] })
    expect(body.poll_times).toBeNull()
  })

  it('keeps the hours when it is on', () => {
    const body = pollDevicePayload({ auto_poll: true, poll_times: ['18:00', '06:00'] })
    expect(body.poll_times).toEqual(['06:00', '18:00'])
  })

  it('normalises the phone on the way out', () => {
    expect(pollDevicePayload({ phone: ' 050 123-45-67 ' }).phone).toBe('+380501234567')
    expect(pollDevicePayload({ phone: '   ' }).phone).toBeNull()
  })

  it('sends a numeric priority, because the select works in strings', () => {
    expect(pollDevicePayload({ priority: '3' }).priority).toBe(3)
    expect(pollDevicePayload({}).priority).toBe(0)
  })

  it('sends blank text as null rather than as an empty string', () => {
    expect(pollDevicePayload({ note: '' }).note).toBeNull()
  })

  it('carries neither a speed nor a driver nor a depth', () => {
    // Speed belongs to the agent, the driver to the corrector's model, and
    // there is no depth at all: the first poll takes the whole archive and
    // later ones fill in what is missing.
    const body = pollDevicePayload({})
    expect(body).not.toHaveProperty('baud')
    expect(body).not.toHaveProperty('protocol_id')
    expect(body).not.toHaveProperty('depth_days')
  })
})
