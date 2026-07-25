import * as XLSX from 'xlsx'
import type { ArchiveColumn } from '@/domain/archiveColumns'
import { resolveEditName } from '@/domain/archiveColumns'
import { formatEditValue } from '@/domain/valueConverter'
import {
  enterprisePeriodKey,
  enterpriseRecordTotal,
  getEnterpriseFetchFn,
  type PeriodType,
} from '@/domain/enterpriseVolumes'
import { commercialHourlyRange } from '@/domain/commercialDay'
import type { ArchiveRow } from '@/api/entities'
import type { ArchiveType } from '@/types'
import type { DateRange } from '@/store/selectionStore'

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
  const date = new Date().toISOString().split('T')[0]
  XLSX.writeFile(wb, `${fileBase}_${date}.xlsx`)
}

interface DeviceRecord {
  name?: string
  volume?: number
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
  const win =
    type === 'hourly'
      ? commercialHourlyRange(range.fromDate, range.toDate)
      : { from: range.fromDate, to: range.toDate }

  // include_devices → per-enterprise columns.
  const records = await getEnterpriseFetchFn(isVirtual, { includeDevices: true })(
    [lineId],
    win.from,
    win.to,
    periodType,
  )

  // period → { enterpriseName: volume } plus the period total.
  const byPeriod = new Map<string, { devices: Record<string, number>; total: number }>()
  const names = new Set<string>()
  for (const rec of records) {
    const key = enterprisePeriodKey(rec.period, periodType)
    const entry = byPeriod.get(key) ?? { devices: {}, total: 0 }
    const label = String(rec.name ?? rec.ser_num ?? `ID ${rec.enterprise_id ?? '?'}`)
    const devices = (rec as { devices?: DeviceRecord[] }).devices
    const vol = enterpriseRecordTotal(rec as never)
    entry.devices[label] = (entry.devices[label] ?? 0) + vol
    entry.total += vol
    names.add(label)
    // Device-level names give a finer breakdown when present.
    for (const d of devices ?? []) {
      if (!d?.name) continue
      names.add(d.name)
      entry.devices[d.name] = (entry.devices[d.name] ?? 0) + (d.volume ?? 0)
    }
    byPeriod.set(key, entry)
  }

  const enterpriseCols = [...names].sort()
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
    const key = enterprisePeriodKey(row.period, periodType)
    const entry = byPeriod.get(key)
    const perEnterprise = enterpriseCols.map((name) => entry?.devices[name] ?? 0)
    const totalEnt = entry?.total ?? 0
    const net = (Number(row.volume) || 0) - totalEnt
    return [...base, ...perEnterprise, totalEnt, net]
  })

  const ws = XLSX.utils.aoa_to_sheet([header, ...body])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Промисловість')
  const date = new Date().toISOString().split('T')[0]
  XLSX.writeFile(wb, `${fileBase}_${date}.xlsx`)
}
