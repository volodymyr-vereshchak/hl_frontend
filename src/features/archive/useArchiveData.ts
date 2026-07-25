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
import type { ArchiveType } from '@/types'
import type { LineMeta, DateRange } from '@/store/selectionStore'

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
    return type === 'daily'
      ? archiveDataApi.getDailyData(ids, win.from, win.to)
      : archiveDataApi.getHourlyData(ids, win.from, win.to)
  }

  // sys / edit / param — physical lines only.
  if (type === 'sys') return sysArchiveApi.getData(ids, fromDate, toDate)
  if (type === 'edit') return editArchiveApi.getData(ids, fromDate, toDate)
  return paramArchiveApi.getParamsForLines(ids) as Promise<ArchiveRow[]>
}

export function useArchiveData({ lineId, meta, type, range, enabled }: ArchiveQuery) {
  return useQuery({
    queryKey: ['archive', type, lineId, meta?.kind, range.fromDate, range.toDate],
    enabled: enabled && lineId != null && meta != null,
    queryFn: () => fetchArchive(lineId!, meta!, type, range),
  })
}
