import * as XLSX from 'xlsx'
import type { ArchiveColumn } from '@/domain/archiveColumns'
import { resolveEditName } from '@/domain/archiveColumns'
import { formatEditValue } from '@/domain/valueConverter'
import {
  breakdownHeader,
  breakdownRow,
  buildEnterpriseBreakdown,
  enterprisePeriodKey,
  getEnterpriseFetchFn,
  type PeriodType,
} from '@/domain/enterpriseVolumes'
import { enterpriseDayWindow } from '@/domain/commercialDay'
import type { ArchiveRow } from '@/api/entities'
import type { ArchiveType } from '@/types'
import type { DateRange } from '@/store/selectionStore'

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Save the workbook as `<base>_<local date_time>.xlsx`.
 *
 * Local, not the UTC slice of toISOString(): two exports a minute apart must
 * still sort by the clock the user was looking at.
 */
function writeWorkbook(wb: XLSX.WorkBook, fileBase: string) {
  const d = new Date()
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}_${pad(d.getMinutes())}`
  XLSX.writeFile(wb, `${fileBase}_${stamp}.xlsx`)
}

/** Export the current archive rows to an .xlsx file (SheetJS). */
export function exportArchiveToExcel(
  rows: ArchiveRow[],
  columns: ArchiveColumn[],
  type: ArchiveType,
  fileBase: string,
) {
  const header = columns.map((c) => c.label)
  const body = rows.map((row) =>
    columns.map((c) => {
      const raw = row[c.key]
      if (c.key === 'period') return String(raw ?? '')
      if (type === 'edit' && c.key === 'edit_name') {
        return resolveEditName(String(raw ?? ''), row.old_value, row.new_value)
      }
      if (type === 'edit' && (c.key === 'old_value' || c.key === 'new_value')) {
        return formatEditValue(raw == null ? null : Number(raw))
      }
      if (c.key === 'sys_name' || c.key === 'edit_name') return raw ?? ''
      const n = Number(raw)
      return isFinite(n) ? n : (raw ?? '')
    }),
  )
  const ws = XLSX.utils.aoa_to_sheet([header, ...body])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Archive')
  writeWorkbook(wb, fileBase)
}

/**
 * Excel export with a per-enterprise breakdown: net (line volume − enterprises)
 * and the enterprise total right after the line's columns, then one column per
 * enterprise, joined on the commercial period. Column order lives in
 * `breakdownHeader`/`breakdownRow` — see there for why net comes first.
 */
export async function exportWithEnterpriseBreakdown(
  rows: ArchiveRow[],
  columns: ArchiveColumn[],
  type: ArchiveType,
  fileBase: string,
  lineId: number,
  isVirtual: boolean,
  range: DateRange,
) {
  const periodType: PeriodType = type === 'hourly' ? 'hourly' : 'daily'
  // Bare commercial days: the endpoint expands them itself (hourly → D 07:00 to
  // D+1 06:00). Exactly the window the on-screen overlay asks for — same helper,
  // so a file can never disagree with the table it was exported from.
  const win = enterpriseDayWindow(range.fromDate, range.toDate, periodType)

  // include_devices → per-enterprise columns.
  const records = await getEnterpriseFetchFn(isVirtual, { includeDevices: true })(
    [lineId],
    win.from,
    win.to,
    periodType,
  )

  const { names: enterpriseCols, byPeriod } = buildEnterpriseBreakdown(records, periodType)
  const header = breakdownHeader(columns.map((c) => c.label), enterpriseCols)

  const body = rows.map((row) => {
    const base = columns.map((c) => {
      const raw = row[c.key]
      if (c.key === 'period') return String(raw ?? '')
      const n = Number(raw)
      return isFinite(n) ? n : (raw ?? '')
    })
    const entry = byPeriod.get(enterprisePeriodKey(row.period, periodType))
    return breakdownRow(base as (string | number)[], row.volume, enterpriseCols, entry)
  })

  const ws = XLSX.utils.aoa_to_sheet([header, ...body])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Промисловість')
  writeWorkbook(wb, fileBase)
}
