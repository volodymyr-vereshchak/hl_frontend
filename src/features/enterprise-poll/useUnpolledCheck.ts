import { useCallback, useEffect, useRef, useState } from 'react'
import {
  currentDevice,
  streamEnterpriseVolumes,
  type EnterpriseMappingRow,
  type StreamProgress,
} from '@/api/enterprise'

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
  checkedRange: CheckedRange
  checking: boolean
  progress: StreamProgress | null
  error: string | null
  /** Resolves true when the check produced a result worth showing. Whether
   *  the pane is open is the page's business — it hides the report without
   *  discarding it, and the toolbar button brings the same one back. */
  run: () => Promise<boolean>
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
 */
export function useUnpolledCheck(
  mappings: EnterpriseMappingRow[] | undefined,
  branchFilter: number | null,
): UnpolledCheck {
  const [rows, setRows] = useState<EnterpriseMappingRow[] | null>(null)
  const [checkedRange, setCheckedRange] = useState<CheckedRange>({ from: '', to: '', count: 0 })
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState<StreamProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const run = useCallback(async (): Promise<boolean> => {
    const active = (mappings ?? []).filter(
      (m) => m.active !== false && (!branchFilter || m.branch_id === branchFilter),
    )
    // setDate, not millisecond arithmetic: subtracting 24h across a DST switch
    // lands on the wrong calendar day.
    const end = new Date()
    end.setDate(end.getDate() - 1)
    const start = new Date(end)
    start.setDate(start.getDate() - 3)
    setCheckedRange({ from: day(start), to: day(end), count: active.length })

    const lineIds = [
      ...new Set(
        active
          .map((m) => m.line_id ?? m.dpd_line_id)
          .filter((id): id is number => id != null),
      ),
    ]
    if (lineIds.length === 0) {
      setRows([])
      return true
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    // Drop the previous report so the pane shows this check's progress.
    setRows(null)
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
      setRows(quiet)
      return true
    } catch (e) {
      const err = e as Error
      if (err.name !== 'AbortError') setError(err.message)
      return false
    } finally {
      setChecking(false)
      setProgress(null)
    }
  }, [mappings, branchFilter])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setChecking(false)
  }, [])

  return { rows, checkedRange, checking, progress, error, run, stop }
}
