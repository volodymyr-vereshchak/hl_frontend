import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LineKind } from '@/types'

export interface LineMeta {
  kind: LineKind
  meter?: boolean
  is_high_pressure?: boolean
  pressure_unit?: string | null
  dp_unit?: string | null
}

export interface DateRange {
  fromDate: string
  toDate: string
}

interface SelectionState {
  /** Overview + report branch selection. */
  branchId: number | null
  setBranchId: (id: number | null) => void

  /** Archive tree selection. */
  lineId: number | null
  lineMeta: LineMeta | null
  selectLine: (id: number | null, meta: LineMeta | null) => void

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
      selectLine: (lineId, lineMeta) => set({ lineId, lineMeta }),

      dateRange: initialDateRange(),
      setDateRange: (dateRange) => set({ dateRange }),
      dateFilterEnabled: false,
      setDateFilterEnabled: (dateFilterEnabled) => set({ dateFilterEnabled }),
    }),
    {
      name: 'hlv-selection',
      // Persist only the durable choices, not transient date filter state.
      partialize: (s) => ({ branchId: s.branchId, lineId: s.lineId, lineMeta: s.lineMeta }),
    },
  ),
)
