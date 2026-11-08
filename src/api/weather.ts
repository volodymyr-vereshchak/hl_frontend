import { api } from '@/lib/apiClient'

/** Analytics weather (backend/api/endpoints/weather_ep.py). */

export type WeatherLineKind = 'physical' | 'virtual' | 'dpd'

export interface WeatherLineRef {
  kind: WeatherLineKind
  id: number
}

export interface WeatherCoverage {
  first: string | null
  last: string | null
  count: number
}

export interface WeatherPoint {
  id: number
  branch_id: number
  name: string
  latitude: number
  longitude: number
  lines: WeatherLineRef[]
  daily: WeatherCoverage
  hourly: WeatherCoverage
}

export interface WeatherPointInput {
  name: string
  latitude: number
  longitude: number
  lines: WeatherLineRef[]
}

/** °C, mm, m/s, MJ/m². */
export interface WeatherDailyRow {
  day: string
  t_mean: number | null
  t_min: number | null
  t_max: number | null
  precipitation: number | null
  wind_max: number | null
  radiation: number | null
}

/** °C, %, m/s, W/m², mm, %. `stamp` is the hour's local start, ISO without zone. */
export interface WeatherHourlyRow {
  stamp: string
  temperature: number | null
  humidity: number | null
  wind_speed: number | null
  radiation: number | null
  precipitation: number | null
  cloud_cover: number | null
}

export interface DateRange {
  first: string
  last: string
}

export interface WeatherPlan {
  archive_first: string | null
  archive_last: string | null
  points: { point_id: number; daily: DateRange[]; hourly: DateRange[] }[]
}

export const weatherApi = {
  points: (branchId: number) => api.get<WeatherPoint[]>('/weather/points', { branch_id: branchId }),
  create: (branchId: number, data: WeatherPointInput) =>
    api.post<WeatherPoint>('/weather/points', { branch_id: branchId, ...data }),
  update: (id: number, data: Partial<WeatherPointInput>) =>
    api.patch<WeatherPoint>(`/weather/points/${id}`, data),
  remove: (id: number) => api.delete<void>(`/weather/points/${id}`),
  plan: (branchId: number, from?: string, to?: string) =>
    api.get<WeatherPlan>('/weather/plan', { branch_id: branchId, date_from: from, date_to: to }),
  import: (pointId: number, daily: WeatherDailyRow[], hourly: WeatherHourlyRow[]) =>
    api.post<{ daily: number; hourly: number }>('/weather/import', {
      point_id: pointId,
      daily,
      hourly,
    }),
  daily: (pointIds: number[], from: string, to: string) =>
    api.get<(WeatherDailyRow & { point_id: number })[]>('/weather/daily', {
      point_id: pointIds,
      date_from: from,
      date_to: to,
    }),
  hourly: (pointIds: number[], from: string, to: string) =>
    api.get<(WeatherHourlyRow & { point_id: number })[]>('/weather/hourly', {
      point_id: pointIds,
      date_from: from,
      date_to: to,
    }),
}
