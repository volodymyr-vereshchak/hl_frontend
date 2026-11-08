import { describe, it, expect } from 'vitest'
import { parseCoordinates } from './coords'
import {
  archiveLastDay,
  archiveUrl,
  matchLocations,
  parseOpenMeteoCsv,
  parseOpenMeteoJson,
  parseWeatherFile,
  planRequests,
} from './openMeteo'

describe('coordinates from Google Maps', () => {
  it('reads a right-click pair', () => {
    expect(parseCoordinates('47.838310, 35.165560')).toEqual({ lat: 47.83831, lon: 35.16556 })
    expect(parseCoordinates('47.8383 35.1655')).toEqual({ lat: 47.8383, lon: 35.1655 })
    expect(parseCoordinates('47,8383; 35,1655')).toEqual({ lat: 47.8383, lon: 35.1655 })
  })

  it('reads degrees, minutes, seconds', () => {
    const p = parseCoordinates(`47°50'18.0"N 35°09'56.0"E`)!
    expect(p.lat).toBeCloseTo(47.838333, 5)
    expect(p.lon).toBeCloseTo(35.165556, 5)
  })

  it('prefers the place in a URL over where the camera looked', () => {
    const url =
      'https://www.google.com/maps/place/X/@47.80,35.10,15z/data=!4m6!3m5!1s0x0:0x0!8m2!3d47.8383!4d35.1655'
    expect(parseCoordinates(url)).toEqual({ lat: 47.8383, lon: 35.1655 })
    expect(parseCoordinates('https://www.google.com/maps/@47.8,35.1,14z')).toEqual({ lat: 47.8, lon: 35.1 })
    expect(parseCoordinates('https://maps.google.com/?q=47.8,35.1')).toEqual({ lat: 47.8, lon: 35.1 })
  })

  it('rejects junk and out-of-range values', () => {
    expect(parseCoordinates('')).toBeNull()
    expect(parseCoordinates('Запоріжжя')).toBeNull()
    expect(parseCoordinates('147.8, 35.1')).toBeNull()
  })
})

// Shapes copied from real Open-Meteo downloads (single and multi-location).
const DAILY_CSV = `latitude,longitude,elevation,utc_offset_seconds,timezone,timezone_abbreviation
47.83831,35.16556,88.0,7200,Europe/Kyiv,GMT+2

time,temperature_2m_mean (°C),temperature_2m_min (°C),temperature_2m_max (°C),wind_speed_10m_max (km/h),shortwave_radiation_sum (MJ/m²),precipitation_sum (mm)
2025-01-01,3.0,0.9,5.7,18.0,5.39,0.00
2025-01-02,4.8,1.2,8.8,,5.73,0.00
`

const HOURLY_MULTI_CSV = `location_id,latitude,longitude,elevation,utc_offset_seconds,timezone,timezone_abbreviation
0,47.800003,35.100006,88.0,7200,Europe/Kyiv,GMT+2
1,48.0,35.300003,77.0,7200,Europe/Kyiv,GMT+2

location_id,time,temperature_2m (°C),wind_speed_10m (km/h),shortwave_radiation (W/m²),precipitation (mm),relative_humidity_2m (%),snow_depth (m)
0,2024-12-20T00:00,4.2,NaN,NaN,NaN,93,0.00
0,2024-12-20T01:00,4.0,NaN,NaN,NaN,94,0.00
1,2024-12-20T00:00,3.1,7.2,0,0.1,90,0.00
`

describe('Open-Meteo files', () => {
  it('parses a single-location daily CSV and converts km/h', () => {
    const [loc] = parseOpenMeteoCsv(DAILY_CSV)
    expect(loc.latitude).toBe(47.83831)
    expect(loc.daily).toHaveLength(2)
    expect(loc.daily[0]).toMatchObject({ day: '2025-01-01', t_mean: 3, t_min: 0.9, t_max: 5.7, wind_max: 5, radiation: 5.39, precipitation: 0 })
    expect(loc.daily[1].wind_max).toBeNull()
  })

  it('parses a multi-location hourly CSV, NaN as missing, unknown columns ignored', () => {
    const locs = parseOpenMeteoCsv(HOURLY_MULTI_CSV)
    expect(locs).toHaveLength(2)
    expect(locs[0].hourly.map((r) => r.stamp)).toEqual(['2024-12-20T00:00:00', '2024-12-20T01:00:00'])
    expect(locs[0].hourly[0]).toMatchObject({ temperature: 4.2, wind_speed: null, humidity: 93, cloud_cover: null })
    expect(locs[1].hourly[0].wind_speed).toBe(2)
  })

  it('parses JSON, single and multi-location', () => {
    const one = {
      latitude: 47.8,
      longitude: 35.1,
      daily_units: { wind_speed_10m_max: 'm/s' },
      daily: { time: ['2026-01-01'], temperature_2m_mean: [-3.5], wind_speed_10m_max: [4.1] },
    }
    expect(parseOpenMeteoJson(JSON.stringify(one))[0].daily[0]).toMatchObject({ day: '2026-01-01', t_mean: -3.5, wind_max: 4.1, t_min: null })
    const many = [one, { ...one, latitude: 48 }]
    expect(parseWeatherFile(JSON.stringify(many)).map((l) => l.latitude)).toEqual([47.8, 48])
  })

  it('surfaces an API error', () => {
    expect(() => parseOpenMeteoJson('{"error":true,"reason":"end_date out of range"}')).toThrow('end_date')
  })
})

describe('requests and matching', () => {
  it('builds a readable archive URL with m/s wind', () => {
    const url = archiveUrl([{ lat: 47.8, lon: 35.1 }, { lat: 48, lon: 35.3 }], 'daily', '2026-01-01', '2026-01-31', 'csv')
    expect(url).toContain('latitude=47.80000,48.00000')
    expect(url).toContain('daily=temperature_2m_mean,')
    expect(url).toContain('timezone=Europe/Kyiv')
    expect(url).toContain('wind_speed_unit=ms')
    expect(url).toContain('format=csv')
  })

  it('stops a week short of today', () => {
    expect(archiveLastDay(new Date(2026, 10, 8))).toBe('2026-11-01')
  })

  it('groups points by ten, cuts by calendar year, clips to the archive end', () => {
    const gaps = Array.from({ length: 12 }, (_, i) => ({
      daily: i === 11 ? [{ first: '2026-03-01', last: '2026-03-05' }] : [],
      hourly: i === 0 ? [{ first: '2025-11-01', last: '2026-12-31' }] : [],
    }))
    const reqs = planRequests(gaps, '2026-11-01')
    expect(reqs).toEqual([
      { kind: 'daily', pointIndexes: [10, 11], start: '2026-03-01', end: '2026-03-05' },
      { kind: 'hourly', pointIndexes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], start: '2025-11-01', end: '2025-12-31' },
      { kind: 'hourly', pointIndexes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], start: '2026-01-01', end: '2026-11-01' },
    ])
  })

  it('matches by order even when two points share one grid cell', () => {
    const points = [
      { lat: 47.81, lon: 35.11 },
      { lat: 47.99, lon: 35.31 },
      { lat: 48.01, lon: 35.29 }, // a few km from the previous one
    ]
    const cells = [
      { lat: 47.8, lon: 35.1 },
      { lat: 48.0, lon: 35.3 },
      { lat: 48.0, lon: 35.3 },
    ]
    expect(matchLocations(cells, points)).toEqual([0, 1, 2])
  })

  it('falls back to the nearest point, and to nothing when too far', () => {
    const points = [
      { lat: 47.0, lon: 35.0 },
      { lat: 48.0, lon: 36.0 },
    ]
    expect(matchLocations([{ lat: 48.02, lon: 36.01 }], points)).toEqual([1])
    // Both within tolerance: the nearer wins, not the first of the group.
    const close = [
      { lat: 47.8, lon: 35.1 },
      { lat: 47.85, lon: 35.15 },
    ]
    expect(matchLocations([{ lat: 47.849, lon: 35.149 }], close)).toEqual([1])
    expect(matchLocations([{ lat: 50, lon: 30 }], points)).toEqual([null])
  })
})
