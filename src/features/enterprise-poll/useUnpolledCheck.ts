import { useCallback, useEffect, useRef, useState } from 'react'
import {
  currentDevice,
  streamEnterpriseVolumes,
  type EnterpriseMappingRow,
  type StreamProgress,
} from '@/api/enterprise'
import { useEnterpriseReportsStore } from '@/store/enterpriseReportsStore'

const pad = (n: number) => String(n).padStart(2, '0')
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export interface CheckedRange {
  from: string
  to: string
  /** How many active enterprises the check covered — the denominator. */
  count: number
}

export interface UnpolledCheck {
  /** null = never run. [] = run and everything answered. */
  rows: EnterpriseMappingRow[] | null
  /** ms epoch the check finished, for the "polled at" line. */
  polledAt: number | null
  checkedRange: CheckedRange
  checking: boolean
  progress: StreamProgress | null
  error: string | null
  /** The pane opens before this is called and stays open through it, so the
   *  check reports its own progress, its own emptiness and its own failures
   *  rather than handing the page a verdict to route. */
  run: () => Promise<void>
  stop: () => void
}

/**
 * Which enterprises have gone quiet.
 *
 * The window ends YESTERDAY and covers the three days before it. Today is
 * excluded because DPD has no daily record for it yet for anybody, so
 * including it polled a day that can only come back empty and pushed the whole
 * window a day short of what it claimed to check. On the 25th the check covers
 * the 21st through the 24th.
 *
 * The result lives in a tab-scoped store so that leaving the screen does not
 * throw away a check that takes minutes; progress and errors stay local to
 * this mount.
 */
export function useUnpolledCheck(
  mappings: EnterpriseMappingRow[] | undefined,
  branchFilter: number | null,
): UnpolledCheck {
  const snapshot = useEnterpriseReportsStore((s) => s.unpolled)
  const startUnpolled = useEnterpriseReportsStore((s) => s.startUnpolled)
  const setUnpolledRows = useEnterpriseReportsStore((s) => s.setUnpolledRows)
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState<StreamProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const run = useCallback(async (): Promise<void> => {
    const active = (mappings ?? []).filter(
      (m) => m.active !== false && (!branchFilter || m.branch_id === branchFilter),
    )
    // setDate, not millisecond arithmetic: subtracting 24h across a DST switch
    // lands on the wrong calendar day.
    const end = new Date()
    end.setDate(end.getDate() - 1)
    const start = new Date(end)
    start.setDate(start.getDate() - 3)
    // Also drops the previous result, so the pane shows this check's progress.
    startUnpolled({
      from: day(start),
      to: day(end),
      count: active.length,
      branchId: branchFilter,
    })

    const lineIds = [
      ...new Set(
        active
          .map((m) => m.line_id ?? m.dpd_line_id)
          .filter((id): id is number => id != null),
      ),
    ]
    if (lineIds.length === 0) {
      setUnpolledRows([])
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setChecking(true)
    setError(null)
    setProgress(null)
    try {
      const records = await streamEnterpriseVolumes(
        {
          line_id: lineIds,
          from_date: day(start),
          to_date: day(end),
          period_type: 'daily',
          live: true,
        },
        { onProgress: setProgress, signal: ctrl.signal },
      )
      const polled = new Set<string>()
      for (const record of records) {
        for (const d of record.devices ?? []) {
          if (d.volume != null) polled.add(`${d.serNum}_${d.chNum}`)
        }
      }
      const quiet = active.filter((m) => {
        const device = currentDevice(m)
        // A point with no corrector fitted has nothing to poll — reporting it
        // as unpolled would make an empty slot look like a failure.
        if (!device) return false
        return !polled.has(`${device.ser_num}_${device.ch_num}`)
      })
      setUnpolledRows(quiet)
    } catch (e) {
      const err = e as Error
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setChecking(false)
      setProgress(null)
    }
  }, [mappings, branchFilter, startUnpolled, setUnpolledRows])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setChecking(false)
  }, [])

  // Same rule as the alarms report: a result answers for the filter it ran
  // under. Kept rather than cleared, so switching back costs nothing.
  const mine = snapshot.branchId === branchFilter

  return {
    rows: mine ? snapshot.rows : null,
    polledAt: mine ? snapshot.at : null,
    checkedRange: mine
      ? { from: snapshot.from, to: snapshot.to, count: snapshot.count }
      : { from: '', to: '', count: 0 },
    checking,
    progress,
    error,
    run,
    stop,
  }
}
