import { useQuery } from '@tanstack/react-query'
import {
  archiveDataApi,
  archiveDataVirtualApi,
  dpdLineApi,
  sysArchiveApi,
  editArchiveApi,
  paramArchiveApi,
  type ArchiveRow,
} from '@/api/entities'
import { commercialHourlyRange } from '@/domain/commercialDay'
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

async function fetchArchive(
  lineId: number,
  meta: LineMeta,
  type: ArchiveType,
  range: DateRange,
): Promise<ArchiveRow[]> {
  const ids = [lineId]
  const { fromDate, toDate } = range

  if (type === 'daily' || type === 'hourly') {
    // Hourly uses the commercial-day datetime window (07:00 → next-day 06:00).
    const win =
      type === 'hourly'
        ? commercialHourlyRange(fromDate, toDate)
        : { from: fromDate, to: toDate }

    if (meta.kind === 'virtual') {
      return type === 'daily'
        ? archiveDataVirtualApi.getDailyData(ids, win.from, win.to)
        : archiveDataVirtualApi.getHourlyData(ids, win.from, win.to)
    }
    if (meta.kind === 'dpd') {
      return type === 'daily'
        ? dpdLineApi.getDailyData(ids, win.from, win.to)
        : dpdLineApi.getHourlyData(ids, win.from, win.to)
    }
    const physRows =
      type === 'daily'
        ? await archiveDataApi.getDailyData(ids, win.from, win.to)
        : await archiveDataApi.getHourlyData(ids, win.from, win.to)
    return withOutputPressure(physRows, meta)
  }

  // sys / edit / param — physical lines only.
  if (type === 'sys') return sysArchiveApi.getData(ids, fromDate, toDate)
  if (type === 'edit') return editArchiveApi.getData(ids, fromDate, toDate)
  return paramArchiveApi.getParamsForLines(ids) as Promise<ArchiveRow[]>
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
      return type === 'sys'
        ? sysArchiveApi.getPaged(ids, range.fromDate, range.toDate, opts)
        : editArchiveApi.getPaged(ids, range.fromDate, range.toDate, opts)
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
  return type === 'sys'
    ? sysArchiveApi.getData(ids, range.fromDate, range.toDate)
    : editArchiveApi.getData(ids, range.fromDate, range.toDate)
}
