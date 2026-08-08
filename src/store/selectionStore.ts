import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LineKind } from '@/types'

export interface LineMeta {
  kind: LineKind
  /** Tree label of the line — names the export file. Absent in selections
   *  persisted before this field existed, so callers need a fallback. */
  name?: string
  meter?: boolean
  is_high_pressure?: boolean
  pressure_unit?: string | null
  dp_unit?: string | null
}

/**
 * A node of the tree selected instead of a single line: the daily and hourly
 * archives then show every line under it, side by side, plus their sum.
 * Only the identity is kept — the member lines are resolved from the tree, so
 * a line added in the admin panel shows up without re-picking the node.
 */
export interface GroupSelection {
  kind: 'calc' | 'lumg' | 'branch'
  id: number
  name: string
}

export interface DateRange {
  fromDate: string
  toDate: string
}

interface SelectionState {
  /** Overview + report branch selection. */
  branchId: number | null
  setBranchId: (id: number | null) => void

  /** Archive tree selection — a line OR a node, never both. */
  lineId: number | null
  lineMeta: LineMeta | null
  selectLine: (id: number | null, meta: LineMeta | null) => void
  groupSel: GroupSelection | null
  selectGroup: (sel: GroupSelection | null) => void

  /** Archive date range + filter toggle. */
  dateRange: DateRange
  setDateRange: (r: DateRange) => void
  dateFilterEnabled: boolean
  setDateFilterEnabled: (v: boolean) => void
}

function initialDateRange(): DateRange {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return { fromDate: `${y}-${m}-01`, toDate: `${y}-${m}-${d}` }
}

export const useSelectionStore = create<SelectionState>()(
  persist(
    (set) => ({
      branchId: null,
      setBranchId: (branchId) => set({ branchId }),

      lineId: null,
      lineMeta: null,
      // The two selections are exclusive: picking one clears the other, so the
      // archive never has to guess which of them the screen is about.
      selectLine: (lineId, lineMeta) => set({ lineId, lineMeta, groupSel: null }),
      groupSel: null,
      selectGroup: (groupSel) => set({ groupSel, lineId: null, lineMeta: null }),

      dateRange: initialDateRange(),
      setDateRange: (dateRange) => set({ dateRange }),
      dateFilterEnabled: false,
      setDateFilterEnabled: (dateFilterEnabled) => set({ dateFilterEnabled }),
    }),
    {
      name: 'hlv-selection',
      // `dateRange` stays out on purpose: a reload starts from the current
      // month again (see initialDateRange). A period restored from the last
      // session is stale by definition — come back in August and the pickers
      // would still be showing July without saying so.
      // `dateFilterEnabled` stays out too: it gates the fetch, and restoring it
      // would fire a request before the user has even looked at the page.
      partialize: (s) => ({
        branchId: s.branchId,
        lineId: s.lineId,
        lineMeta: s.lineMeta,
        groupSel: s.groupSel,
      }),
      // v1 stored `dateRange`, and persisted keys win over the initial state
      // on merge — without this, browsers that used the old build would keep
      // restoring last session's period forever.
      version: 2,
      migrate: (persisted) => {
        const { branchId, lineId, lineMeta, groupSel } =
          (persisted ?? {}) as Partial<SelectionState>
        return {
          branchId: branchId ?? null,
          lineId: lineId ?? null,
          lineMeta: lineMeta ?? null,
          groupSel: groupSel ?? null,
        }
      },
    },
  ),
)
