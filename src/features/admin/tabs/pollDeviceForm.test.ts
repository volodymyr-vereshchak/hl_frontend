import { describe, expect, it } from 'vitest'

import { parsePollTimes, pollDevicePayload } from './pollDeviceForm'

describe('parsePollTimes', () => {
  it('splits what an operator actually types', () => {
    expect(parsePollTimes('06:00, 18:00')).toEqual(['06:00', '18:00'])
    expect(parsePollTimes('06:00,18:00')).toEqual(['06:00', '18:00'])
    expect(parsePollTimes(' 06:00 ,  18:00 ')).toEqual(['06:00', '18:00'])
  })

  it('turns an empty box into the global hours, not into no hours', () => {
    // `[]` would leave the device scheduled and never due — the failure would
    // be a meter that is simply never dialled, with nothing on screen to say so.
    expect(parsePollTimes('')).toBeNull()
    expect(parsePollTimes('   ')).toBeNull()
    expect(parsePollTimes(undefined)).toBeNull()
    expect(parsePollTimes(', ,')).toBeNull()
  })
})

describe('pollDevicePayload', () => {
  it('leaves an untouched card switched on', () => {
    // Both checkboxes arrive as undefined until somebody clicks them, and a
    // card nobody touched has to poll.
    const body = pollDevicePayload({})
    expect(body.enabled).toBe(true)
    expect(body.auto_poll).toBe(true)
  })

  it('respects an explicit off', () => {
    const body = pollDevicePayload({ enabled: false, auto_poll: false })
    expect(body.enabled).toBe(false)
    expect(body.auto_poll).toBe(false)
  })

  it('sends blank text as null rather than as an empty string', () => {
    const body = pollDevicePayload({ phone: '   ', note: '' })
    expect(body.phone).toBeNull()
    expect(body.note).toBeNull()
  })

  it('keeps the values that were filled in', () => {
    const body = pollDevicePayload({
      phone: ' 0501234567 ',
      protocol_id: 1070,
      device_address: 1,
      priority: 5,
      depth_days: 30,
      note: 'через адаптер',
    })
    expect(body).toMatchObject({
      phone: '0501234567',
      protocol_id: 1070,
      device_address: 1,
      priority: 5,
      depth_days: 30,
      note: 'через адаптер',
    })
  })

  it('does not carry a connection speed', () => {
    // It moved to the agent: one speed per machine, beside the COM port.
    expect(pollDevicePayload({})).not.toHaveProperty('baud')
  })
})
