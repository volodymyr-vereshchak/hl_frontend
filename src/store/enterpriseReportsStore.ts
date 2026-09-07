import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import type { EnterpriseMappingRow, EventReport } from '@/api/enterprise'

/**
 * The two reports of the enterprise poll screen, kept for as long as the
 * browser TAB is open.
 *
 * Neither is stored server-side: re-opening one means asking DPD again, which
 * runs into minutes. While they lived in the page's own state they died the
 * moment the operator navigated to another screen, so glancing at an archive
 * and coming back cost another full poll.
 *
 * `sessionStorage`, not `localStorage`: this is a live measurement, not a
 * setting. It survives navigation and F5 inside the tab, and dies with the
 * tab — which is as long as an operator can plausibly still mean "the report
 * I just ran". A second tab gets its own, which is right: it is usually open
 * to look at a different branch.
 */

export type EventKind = 'accidents' | 'interventions'

export interface EventSnapshot {
  report: EventReport | null
  /** ms epoch the report came back. null while there is none. */
  at: number | null
  /** Which branch it was polled for — a restored report belongs to one. */
  branchId: number | null
  /** 'YYYY-MM-DD'. The report keeps its own range, apart from the poll's. */
  from: string
  to: string
}

export interface UnpolledSnapshot {
  /** null = never checked in this tab. [] = checked, everything answered. */
  rows: EnterpriseMappingRow[] | null
  at: number | null
  /** The branch filter the check ran under; null means "all branches". */
  branchId: number | null
  /** Window the check looked at, as 'YYYY-MM-DD' strings. */
  from: string
  to: string
  /** How many active enterprises it covered — the denominator. */
  count: number
}

function monthToDate() {
  const pad = (n: number) => String(n).padStart(2, '0')
  const now = new Date()
  return {
    from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
    to: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  }
}

function emptyEvents(): Record<EventKind, EventSnapshot> {
  const range = monthToDate()
  const blank = (): EventSnapshot => ({ report: null, at: null, branchId: null, ...range })
  return { accidents: blank(), interventions: blank() }
}

const EMPTY_UNPOLLED: UnpolledSnapshot = {
  rows: null,
  at: null,
  branchId: null,
  from: '',
  to: '',
  count: 0,
}

interface EnterpriseReportsState {
  events: Record<EventKind, EventSnapshot>
  setEventRange: (kind: EventKind, patch: { from?: string; to?: string }) => void
  setEventReport: (kind: EventKind, report: EventReport, branchId: number | null) => void

  unpolled: UnpolledSnapshot
  /** Called when the check STARTS: the window is known before the result is. */
  startUnpolled: (window: { from: string; to: string; count: number; branchId: number | null }) => void
  setUnpolledRows: (rows: EnterpriseMappingRow[]) => void
}

/**
 * Characters, not bytes — but `sessionStorage` counts UTF-16 too, so the real
 * cost is about twice this against a ~5 MB quota. A branch with a month of
 * alarms is normally a few hundred KB; the guard exists for the outlier, and
 * it fails the right way: the oversized report stays in memory for this
 * screen's lifetime and simply does not survive a reload.
 */
const MAX_PERSISTED_CHARS = 2_000_000

/**
 * `sessionStorage` that refuses to throw. It is absent in some embedded
 * webviews and throws on every access when site data is blocked; a report
 * that cannot be saved is not a reason to take down the screen showing it.
 */
const guardedSession: StateStorage = {
  getItem: (name) => {
    try {
      return sessionStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      // Drop the old entry rather than leave it: restoring last hour's small
      // report in place of the big one now on screen would be a lie.
      if (value.length > MAX_PERSISTED_CHARS) sessionStorage.removeItem(name)
      else sessionStorage.setItem(name, value)
    } catch {
      try {
        sessionStorage.removeItem(name)
      } catch {
        /* nothing left to try */
      }
    }
  },
  removeItem: (name) => {
    try {
      sessionStorage.removeItem(name)
    } catch {
      /* nothing left to try */
    }
  },
}

export const useEnterpriseReportsStore = create<EnterpriseReportsState>()(
  persist(
    (set) => ({
      events: emptyEvents(),
      setEventRange: (kind, patch) =>
        set((s) => ({ events: { ...s.events, [kind]: { ...s.events[kind], ...patch } } })),
      setEventReport: (kind, report, branchId) =>
        set((s) => ({
          events: {
            ...s.events,
            [kind]: { ...s.events[kind], report, branchId, at: Date.now() },
          },
        })),

      unpolled: EMPTY_UNPOLLED,
      // Two steps because the check knows its window immediately and its
      // answer minutes later, and the header shows the window while it runs.
      startUnpolled: ({ from, to, count, branchId }) =>
        set({ unpolled: { rows: null, at: null, branchId, from, to, count } }),
      setUnpolledRows: (rows) =>
        set((s) => ({ unpolled: { ...s.unpolled, rows, at: Date.now() } })),
    }),
    {
      name: 'hlv-enterprise-reports',
      storage: createJSONStorage(() => guardedSession),
      // Unlike the selection store, the ranges ARE persisted: they are part of
      // the report being restored, and pickers that disagree with the table
      // under them would be worse than a stale month. The tab's lifetime keeps
      // them honest — this cannot come back a month later the way
      // localStorage can.
      partialize: (s) => ({ events: s.events, unpolled: s.unpolled }),
      version: 1,
    },
  ),
)

/** An hour. Past it a report is old enough that saying so matters more than
 *  the number it shows — an operator who stepped away must not read a morning
 *  poll as the current state of the branch. */
export const REPORT_STALE_MS = 60 * 60_000

export function isReportStale(at: number | null, now: number = Date.now()): boolean {
  return at != null && now - at >= REPORT_STALE_MS
}
