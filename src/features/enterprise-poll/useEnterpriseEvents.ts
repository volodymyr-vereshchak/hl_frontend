import { useCallback, useEffect, useRef, useState } from 'react'
import { streamEnterpriseEvents, type EventReport, type StreamProgress } from '@/api/enterprise'

function defaultRange() {
  const pad = (n: number) => String(n).padStart(2, '0')
  const now = new Date()
  const y = now.getFullYear()
  const m = pad(now.getMonth() + 1)
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${pad(now.getDate())}` }
}

export interface EnterpriseEvents {
  report: EventReport | null
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
 * The result survives closing the pane: nothing is stored server-side, so
 * re-opening would otherwise mean re-polling DPD from scratch.
 */
export function useEnterpriseEvents(
  branchId: number | null,
  kind: 'accidents' | 'interventions' = 'accidents',
): EnterpriseEvents {
  const initial = defaultRange()
  const [report, setReport] = useState<EventReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<StreamProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const abortRef = useRef<AbortController | null>(null)

  // Leaving the screen must hang up: the stream holds a backend generator and
  // its branch advisory lock until the client timeout otherwise.
  useEffect(() => () => abortRef.current?.abort(), [])

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
      setReport(res)
    } catch (e) {
      const err = e as Error
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }, [branchId, from, to, kind])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setLoading(false)
  }, [])

  return { report, loading, progress, error, from, to, setFrom, setTo, run, stop }
}
