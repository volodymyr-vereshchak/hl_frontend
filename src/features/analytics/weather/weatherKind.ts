import type { TranslationKey } from '@/locales'

/** What a picture shows. */
export type WeatherKind =
  | 'clear'
  | 'partly'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'shower'
  | 'sleet'
  | 'snow'
  | 'snowfall'
  | 'thunder'

export const KIND_LABEL: Record<WeatherKind, TranslationKey> = {
  clear: 'wxClear',
  partly: 'wxPartly',
  cloudy: 'wxCloudy',
  fog: 'wxFog',
  drizzle: 'wxDrizzle',
  rain: 'wxRain',
  shower: 'wxShower',
  sleet: 'wxSleet',
  snow: 'wxSnow',
  snowfall: 'wxSnowfall',
  thunder: 'wxThunder',
}

/** WMO weather code (Open-Meteo `weather_code`) → picture. */
export function kindFromCode(code: number): WeatherKind {
  if (code <= 0) return 'clear'
  if (code === 1 || code === 2) return 'partly'
  if (code === 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 55) return 'drizzle'
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'sleet'
  if (code === 61 || code === 63 || code === 80) return 'rain'
  if (code === 65 || code === 81 || code === 82) return 'shower'
  if (code === 71 || code === 73 || code === 77 || code === 85) return 'snow'
  if (code === 75 || code === 86) return 'snowfall'
  if (code >= 95) return 'thunder'
  return 'cloudy'
}

/**
 * The picture for a day or an hour. With a WMO code, from it; days stored
 * before codes were kept are guessed from rain, temperature and cloud.
 * `hourly` changes the rain thresholds (mm an hour rather than a day).
 */
export function weatherKind(w: {
  code?: number | null
  precipitation?: number | null
  temperature?: number | null
  cloud?: number | null
  hourly?: boolean
}): WeatherKind {
  if (w.code != null) return kindFromCode(w.code)
  const p = w.precipitation ?? 0
  const t = w.temperature ?? 5
  const [light, heavy] = w.hourly ? [0.2, 4] : [1, 10]
  if (p >= light) {
    if (t <= 0) return p >= heavy ? 'snowfall' : 'snow'
    if (t <= 2) return 'sleet'
    if (p >= heavy) return 'shower'
    return p >= light * 3 ? 'rain' : 'drizzle'
  }
  if (w.cloud == null) return 'partly'
  if (w.cloud >= 80) return 'cloudy'
  return w.cloud >= 30 ? 'partly' : 'clear'
}
