import { api, apiBaseUrl } from '@/lib/apiClient'

/** GRS consumption models (backend/api/endpoints/grs_model_ep.py). */

export interface GrsModelStation {
  id: number
  name: string
  enabled: boolean
  /** null — the mean of the branch's weather points. */
  weather_point_id: number | null
  inflow_first: string | null
  inflow_last: string | null
  inflow_days: number
  consumption_first: string | null
  consumption_last: string | null
  /** The trend lines that measure the station (summed). */
  lines: { kind: 'physical' | 'virtual' | 'dpd'; id: number }[]
}

export interface GrsModelSpan {
  first: string
  last: string
  days: number
}

export type GrsReportKind = 'inflow' | 'consumption'

export interface GrsModelUpload {
  id: number
  filename: string
  kind: GrsReportKind
  layout: string
  title: string
  first_day: string
  last_day: string
  days: number
  stations: number
  added: number
  updated: number
  unchanged: number
  uploaded_at: string
  uploaded_by: string | null
}

/** One file of an upload: what it was and what it changed, or why it was not read. */
export type GrsUploadResult =
  | (Omit<GrsModelUpload, 'id' | 'uploaded_at' | 'uploaded_by'> & { error?: undefined })
  | { filename: string; error: string }

/**
 * Quality of one station's model. `ok` — trained; `few_days` — not enough
 * clean days; `tiny` — the station is negligible next to the others and is
 * left out. Errors and sigmas are percentages; `mean` is thousand m³ a day.
 */
export interface GrsModelQuality {
  name: string
  status: 'ok' | 'few_days' | 'tiny'
  /** Trend of the station's level, %: the last value and its range. */
  trend_now?: number | null
  trend_min?: number | null
  trend_max?: number | null
  /** Features by weight: share of the effect (%), own and branch coefficients. */
  features?: { feature: string; own: number; common: number; share: number }[]
  weather?: string
  train_days?: number
  excluded_share?: number
  excluded?: { shape: number; level: number; missing: number }
  r2?: number | null
  month_error?: number | null
  months?: number
  months_within_6?: number
  mape_heat?: number | null
  mape_summer?: number | null
  mae?: number
  mean?: number
  sigma_week_heat?: number | null
  sigma_week_summer?: number | null
  sigma_day_heat?: number | null
  sigma_month?: number | null
  episodes?: number
}

export interface GrsModelFit {
  id: number
  trained_at: string
  trained_by: string | null
  first_day: string
  last_day: string
  /** Data was uploaded after the training. */
  stale: boolean
  stations: GrsModelQuality[]
  days: number
  weather_first: string
  weather_last: string
  /** False: no consumption report was uploaded, the whole inflow is modelled. */
  with_consumption?: boolean
  /** How strongly stations are pulled to the branch model, and what each strength gave. */
  pooling?: { strength: number; tried: Record<string, number | null> }
  /** Days of heating season the trend is a median of. */
  trend_window?: number
}

export interface GrsModelStatus {
  stations: GrsModelStation[]
  inflow: GrsModelSpan | null
  consumption: GrsModelSpan | null
  rows: number
  changed_at: string | null
  weather: {
    points: { id: number; name: string }[]
    first: string | null
    last: string | null
    archive_last: string | null
  }
  uploads: GrsModelUpload[]
  fit: GrsModelFit | null
}

type Series = (number | null)[]

/** Volumes are thousand m³ a day; deviations and limits are percentages. */
export interface GrsAnalysisStation {
  name: string
  has_model: boolean
  y: Series
  /** The model times the error all stations share on the day. */
  expected: Series
  model: Series
  deviation: Series
  week: Series
  week_limit: Series
  level: Series
  /** The station's trend, %: the model is multiplied by it. */
  trend: Series
  day_alarm: boolean[]
  week_alarm: boolean[]
  /** Why the day is not judged: 'missing' | 'level' | 'shape'. */
  excluded: (string | null)[]
  month_limit: number | null
}

export interface GrsEpisode {
  grs: string
  start: string
  end: string
  days: number
  deviation: number | null
  /** thousand m³ over the episode */
  volume: number | null
  common: number | null
  /** Reaches the last day there is a fact for. */
  open: boolean
}

export interface GrsAnalysis {
  days: string[]
  forecast: boolean[]
  last_fact_day: string | null
  trained_first: string
  trained_last: string
  trained_at: string
  common: Series
  stations: GrsAnalysisStation[]
  total: { y: Series; expected: Series; ahead: Series }
  months: { month: string; values: Record<string, number | null> }[]
  episodes: GrsEpisode[]
}

export const grsModelApi = {
  status: (branchId: number) => api.get<GrsModelStatus>('/grs-model/status', { branch_id: branchId }),
  analysis: (branchId: number, from?: string, to?: string) =>
    api.get<GrsAnalysis>('/grs-model/analysis', { branch_id: branchId, date_from: from, date_to: to }),
  train: (branchId: number) => api.post<GrsModelFit>(`/grs-model/train?branch_id=${branchId}`),
  updateStation: (id: number, data: { enabled?: boolean; weather_point_id?: number }) =>
    api.patch<GrsModelStation>(`/grs-model/stations/${id}`, data),
  /** A weather point per station, named after it and tied to it. */
  setStationLines: (id: number, lines: { kind: string; id: number }[]) =>
    api.put<{ station_id: number; lines: GrsModelStation['lines'] }>(`/grs-model/stations/${id}/lines`, lines),
  /** Coordinates may be null for a station a point of its name already exists for. */
  createStationPoints: (
    items: { station_id: number; latitude: number | null; longitude: number | null }[],
  ) =>
    api.post<{ station_id: number; weather_point_id: number; created: boolean }[]>(
      '/grs-model/stations/weather-points',
      items,
    ),

  /** Multipart, so it goes around the JSON client. */
  async upload(branchId: number, files: File[]): Promise<GrsUploadResult[]> {
    const form = new FormData()
    for (const file of files) form.append('files', file)
    const res = await fetch(`${apiBaseUrl()}/grs-model/upload?branch_id=${branchId}`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail))
    }
    return (await res.json()).files
  },
}
