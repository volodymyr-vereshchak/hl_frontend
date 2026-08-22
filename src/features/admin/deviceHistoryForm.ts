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

/** The one shape a typed date may take. Shown to the reader on a mistake. */
export const DATE_FORMAT_HINT = 'дд.мм.рррр'

/**
 * A date typed by hand — in exactly one format, `дд.мм.рррр`.
 *
 * Returns `YYYY-MM-DD` — the form the rest of this module stores — or null for
 * anything else. Two refusals are the point of it.
 *
 * A slash or a dash is refused rather than read as a separator: `08/22/2026`
 * is a date in one country and nonsense in another, and a field that guesses
 * between them will eventually guess wrong on a date nobody re-checks. One
 * separator, one reading.
 *
 * `31.02.2026` is refused rather than rolled over into March, which is what
 * the Date constructor does with it — and a corrector's install date silently
 * moved by a day hands part of the archive to the wrong device.
 *
 * Eight bare digits are the one shortcut: `05032026` is the same order as the
 * dotted form, just faster to type, so it cannot be read two ways either.
 */
export function parseTypedDate(input: string): string | null {
  const text = input.trim()
  if (!text) return null

  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text)
  const digits = /^(\d{2})(\d{2})(\d{4})$/.exec(text)

  let year: number
  let month: number
  let day: number
  if (dotted) {
    ;[day, month, year] = [Number(dotted[1]), Number(dotted[2]), Number(dotted[3])]
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
