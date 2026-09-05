/**
 * The one way this app writes a workbook.
 *
 * Ten screens each built their own `book_new → aoa_to_sheet → append → write`
 * and their own file name, and each rediscovered the same two Excel rules:
 * a sheet name is at most 31 characters and may not contain `[ ] : * ? / \`.
 * A screen that forgets either produces a file Excel refuses to open, and it
 * only finds out in the field.
 *
 * `xlsx` is imported dynamically. It is 323 KB and is wanted only at the
 * moment someone presses «Excel», so keeping it out of the static graph keeps
 * it off the first paint of every screen that offers an export.
 */

/** A sheet: its tab name, its rows, and optional column widths. */
export interface SheetSpec {
  name: string
  /** Rows of cells, header included — the array-of-arrays xlsx takes. */
  aoa: (string | number | null | undefined)[][]
  /** Column widths in characters, positionally. */
  cols?: number[]
}

/** Excel's rules for a tab name, applied once instead of in ten places. */
export function sheetName(label: string): string {
  const clean = label.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31)
  return clean || 'Sheet1'
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD` for today, for file names. */
export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Write `sheets` as one workbook named `<fileBase>.xlsx`.
 *
 * Sheets with no rows are skipped, because a workbook with an empty tab reads
 * as a bug rather than as "nothing to report"; if that leaves nothing at all,
 * no file is written and the function returns false, so a caller can say so.
 */
export async function writeSheets(fileBase: string, sheets: SheetSpec[]): Promise<boolean> {
  const filled = sheets.filter((s) => s.aoa.length > 0)
  if (filled.length === 0) return false

  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()
  for (const spec of filled) {
    const ws = XLSX.utils.aoa_to_sheet(spec.aoa)
    if (spec.cols) ws['!cols'] = spec.cols.map((wch) => ({ wch }))
    // Excel rejects a workbook with two tabs of the same name, and truncation
    // to 31 characters is a way to collide by accident.
    let name = sheetName(spec.name)
    for (let i = 2; used.has(name); i++) name = sheetName(`${spec.name} ${i}`)
    used.add(name)
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  XLSX.writeFile(wb, `${fileBase}.xlsx`)
  return true
}

/** One sheet, for the common case. */
export function writeSheet(
  fileBase: string,
  name: string,
  aoa: SheetSpec['aoa'],
  cols?: number[],
): Promise<boolean> {
  return writeSheets(fileBase, [{ name, aoa, cols }])
}
