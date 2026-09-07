import { useCallback, useEffect, useRef, useState } from 'react'
import { streamEnterpriseEvents, type EventReport, type StreamProgress } from '@/api/enterprise'
import { useEnterpriseReportsStore, type EventKind } from '@/store/enterpriseReportsStore'

export interface EnterpriseEvents {
  report: EventReport | null
  /** ms epoch the report came back, for the "polled at" line. */
  polledAt: number | null
  loading: boolean
  progress: StreamProgress | null
  error: string | null
  /** 'YYYY-MM-DD'. The report keeps its OWN range: it is opened to ask about
   *  a week the volume poll on the same screen has nothing to do with. */
  from: string
  to: string
  setFrom: (d: string) => void
  setTo: (d: string) => void
  run: () => void
  stop: () => void
}

/**
 * Alarms (or interventions) of a branch's enterprise devices, live from DPD.
 *
 * Its own hook because it is its own feature: it shares only the branch
 * selector with the poll on the same screen, and while all of this lived in
 * EnterprisePollPage the two shared an `error` state — so a failure here
 * surfaced in the poll's panel.
 *
 * The result lives in a tab-scoped store, not in this hook: nothing is stored
 * server-side, so leaving the screen and coming back would otherwise mean
 * re-polling DPD from scratch. Everything transient — the stream's progress,
 * its errors — stays here, because it belongs to THIS mount and restoring it
 * would be meaningless.
 */
export function useEnterpriseEvents(
  branchId: number | null,
  kind: EventKind = 'accidents',
): EnterpriseEvents {
  const snapshot = useEnterpriseReportsStore((s) => s.events[kind])
  const setEventRange = useEnterpriseReportsStore((s) => s.setEventRange)
  const setEventReport = useEnterpriseReportsStore((s) => s.setEventReport)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<StreamProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Leaving the screen must hang up: the stream holds a backend generator and
  // its branch advisory lock until the client timeout otherwise.
  useEffect(() => () => abortRef.current?.abort(), [])

  const { from, to } = snapshot
  const setFrom = useCallback(
    (d: string) => setEventRange(kind, { from: d }),
    [setEventRange, kind],
  )
  const setTo = useCallback((d: string) => setEventRange(kind, { to: d }), [setEventRange, kind])

  const run = useCallback(async () => {
    if (branchId == null) {
      setError('Оберіть філію: креденшали ДПД задані окремо для кожної')
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    setProgress(null)
    try {
      const res = await streamEnterpriseEvents(
        { branch_id: branchId, from_date: from, to_date: to, kind },
        { onProgress: setProgress, signal: ctrl.signal },
      )
      setEventReport(kind, res, branchId)
    } catch (e) {
      const err = e as Error
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }, [branchId, from, to, kind, setEventReport])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setLoading(false)
  }, [])

  // A report answers for the branch it was polled for. Switching the filter
  // must not leave another branch's alarms on screen under the new name; the
  // snapshot is kept, so switching back shows it again instead of re-polling.
  const mine = snapshot.branchId === branchId

  return {
    report: mine ? snapshot.report : null,
    polledAt: mine ? snapshot.at : null,
    loading,
    progress,
    error,
    from,
    to,
    setFrom,
    setTo,
    run,
    stop,
  }
}
