import * as XLSX from 'xlsx'
import type { ArchiveColumn } from '@/domain/archiveColumns'
import { resolveEditName } from '@/domain/archiveColumns'
import { formatEditValue } from '@/domain/valueConverter'
import {
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
 * Excel export with a per-enterprise breakdown: one column per enterprise plus
 * total and net (line volume − enterprises), joined on the commercial period.
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
  const header = [
    ...columns.map((c) => c.label),
    ...enterpriseCols,
    'Разом підприємства',
    'NET (лінія − підприємства)',
  ]

  const body = rows.map((row) => {
    const base = columns.map((c) => {
      const raw = row[c.key]
      if (c.key === 'period') return String(raw ?? '')
      const n = Number(raw)
      return isFinite(n) ? n : (raw ?? '')
    })
    const entry = byPeriod.get(enterprisePeriodKey(row.period, periodType))
    // Unpolled periods stay blank rather than reading as a measured zero.
    const perEnterprise = enterpriseCols.map((name) => entry?.[name] ?? '')
    // Totalled from the visible columns, so the row always adds up on screen.
    const totalEnt = perEnterprise.reduce<number>((s, v) => s + (typeof v === 'number' ? v : 0), 0)
    const net = (Number(row.volume) || 0) - totalEnt
    return [...base, ...perEnterprise, totalEnt, net]
  })

  const ws = XLSX.utils.aoa_to_sheet([header, ...body])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Промисловість')
  writeWorkbook(wb, fileBase)
}
