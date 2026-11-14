/** Shared number and date formatting of the GRS model screens. */

export const fmtNumber = (value: number | null | undefined, digits: number, locale: string) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** A percentage with its sign: a deviation reads wrong without one. */
export const fmtSigned = (value: number | null | undefined, digits: number, locale: string) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toLocaleString(locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })} %`

/** An ISO day or timestamp as a local date. */
export const fmtDay = (iso: string | null | undefined, locale: string) => {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(locale)
}

export const fmtStamp = (iso: string | null | undefined, locale: string) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : `${d.toLocaleDateString(locale)} ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`
}

const pad = (n: number) => String(n).padStart(2, '0')
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** An ISO day moved by a number of days. */
export function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return isoDay(d)
}
