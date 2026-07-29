import { useQuery } from '@tanstack/react-query'
import {
  archiveDataApi,
  archiveDataVirtualApi,
  dpdLineApi,
  sysArchiveApi,
  editArchiveApi,
  paramArchiveApi,
  archiveCountsApi,
  type ArchiveRow,
  type CountRow,
} from '@/api/entities'
import { commercialHourlyRange, commercialDayOf } from '@/domain/commercialDay'
import { convertPressureValue, PRESSURE_UNIT_DEFAULT, DP_UNIT_DEFAULT } from '@/domain/pressureUnits'
import type { ArchiveType } from '@/types'
import type { LineMeta, DateRange } from '@/store/selectionStore'

/**
 * Output pressure is not stored by the backend — it is derived like in the old
 * app: for low-pressure non-meter lines, P_out = P − dP (dP converted from its
 * own unit into the pressure unit before subtracting).
 */
function withOutputPressure(rows: ArchiveRow[], meta: LineMeta): ArchiveRow[] {
  if (meta.kind !== 'physical' || meta.is_high_pressure || meta.meter) return rows
  const pUnit = meta.pressure_unit || PRESSURE_UNIT_DEFAULT
  const dpUnit = meta.dp_unit || DP_UNIT_DEFAULT
  return rows.map((r) => {
    const p = Number(r.pressure)
    const dp = Number(r.w_volume_dp)
    if (!isFinite(p) || !isFinite(dp)) return r
    return { ...r, output_pressure: p - convertPressureValue(dp, dpUnit, pUnit) }
  })
}

interface ArchiveQuery {
  lineId: number | null
  meta: LineMeta | null
  type: ArchiveType
  range: DateRange
  enabled: boolean
}

/** Pickers emit 'YYYY-MM-DD' or 'YYYY-MM-DD HH:mm:ss'. */
const hasTime = (s: string) => /\d{2}:\d{2}/.test(s)
const toIso = (s: string) => s.replace(' ', 'T')
const dateOnly = (s: string) => s.slice(0, 10)

/**
 * Chronological order, oldest first. Endpoint ordering is not part of any
 * contract — it depends on the query plan and has been observed to come back
 * shuffled — so the table never relies on it. Rows without a period sink to the
 * end rather than scrambling the rest.
 */
function byPeriod(rows: ArchiveRow[]): ArchiveRow[] {
  return [...rows].sort((a, b) => {
    const x = a.period ? String(a.period) : ''
    const y = b.period ? String(b.period) : ''
    if (!x) return 1
    if (!y) return -1
    return x < y ? -1 : x > y ? 1 : 0
  })
}

async function fetchArchive(
  lineId: number,
  meta: LineMeta,
  type: ArchiveType,
  range: DateRange,
): Promise<ArchiveRow[]> {
  const ids = [lineId]
  const { fromDate, toDate } = range

  if (type === 'daily' || type === 'hourly') {
    // Hourly defaults to the commercial-day window (07:00 → next-day 06:00),
    // unless the user picked explicit times — then honour them verbatim.
    const win =
      type === 'hourly'
        ? hasTime(fromDate) || hasTime(toDate)
          ? { from: toIso(fromDate), to: toIso(toDate) }
          : commercialHourlyRange(fromDate, toDate)
        : { from: dateOnly(fromDate), to: dateOnly(toDate) }

    if (meta.kind === 'virtual') {
      return byPeriod(
        type === 'daily'
          ? await archiveDataVirtualApi.getDailyData(ids, win.from, win.to)
          : await archiveDataVirtualApi.getHourlyData(ids, win.from, win.to),
      )
    }
    if (meta.kind === 'dpd') {
      return byPeriod(
        type === 'daily'
          ? await dpdLineApi.getDailyData(ids, win.from, win.to)
          : await dpdLineApi.getHourlyData(ids, win.from, win.to),
      )
    }
    // Physical lines also carry intervention (И) and alarm (А) counters, which
    // come from separate endpoints and are merged onto each row by period.
    const [physRows, editCounts, sysCounts] = await Promise.all([
      type === 'daily'
        ? archiveDataApi.getDailyData(ids, win.from, win.to)
        : archiveDataApi.getHourlyData(ids, win.from, win.to),
      archiveCountsApi.getEditCounts(ids, dateOnly(fromDate), dateOnly(toDate)).catch(() => []),
      archiveCountsApi.getSysCounts(ids, dateOnly(fromDate), dateOnly(toDate)).catch(() => []),
    ])
    const withCounts = mergeCounts(physRows, editCounts, sysCounts, type, lineId)
    return byPeriod(withOutputPressure(withCounts, meta))
  }

  // sys / edit / param — physical lines only.
  if (type === 'sys') return byPeriod(await sysArchiveApi.getData(ids, toIso(fromDate), toIso(toDate)))
  if (type === 'edit') return byPeriod(await editArchiveApi.getData(ids, toIso(fromDate), toIso(toDate)))
  // Parameters honour the date filter like every other archive. `to_date` is
  // pushed to the end of its day: the pickers here are date-only, and a bare
  // date means midnight, which would drop everything recorded on the last day.
  return byPeriod(
    (await paramArchiveApi.getParamsForLines(
      ids,
      toIso(fromDate),
      hasTime(toDate) ? toIso(toDate) : `${dateOnly(toDate)}T23:59:59`,
    )) as ArchiveRow[],
  )
}

/**
 * Bucket a counts row into the period key its archive row uses: for the daily
 * archive that is the COMMERCIAL day (hours before the contract hour belong to
 * the previous day); for hourly it is the raw hour period.
 */
function countKey(row: CountRow, type: ArchiveType): string | null {
  const raw = row.period || row.hour_group
  if (!raw) return null
  const d = new Date(raw)
  if (isNaN(d.getTime())) return null
  if (type === 'hourly') return String(raw)
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return commercialDayOf(date, d.getHours())
}

/** Merge И/А counters onto archive rows, summing per (line, period). */
function mergeCounts(
  rows: ArchiveRow[],
  editCounts: CountRow[],
  sysCounts: CountRow[],
  type: ArchiveType,
  lineId: number,
): ArchiveRow[] {
  const bucket = (list: CountRow[]) => {
    const map = new Map<string, number>()
    for (const c of list ?? []) {
      const key = countKey(c, type)
      if (!key) continue
      const id = c.line_id ?? lineId
      const k = `${id}_${key}`
      map.set(k, (map.get(k) ?? 0) + (c.record_count ?? 0))
    }
    return map
  }
  const edits = bucket(editCounts)
  const alarms = bucket(sysCounts)

  return rows.map((r) => {
    const id = r.line_id ?? lineId
    // Archive periods may carry a time part the counters' key does not.
    const key = type === 'hourly' ? String(r.period) : String(r.period).slice(0, 10)
    const k = `${id}_${key}`
    return { ...r, edit_counts: edits.get(k) ?? 0, sys_counts: alarms.get(k) ?? 0 }
  })
}

/** sys/edit are server-paginated; everything else loads the full range. */
export const isPagedArchive = (type: ArchiveType) => type === 'sys' || type === 'edit'

export function useArchiveData({ lineId, meta, type, range, enabled }: ArchiveQuery) {
  return useQuery({
    queryKey: ['archive', type, lineId, meta?.kind, range.fromDate, range.toDate],
    enabled: enabled && lineId != null && meta != null && !isPagedArchive(type),
    queryFn: () => fetchArchive(lineId!, meta!, type, range),
  })
}

interface PagedQuery extends ArchiveQuery {
  page: number
  pageSize: number
}

/** Server-paginated sys/edit page — returns { total, items }. */
export function useArchivePage({ lineId, meta, type, range, enabled, page, pageSize }: PagedQuery) {
  return useQuery({
    queryKey: ['archive-page', type, lineId, range.fromDate, range.toDate, page, pageSize],
    enabled: enabled && lineId != null && meta != null && isPagedArchive(type),
    placeholderData: (prev) => prev,
    queryFn: () => {
      const opts = { skip: (page - 1) * pageSize, limit: pageSize }
      const ids = [lineId!]
      const from = toIso(range.fromDate)
      const to = toIso(range.toDate)
      return type === 'sys'
        ? sysArchiveApi.getPaged(ids, from, to, opts)
        : editArchiveApi.getPaged(ids, from, to, opts)
    },
  })
}

/** Full sys/edit dataset, fetched on demand for Excel export. */
export async function fetchFullArchive(
  lineId: number,
  type: ArchiveType,
  range: DateRange,
): Promise<ArchiveRow[]> {
  const ids = [lineId]
  return byPeriod(
    type === 'sys'
      ? await sysArchiveApi.getData(ids, toIso(range.fromDate), toIso(range.toDate))
      : await editArchiveApi.getData(ids, toIso(range.fromDate), toIso(range.toDate)),
  )
}
