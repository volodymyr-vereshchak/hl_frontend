import * as XLSX from 'xlsx'
import type { ArchiveColumn } from '@/domain/archiveColumns'
import { resolveEditName } from '@/domain/archiveColumns'
import { formatEditValue } from '@/domain/valueConverter'
import type { ArchiveRow } from '@/api/entities'
import type { ArchiveType } from '@/types'

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
