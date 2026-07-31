import type { DateRange } from '@/store/selectionStore'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Whole days between the two picker values, times ignored. */
export function periodDays({ fromDate, toDate }: DateRange): number {
  const from = new Date(`${fromDate.slice(0, 10)}T00:00:00`)
  const to = new Date(`${toDate.slice(0, 10)}T00:00:00`)
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return 0
  // Inclusive: 01.01–01.01 is one day of data, not zero.
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / MS_PER_DAY) + 1)
}

/**
 * Beyond this many days the enterprise overlay stops being a database read.
 *
 * The archive itself needs no warning any more — the table pages and the
 * request is a couple of megabytes at worst. The overlay is a different thing
 * entirely: it polls the DPD API for every enterprise on the line, and past
 * DPD_ARCHIVE_WINDOW_DAYS (30) the backend has to backfill from that API on
 * demand. That is minutes, and load on someone else's service.
 */
export const OVERLAY_HEAVY_DAYS = 31

export const isOverlayHeavy = (range: DateRange) => periodDays(range) > OVERLAY_HEAVY_DAYS
