/**
 * Open-Meteo historical weather (ERA5 reanalysis): request URLs and parsers.
 *
 * Production has no internet, so the same requests serve two paths:
 *   online  — the browser fetches the JSON itself;
 *   offline — the page shows the CSV links, somebody downloads them on a
 *             machine with internet and uploads the files back.
 * Both end in the same rows, posted to /weather/import.
 *
 * A request carries up to POINTS_PER_REQUEST points and one calendar year.
 * Open-Meteo answers locations in request order and snaps each to its grid
 * cell, so two GRS a few km apart can come back with identical coordinates —
 * a file is matched back to points by that order (see matchLocations), with
 * the coordinates only as a check.
 */
import type { WeatherDailyRow, WeatherHourlyRow } from '@/api/weather'
import { distanceKm, type LatLon } from './coords'

export const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'
export const POINTS_PER_REQUEST = 10
/**
 * The reanalysis is published with a delay of several days and the archive
 * API refuses an end date past what it has, so requests stop this many days
 * before today. Later runs pick the rest up from the plan.
 */
export const ARCHIVE_LAG_DAYS = 7
/** A returned grid cell further than this from the point means a wrong file. */
export const MATCH_TOLERANCE_KM = 25

export type WeatherKind = 'daily' | 'hourly'

const DAILY_VARS: Record<string, keyof WeatherDailyRow> = {
  temperature_2m_mean: 't_mean',
  temperature_2m_min: 't_min',
  temperature_2m_max: 't_max',
  precipitation_sum: 'precipitation',
  wind_speed_10m_max: 'wind_max',
  shortwave_radiation_sum: 'radiation',
}
const HOURLY_VARS: Record<string, keyof WeatherHourlyRow> = {
  temperature_2m: 'temperature',
  relative_humidity_2m: 'humidity',
  wind_speed_10m: 'wind_speed',
  shortwave_radiation: 'radiation',
  precipitation: 'precipitation',
  cloud_cover: 'cloud_cover',
}
const WIND = new Set(['wind_speed_10m_max', 'wind_speed_10m'])

export interface WeatherRequest {
  kind: WeatherKind
  /** Indexes into the id-sorted point list the request was built from. */
  pointIndexes: number[]
  start: string
  end: string
}

export interface ParsedLocation {
  latitude: number
  longitude: number
  daily: WeatherDailyRow[]
  hourly: WeatherHourlyRow[]
}

const pad = (n: number) => String(n).padStart(2, '0')
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Last day the archive can be asked for today. */
export function archiveLastDay(today = new Date()): string {
  const d = new Date(today)
  d.setDate(d.getDate() - ARCHIVE_LAG_DAYS)
  return isoDay(d)
}

export function archiveUrl(points: LatLon[], kind: WeatherKind, start: string, end: string, format: 'json' | 'csv'): string {
  const vars = Object.keys(kind === 'daily' ? DAILY_VARS : HOURLY_VARS).join(',')
  const p = new URLSearchParams({
    latitude: points.map((x) => x.lat.toFixed(5)).join(','),
    longitude: points.map((x) => x.lon.toFixed(5)).join(','),
    start_date: start,
    end_date: end,
    [kind]: vars,
    timezone: 'Europe/Kyiv',
    wind_speed_unit: 'ms',
  })
  if (format === 'csv') p.set('format', 'csv')
  // URLSearchParams encodes the commas; Open-Meteo reads both, plain is readable.
  return `${ARCHIVE_URL}?${p.toString().replace(/%2C/g, ',').replace(/%2F/g, '/')}`
}

/**
 * The requests that close the given gaps. Points go in fixed groups of
 * POINTS_PER_REQUEST by their position in the id-sorted list — the same
 * grouping every time, which is what lets an uploaded file be matched back.
 * Each group asks for the span from its earliest to its latest gap, cut into
 * calendar years; days it already has are simply overwritten.
 */
export function planRequests(
  gaps: { daily: { first: string; last: string }[]; hourly: { first: string; last: string }[] }[],
  lastDay: string,
): WeatherRequest[] {
  const out: WeatherRequest[] = []
  for (const kind of ['daily', 'hourly'] as const) {
    for (let g = 0; g < gaps.length; g += POINTS_PER_REQUEST) {
      const idx = Array.from({ length: Math.min(POINTS_PER_REQUEST, gaps.length - g) }, (_, i) => g + i)
      const runs = idx.flatMap((i) => gaps[i][kind])
      if (runs.length === 0) continue
      const start = runs.map((r) => r.first).sort()[0]
      let end = runs.map((r) => r.last).sort().at(-1)!
      if (end > lastDay) end = lastDay
      if (start > end) continue
      for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
        const s = y === Number(start.slice(0, 4)) ? start : `${y}-01-01`
        const e = y === Number(end.slice(0, 4)) ? end : `${y}-12-31`
        out.push({ kind, pointIndexes: idx, start: s, end: e })
      }
    }
  }
  return out
}

// ── parsing ────────────────────────────────────────────────────────────────

function windFactor(unit: string | undefined): number {
  const u = (unit ?? '').toLowerCase().replace(/\s/g, '')
  if (u === 'km/h') return 1 / 3.6
  if (u === 'mp/h' || u === 'mph') return 0.44704
  if (u === 'kn' || u === 'knots') return 0.514444
  return 1
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isFinite(n) ? n : null
}

function rowsFrom<T extends object>(
  times: string[],
  columns: Record<string, (string | number | null)[]>,
  units: Record<string, string | undefined>,
  vars: Record<string, keyof T>,
  timeKey: keyof T,
  toTime: (t: string) => string,
): T[] {
  return times.map((t, i) => {
    const row = { [timeKey]: toTime(t) } as Record<string, unknown>
    for (const [src, dst] of Object.entries(vars)) {
      let v = num(columns[src]?.[i])
      if (v != null && WIND.has(src)) v = Math.round(v * windFactor(units[src]) * 100) / 100
      row[dst as string] = v
    }
    return row as T
  })
}

const hourStamp = (t: string) => (t.length === 16 ? `${t}:00` : t)
const dayStamp = (t: string) => t.slice(0, 10)

interface OpenMeteoJson {
  latitude: number
  longitude: number
  daily?: Record<string, (number | null)[]> & { time: string[] }
  daily_units?: Record<string, string>
  hourly?: Record<string, (number | null)[]> & { time: string[] }
  hourly_units?: Record<string, string>
  error?: boolean
  reason?: string
}

export function parseOpenMeteoJson(text: string): ParsedLocation[] {
  const data = JSON.parse(text) as OpenMeteoJson | OpenMeteoJson[]
  const list = Array.isArray(data) ? data : [data]
  return list.map((loc) => {
    if (loc.error) throw new Error(loc.reason ?? 'Open-Meteo: помилка')
    return {
      latitude: loc.latitude,
      longitude: loc.longitude,
      daily: loc.daily
        ? rowsFrom<WeatherDailyRow>(loc.daily.time, loc.daily, loc.daily_units ?? {}, DAILY_VARS, 'day', dayStamp)
        : [],
      hourly: loc.hourly
        ? rowsFrom<WeatherHourlyRow>(loc.hourly.time, loc.hourly, loc.hourly_units ?? {}, HOURLY_VARS, 'stamp', hourStamp)
        : [],
    }
  })
}

const splitCsv = (line: string) => line.split(',').map((c) => c.trim())

/** "temperature_2m (°C)" → ["temperature_2m", "°C"]. */
function headerName(h: string): [string, string | undefined] {
  const m = h.match(/^([a-z0-9_]+)\s*(?:\((.*)\))?$/i)
  return m ? [m[1], m[2]] : [h, undefined]
}

/**
 * Open-Meteo CSV: a block of location metadata (with a leading location_id
 * column when there are several), a blank line, then one or more data blocks
 * (hourly and/or daily), each with its own header and blank-line separated.
 */
export function parseOpenMeteoCsv(text: string): ParsedLocation[] {
  const blocks = text
    .replace(/^﻿/, '')
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.split(/\r?\n/).filter((l) => l.trim() !== ''))
    .filter((b) => b.length > 0)
  if (blocks.length < 2) throw new Error('Файл не схожий на CSV Open-Meteo')

  const metaHead = splitCsv(blocks[0][0])
  const latCol = metaHead.indexOf('latitude')
  const lonCol = metaHead.indexOf('longitude')
  if (latCol < 0 || lonCol < 0) throw new Error('У CSV немає координат (latitude/longitude)')
  const locations: ParsedLocation[] = blocks[0].slice(1).map((l) => {
    const c = splitCsv(l)
    return { latitude: Number(c[latCol]), longitude: Number(c[lonCol]), daily: [], hourly: [] }
  })

  for (const block of blocks.slice(1)) {
    const head = splitCsv(block[0]).map(headerName)
    const names = head.map(([n]) => n)
    const units: Record<string, string | undefined> = Object.fromEntries(head)
    const locCol = names.indexOf('location_id')
    const timeCol = names.indexOf('time')
    if (timeCol < 0) continue
    // Columns per location, then rows through the shared builder.
    const perLoc = new Map<number, { times: string[]; cols: Record<string, string[]> }>()
    for (const line of block.slice(1)) {
      const c = splitCsv(line)
      const li = locCol >= 0 ? Number(c[locCol]) : 0
      if (!perLoc.has(li)) perLoc.set(li, { times: [], cols: {} })
      const acc = perLoc.get(li)!
      acc.times.push(c[timeCol])
      names.forEach((n, i) => {
        if (i === timeCol || i === locCol) return
        ;(acc.cols[n] ??= []).push(c[i])
      })
    }
    for (const [li, acc] of perLoc) {
      const loc = locations[li]
      if (!loc) throw new Error(`CSV: дані для невідомої локації ${li}`)
      const hourly = acc.times[0]?.includes('T')
      if (hourly) {
        loc.hourly.push(...rowsFrom<WeatherHourlyRow>(acc.times, acc.cols, units, HOURLY_VARS, 'stamp', hourStamp))
      } else {
        loc.daily.push(...rowsFrom<WeatherDailyRow>(acc.times, acc.cols, units, DAILY_VARS, 'day', dayStamp))
      }
    }
  }
  return locations
}

export function parseWeatherFile(text: string): ParsedLocation[] {
  const t = text.trimStart()
  return t.startsWith('{') || t.startsWith('[') ? parseOpenMeteoJson(t) : parseOpenMeteoCsv(text)
}

/**
 * Which point each location of a file belongs to. First by order: the file
 * came from one of our requests, so its locations are a run of the id-sorted
 * points, starting at a group boundary — accepted when every location lies
 * within MATCH_TOLERANCE_KM of its point. Failing that (a file from somewhere
 * else, or the point list changed since), each location goes to the nearest
 * point within tolerance. null = no point is close enough.
 */
export function matchLocations(locations: LatLon[], points: LatLon[]): (number | null)[] {
  const n = locations.length
  const fits = (start: number) =>
    locations.every((l, i) => distanceKm(l, points[start + i]) <= MATCH_TOLERANCE_KM)
  const starts = Array.from({ length: Math.max(0, points.length - n + 1) }, (_, i) => i)
  // A single location says nothing by its order: it goes to the nearest point.
  const start =
    n > 1
      ? (starts.find((s) => s % POINTS_PER_REQUEST === 0 && fits(s)) ?? starts.find(fits))
      : undefined
  if (start !== undefined) return locations.map((_, i) => start + i)

  return locations.map((l) => {
    let best: number | null = null
    let bestD = MATCH_TOLERANCE_KM
    points.forEach((p, i) => {
      const d = distanceKm(l, p)
      if (d <= bestD) {
        bestD = d
        best = i
      }
    })
    return best
  })
}
