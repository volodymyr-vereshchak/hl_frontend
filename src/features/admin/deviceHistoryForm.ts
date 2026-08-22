/**
 * The editor's view of a corrector history: form rows in, API records out.
 *
 * Kept apart from the components so both the enterprise form (one device, when
 * a point is created) and the history window (all of them) work on the same
 * shape, and so the conversion rules live in one readable place.
 */
import type { CorectorType, EnterpriseDevice } from '@/api/admin'

/** «Стоїть від початку» — points migrated from the pre-history schema. */
export const EPOCH_YEAR = 2000

export const pad = (n: number) => String(n).padStart(2, '0')

export const fmtDT = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const fmtDate = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`

/** One row of the history editor. */
export interface DeviceForm {
  ser_num: string
  /** UI only — narrows the corrector-type list, never sent to the API. */
  manufacturer_id: string | null
  corector_type_id: string | null
  ch_num: number
  /** Empty = «від початку»: the whole archive belongs to this corrector. */
  installed_date: string
  installed_hour: number
  /** Only set when the corrector was taken off before the next was fitted. */
  removed_date: string
  removed_hour: number
}

export const EMPTY_DEVICE: DeviceForm = {
  ser_num: '',
  manufacturer_id: null,
  corector_type_id: null,
  ch_num: 0,
  installed_date: '',
  installed_hour: 7,
  removed_date: '',
  removed_hour: 7,
}

/**
 * An empty install date means «стоїть від початку», so the point's whole
 * archive belongs to this corrector — the state every point had before the
 * history existed. An empty hour means the start of the commercial day, not
 * midnight: with 00:00 the hours before it belong to the previous commercial
 * day and would be handed to the wrong device.
 */
export const stamp = (date: string, hour: number) =>
  date ? `${date}T${pad(hour)}:00:00` : `${EPOCH_YEAR}-01-01T00:00:00`

/**
 * API records → editor rows. `corectorTypes` back-derives the manufacturer,
 * which exists only to narrow the model list; without it editing would open
 * with the model select blank and the full corrector list unfiltered.
 */
export function toDeviceForms(
  devices: EnterpriseDevice[] | undefined,
  corectorTypes: CorectorType[] | undefined,
): DeviceForm[] {
  const mfrOf = (ctId?: number | null) =>
    ctId != null
      ? ((corectorTypes ?? []).find((ct) => ct.id === ctId)?.manufacturer_id ?? null)
      : null

  return (devices ?? []).map((d) => {
    const from = new Date(d.installed_from)
    const removed = d.removed_at ? new Date(d.removed_at) : null
    // The epoch stands for «від початку» and is shown as an empty date, so
    // re-saving an untouched point does not invent an install date.
    const fromEpoch = from.getFullYear() <= EPOCH_YEAR
    return {
      ser_num: String(d.ser_num),
      manufacturer_id: String(mfrOf(d.corector_type_id) ?? ''),
      corector_type_id: d.corector_type_id != null ? String(d.corector_type_id) : null,
      ch_num: d.ch_num,
      installed_date: fromEpoch ? '' : d.installed_from.slice(0, 10),
      installed_hour: fromEpoch ? 7 : from.getHours(),
      removed_date: removed ? d.removed_at!.slice(0, 10) : '',
      removed_hour: removed ? removed.getHours() : 7,
    }
  })
}

/** Editor rows → the `devices` payload of a create/patch. */
export function toDevicePayload(devices: DeviceForm[]): EnterpriseDevice[] {
  return devices.map((d) => ({
    ser_num: Number(d.ser_num),
    corector_type_id: d.corector_type_id ? Number(d.corector_type_id) : null,
    ch_num: Number(d.ch_num) || 0,
    installed_from: stamp(d.installed_date, d.installed_hour),
    removed_at: d.removed_date ? `${d.removed_date}T${pad(d.removed_hour)}:00:00` : null,
  }))
}

/** Dates outside this stay unparsed — a mistyped year is the usual cause. */
const MIN_YEAR = 1990
const MAX_YEAR = 2100

/**
 * A date typed by hand, in the shapes people actually type.
 *
 * Returns `YYYY-MM-DD` — the form the rest of this module stores — or null
 * when the text is not a real date. Both halves matter: `дд.мм.рррр` is what
 * the field shows, but a hand-entered `31.02.2026` has to be refused rather
 * than rolled over into March, which is what the Date constructor does with it.
 *
 * Separators are whatever is at hand (dot, slash, dash) or nothing at all,
 * because typing eight digits is faster than reaching for the dot. `YYYY-MM-DD`
 * is accepted too — that is what a value pasted out of the archive looks like.
 */
export function parseTypedDate(input: string): string | null {
  const text = input.trim()
  if (!text) return null

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  const dmy = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/.exec(text)
  const digits = /^(\d{2})(\d{2})(\d{4})$/.exec(text)

  let year: number
  let month: number
  let day: number
  if (iso) {
    ;[year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  } else if (dmy) {
    ;[day, month, year] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])]
  } else if (digits) {
    ;[day, month, year] = [Number(digits[1]), Number(digits[2]), Number(digits[3])]
  } else {
    return null
  }

  if (year < MIN_YEAR || year > MAX_YEAR) return null

  // Round-tripped through Date on purpose: it is the only check that knows
  // February has 29 days in 2028 and 28 in 2026. A rolled-over date comes back
  // with a different month, so comparing the parts back is the whole test.
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return `${year}-${pad(month)}-${pad(day)}`
}
