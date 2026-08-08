/**
 * ФХП parameters as the «Звірка ФХП» screen knows them.
 *
 * The labels, units and default tolerances mirror `FHP_PARAMS` in
 * backend/services/fhp_route_service.py — the backend is authoritative and
 * sends its own label/unit/decimals with every block; these are the values the
 * controls need BEFORE a report has been run.
 */

export type FhpParamCode = 'density' | 'co2' | 'n2'

export interface FhpParamMeta {
  code: FhpParamCode
  label: string
  unit: string
  decimals: number
  defaultToleranceAbs: number
  defaultTolerancePct: number
}

export const FHP_PARAMS: Record<FhpParamCode, FhpParamMeta> = {
  density: {
    code: 'density',
    label: 'Густина',
    unit: 'кг/м³',
    decimals: 4,
    defaultToleranceAbs: 0.002,
    defaultTolerancePct: 0.3,
  },
  co2: {
    code: 'co2',
    label: 'CO₂',
    unit: 'мол.%',
    decimals: 4,
    defaultToleranceAbs: 0.05,
    defaultTolerancePct: 5,
  },
  n2: {
    code: 'n2',
    label: 'N₂',
    unit: 'мол.%',
    decimals: 4,
    defaultToleranceAbs: 0.1,
    defaultTolerancePct: 5,
  },
}

export const FHP_PARAM_ORDER: FhpParamCode[] = ['density', 'co2', 'n2']

export function defaultTolerance(code: FhpParamCode, mode: 'abs' | 'pct'): number {
  const meta = FHP_PARAMS[code]
  return mode === 'pct' ? meta.defaultTolerancePct : meta.defaultToleranceAbs
}

/** A measured value, or an em dash when there is nothing to show. */
export function formatFhp(value: number | null | undefined, decimals: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toLocaleString('uk-UA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** A deviation, always signed: the sign is the whole point of the column. */
export function formatDelta(value: number | null | undefined, decimals: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const body = Math.abs(value).toLocaleString('uk-UA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  if (value > 0) return `+${body}`
  if (value < 0) return `−${body}`
  return body
}

/** The two lines of an X-axis tick: date above, hour below where there is one. */
export function periodAxisLabel(
  iso: string,
  granularity: 'hourly' | 'daily',
): [string, string] {
  if (granularity === 'daily') {
    const [, m, d] = iso.split('-')
    return [`${d}.${m}`, '']
  }
  const [datePart, timePart = ''] = iso.split('T')
  const [, m, d] = datePart.split('-')
  return [`${d}.${m}`, timePart.slice(0, 5)]
}

/** «01.05 07:00» for an hour, «01.05.2026» for a commercial day. */
export function formatPeriod(iso: string, granularity: 'hourly' | 'daily'): string {
  if (granularity === 'daily') {
    const [y, m, d] = iso.split('-')
    return `${d}.${m}.${y}`
  }
  const [datePart, timePart = ''] = iso.split('T')
  const [, m, d] = datePart.split('-')
  return `${d}.${m} ${timePart.slice(0, 5)}`
}
