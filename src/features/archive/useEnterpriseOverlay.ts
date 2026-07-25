import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArchiveType } from '@/types'
import type { LineMeta, DateRange } from '@/store/selectionStore'
import {
  buildEnterpriseByPeriod,
  enterprisePeriodKey,
  getEnterpriseFetchFn,
  type PeriodType,
} from '@/domain/enterpriseVolumes'
import { commercialHourlyRange } from '@/domain/commercialDay'
import type { ArchiveRow } from '@/api/entities'

export interface OverlayState {
  enabled: boolean
  setEnabled: (v: boolean) => void
  loading: boolean
  progress: { done?: number; total?: number; phase?: string } | null
  error: string | null
  /** periodKey → total enterprise volume across the selected lines. */
  byPeriod: Record<string, number> | null
}

/**
 * Enterprise (промисловість) overlay for the daily/hourly archive: fetches
 * enterprise volumes over the progress stream and reduces them to a
 * period→total map that the chart and Excel export join against.
 */
export function useEnterpriseOverlay(
  lineId: number | null,
  meta: LineMeta | null,
  type: ArchiveType,
  range: DateRange,
): OverlayState {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<OverlayState['progress']>(null)
  const [error, setError] = useState<string | null>(null)
  const [byPeriod, setByPeriod] = useState<Record<string, number> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const periodType: PeriodType = type === 'hourly' ? 'hourly' : 'daily'

  useEffect(() => {
    if (!enabled || !lineId || !meta) {
      setByPeriod(null)
      setError(null)
      return
    }
    let cancelled = false
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const win =
      type === 'hourly'
        ? commercialHourlyRange(range.fromDate, range.toDate)
        : { from: range.fromDate, to: range.toDate }

    setLoading(true)
    setError(null)
    setProgress(null)

    getEnterpriseFetchFn(meta.kind === 'virtual')(
      [lineId],
      win.from,
      win.to,
      periodType,
      (p) => !cancelled && setProgress(p),
    )
      .then((records) => {
        if (cancelled) return
        setByPeriod(buildEnterpriseByPeriod(records, periodType))
      })
      .catch((e: Error) => {
        if (cancelled || e.name === 'AbortError') return
        setError(e.message)
        setByPeriod(null)
      })
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [enabled, lineId, meta, type, periodType, range.fromDate, range.toDate])

  return { enabled, setEnabled, loading, progress, error, byPeriod }
}

/**
 * Join archive rows with the enterprise overlay: adds `totalEnterprise` and
 * `netVolume` (line volume − enterprise) to each row.
 */
export function applyOverlay(
  rows: ArchiveRow[],
  byPeriod: Record<string, number> | null,
  type: ArchiveType,
): ArchiveRow[] {
  if (!byPeriod) return rows
  const periodType: PeriodType = type === 'hourly' ? 'hourly' : 'daily'
  return rows.map((r) => {
    const key = enterprisePeriodKey(r.period, periodType)
    const ent = byPeriod[key] ?? 0
    const vol = Number(r.volume) || 0
    return { ...r, totalEnterprise: ent, netVolume: vol - ent }
  })
}

/** Stable callback wrapper so the checkbox can toggle without re-creating deps. */
export function useToggle(setEnabled: (v: boolean) => void, enabled: boolean) {
  return useCallback(() => setEnabled(!enabled), [enabled, setEnabled])
}
