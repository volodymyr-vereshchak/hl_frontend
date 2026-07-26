/**
 * Pull the latest params + newest hourly record for a line into the calculator
 * form. Ported 1:1 from FlowRateCalc.jsx's pullFromLine — the field mapping and
 * the rounding are what make the pulled values match the old screen exactly.
 */
import { archiveDataApi, paramArchiveApi, type ParamRecord } from '@/api/entities'
import { UNIT_LABELS } from '@/domain/pressureUnits'
import { matchMaterialIndex } from '@/domain/flowRate/materials'
import type { FlowCalcInput } from '@/domain/flowRate/calculate'
import type { Line } from '@/types'

export interface AutofillResult {
  /** Fields to merge into the form. */
  patch: Partial<FlowCalcInput>
  /** Period of the hourly record the working values came from, if any. */
  period: string | null
  hadParams: boolean
  hadHourly: boolean
}

/** Index of a unit label in the shared P_UNITS list; falls back when not found. */
function unitIndexByLabel(label: string | null | undefined, fallback: number): number {
  const i = label ? UNIT_LABELS.indexOf(label) : -1
  return i >= 0 ? i : fallback
}

// Round pulled values for the form: 2 decimals for most fields, 4 for density
// (which needs the extra precision). Strips float noise from the archive.
const round2 = (v: number) => Math.round(v * 100) / 100
const round4 = (v: number) => Math.round(v * 1e4) / 1e4

/** Reads a numeric column off a param record, which is loosely typed. */
function num(rec: ParamRecord, key: string): number | null {
  const v = rec[key]
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return isNaN(n) ? null : n
}

/** Naive DD.MM.YYYY HH:00 of an archive period (no UTC shift). */
export function formatPeriodShort(period: string): string {
  const m = String(period)
    .replace(' ', 'T')
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}))?/)
  if (!m) return String(period)
  const [, y, mo, d, h = '00'] = m
  return `${d}.${mo}.${y} ${h}:00`
}

export async function pullFromLine(
  line: Line,
  current: FlowCalcInput,
  wantMeter: boolean,
): Promise<AutofillResult> {
  const [params, lastPeriod] = await Promise.all([
    paramArchiveApi.getParamsForLines([line.id]),
    archiveDataApi.getLastPeriod([line.id]),
  ])
  const param = Array.isArray(params) && params.length ? params[0] : null

  // Newest hourly record: fetch a window around the anchor period, take the last.
  const anchor = lastPeriod ?? new Date()
  const start = new Date(anchor.getTime() - 2 * 864e5).toISOString().slice(0, 10)
  const end = new Date(anchor.getTime() + 2 * 864e5).toISOString().slice(0, 10)
  const recs = await archiveDataApi.getHourlyData([line.id], start, end)
  const hourly =
    Array.isArray(recs) && recs.length
      ? recs.reduce((a, b) => (new Date(a.period) > new Date(b.period) ? a : b))
      : null

  const patch: Partial<FlowCalcInput> = {}

  if (param) {
    const set = (field: keyof FlowCalcInput, key: string, round: (v: number) => number) => {
      const v = num(param, key)
      if (v != null) (patch as Record<string, string>)[field] = String(round(v))
    }
    set('rho', 'density', round4)
    set('co2', 'co2', round2)
    set('n2', 'n2', round2)
    set('D20', 'D20', round2)
    set('d20', 'd20', round2)
    set('rsh', 'roughness', round2)
    set('rEdge', 'radius', round2)
    set('timeOrifice', 'su_year', round2)

    const mO = matchMaterialIndex(num(param, 'A0su'), num(param, 'A1su'), num(param, 'A2su'))
    if (mO != null) patch.matOrifice = mO
    const mP = matchMaterialIndex(num(param, 'A0pipe'), num(param, 'A1pipe'), num(param, 'A2pipe'))
    if (mP != null) patch.matPipe = mP
  }

  if (hourly) {
    if (hourly.pressure != null) {
      patch.p = String(round2(hourly.pressure))
      patch.pU = unitIndexByLabel(line.pressure_unit, current.pU)
      patch.pType = 0 // archive pressure is absolute
    }
    if (hourly.temperature != null) patch.t = String(round2(hourly.temperature))
    if (hourly.w_volume_dp != null) {
      if (wantMeter) {
        patch.qw = String(round2(hourly.w_volume_dp))
      } else {
        patch.dp = String(round2(hourly.w_volume_dp))
        patch.dpU = unitIndexByLabel(line.dp_unit, current.dpU)
      }
    }
  }

  return {
    patch,
    period: hourly ? formatPeriodShort(String(hourly.period)) : null,
    hadParams: !!param,
    hadHourly: !!hourly,
  }
}
