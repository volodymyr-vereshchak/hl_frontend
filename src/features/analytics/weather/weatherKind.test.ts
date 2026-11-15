import { describe, expect, it } from 'vitest'
import { kindFromCode, weatherKind } from './weatherKind'

describe('weather picture', () => {
  it('follows the WMO code', () => {
    expect([0, 2, 3, 45, 53, 57, 61, 65, 82, 71, 75, 86, 95, 99].map(kindFromCode)).toEqual([
      'clear',
      'partly',
      'cloudy',
      'fog',
      'drizzle',
      'sleet',
      'rain',
      'shower',
      'shower',
      'snow',
      'snowfall',
      'snowfall',
      'thunder',
      'thunder',
    ])
  })

  it('a code wins over the measurements', () => {
    expect(weatherKind({ code: 0, precipitation: 20, temperature: -5 })).toBe('clear')
  })

  it('without a code it is guessed from rain, cold and cloud', () => {
    expect(weatherKind({ precipitation: 15, temperature: 8 })).toBe('shower')
    expect(weatherKind({ precipitation: 4, temperature: 8 })).toBe('rain')
    expect(weatherKind({ precipitation: 1.5, temperature: 8 })).toBe('drizzle')
    expect(weatherKind({ precipitation: 3, temperature: -3 })).toBe('snow')
    expect(weatherKind({ precipitation: 12, temperature: -3 })).toBe('snowfall')
    expect(weatherKind({ precipitation: 3, temperature: 1 })).toBe('sleet')
    expect(weatherKind({ precipitation: 0, cloud: 90, hourly: true })).toBe('cloudy')
    expect(weatherKind({ precipitation: 0, cloud: 10, hourly: true })).toBe('clear')
    expect(weatherKind({ precipitation: 0.3, temperature: 5, hourly: true })).toBe('drizzle')
    expect(weatherKind({ precipitation: 1.2, temperature: 5, hourly: true })).toBe('rain')
  })
})
