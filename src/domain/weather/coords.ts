/**
 * Coordinates as people copy them out of Google Maps:
 *
 *   47.838310, 35.165560                 — right-click on the map
 *   47°50'18.0"N 35°09'56.0"E            — the place card
 *   https://www.google.com/maps/place/…/@47.83,35.16,15z/data=…!3d47.8383!4d35.1655
 *                                        — the address bar
 *
 * A place URL carries both the camera (@lat,lon) and the place itself
 * (!3d lat !4d lon); the place wins, the camera is only where the map looked.
 */
export interface LatLon {
  lat: number
  lon: number
}

const valid = (lat: number, lon: number): LatLon | null =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { lat, lon }
    : null

function dms(part: string): number | null {
  const m = part.match(/(\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*['′])?\s*(?:(\d+(?:[.,]\d+)?)\s*["″])?\s*([NSEWПнСЗВ])?/i)
  if (!m) return null
  const n = (s?: string) => (s ? Number(s.replace(',', '.')) : 0)
  let v = n(m[1]) + n(m[2]) / 60 + n(m[3]) / 3600
  const hemi = (m[4] ?? '').toUpperCase()
  if (hemi === 'S' || hemi === 'W' || hemi === 'З') v = -v
  return v
}

export function parseCoordinates(input: string): LatLon | null {
  const s = input.trim()
  if (!s) return null

  const place = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
  if (place) return valid(Number(place[1]), Number(place[2]))
  const camera = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
  if (camera) return valid(Number(camera[1]), Number(camera[2]))
  const query = s.match(/[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i)
  if (query) return valid(Number(query[1]), Number(query[2]))

  if (s.includes('°')) {
    const parts = s.split(/(?<=[NSEWПнСЗВ"″])\s*[, ]\s*/i).filter(Boolean)
    if (parts.length >= 2) {
      const a = dms(parts[0])
      const b = dms(parts[1])
      if (a != null && b != null) return valid(a, b)
    }
    return null
  }

  // Plain pair: "47.83, 35.16", "47.83 35.16", "47,83; 35,16".
  const pair = s.match(/^(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)$/)
  if (pair) {
    // "47,83, 35,16" is ambiguous; with decimal commas a semicolon or space separates.
    return valid(Number(pair[1].replace(',', '.')), Number(pair[2].replace(',', '.')))
  }
  return null
}

export const formatCoordinates = (lat: number, lon: number) => `${lat.toFixed(6)}, ${lon.toFixed(6)}`

/** Great-circle distance, km — enough to tell grid cells apart. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const r = (d: number) => (d * Math.PI) / 180
  const dLat = r(b.lat - a.lat)
  const dLon = r(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}
