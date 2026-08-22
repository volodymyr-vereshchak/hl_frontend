/**
 * How a table of periods is cut into pages.
 *
 * A page is a stretch of time, not a row count: a month of daily readings and
 * a month of hourly ones are the units people actually work in, and "744" on a
 * page-size button means nothing on its own. Shared by the daily/hourly
 * archives and the enterprise poll, which show the same two granularities and
 * would otherwise drift apart in what a page means.
 *
 * Event tables (sys/edit) are deliberately not here — their rows are events,
 * not periods, so they page on the server in plain row counts.
 */
export type PeriodGranularity = 'daily' | 'hourly'

export const PERIOD_PAGE_SIZES: Record<PeriodGranularity, { value: number; labelKey: string }[]> = {
  daily: [
    { value: 31, labelKey: 'pageMonth' },
    { value: 92, labelKey: 'pageQuarter' },
    { value: 366, labelKey: 'pageYear' },
  ],
  hourly: [
    { value: 24, labelKey: 'pageDay' },
    { value: 168, labelKey: 'pageWeek' },
    { value: 744, labelKey: 'pageMonth' },
  ],
}

export const DEFAULT_PERIOD_PAGE_SIZE: Record<PeriodGranularity, number> = {
  daily: 31,
  hourly: 744,
}
