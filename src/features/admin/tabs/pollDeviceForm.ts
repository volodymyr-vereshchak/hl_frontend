/**
 * Form values of the polling card → the request body, plus the rules the form
 * checks while somebody types.
 *
 * The backend refuses the same things (services/poll_validation.py) — this is
 * not the guard, it is the feedback. Each rule is a failure that would
 * otherwise surface on an operator's machine hours later and look like broken
 * equipment: an undialable number reads as "no dialtone", an hour that is not
 * an hour is a slot the agent never reaches.
 *
 * No connection speed here: it is one setting for every poll on a machine, so
 * it lives in the agent beside the COM port. No driver either — that comes
 * from the corrector's model, set once in Типи коректорів.
 */
export interface PollDeviceFormValues {
  enabled?: unknown
  auto_poll?: unknown
  poll_times?: unknown
  phone?: unknown
  device_address?: unknown
  priority?: unknown
  note?: unknown
}

/** 0 first. A short range, because it is a queue order compared by eye. */
export const PRIORITY_OPTIONS = [0, 1, 2, 3, 4, 5].map((n) => ({
  value: String(n),
  label: n === 0 ? '0 — найвищий' : String(n),
}))

/** Ukrainian numbers only, and always one shape: the agent dials it as-is. */
const PHONE_RE = /^\+380\d{9}$/

/**
 * Bring a typed number to +380XXXXXXXXX, or return null if it cannot be.
 *
 * Punctuation is dropped and the local shapes are accepted, because that is
 * how numbers get written down: 050…, 380…, 8050… all mean the same line.
 */
export function normalisePhone(raw: unknown): string | null {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return null
  const stripped = trimmed.startsWith('+')
    ? `+${trimmed.slice(1).replace(/\D/g, '')}`
    : trimmed.replace(/\D/g, '')

  let candidate = stripped
  if (!stripped.startsWith('+')) {
    if (/^0\d{9}$/.test(stripped)) candidate = `+38${stripped}`
    else if (/^80\d{9}$/.test(stripped)) candidate = `+3${stripped}`
    else candidate = `+${stripped}`
  }
  return PHONE_RE.test(candidate) ? candidate : null
}

/** What to show under the phone box while it is being typed. */
export function phoneError(raw: unknown): string | null {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return null
  return normalisePhone(trimmed)
    ? null
    : 'Очікується український номер: +380XXXXXXXXX'
}

/** "HH:MM" slots, sorted and without duplicates; null = the global hours. */
export function normalisePollTimes(raw: unknown): string[] | null {
  if (raw == null) return null
  const values = Array.isArray(raw)
    ? raw.map(String)
    : String(raw)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
  const out = new Set<string>()
  for (const value of values) {
    const m = /^(\d{1,2}):(\d{1,2})$/.exec(value)
    if (!m) continue
    const hour = Number(m[1])
    const minute = Number(m[2])
    if (hour > 23 || minute > 59) continue
    out.add(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
  }
  return out.size ? [...out].sort() : null
}

const text = (v: unknown): string | null => String(v ?? '').trim() || null

export function pollDevicePayload(v: PollDeviceFormValues): Record<string, unknown> {
  const autoPoll = v.auto_poll !== false
  return {
    // CrudTable seeds every checkbox to false, so these read whatever the box
    // says; the tab passes createDefaults to make a new card start switched
    // on. Two different questions: `enabled` is whether the card acts at all,
    // `auto_poll` is whether it is polled without being asked.
    enabled: v.enabled !== false,
    auto_poll: autoPoll,
    // Hours only mean something for an automatic poll. Keeping them while the
    // schedule is off would leave a card that looks scheduled and is not.
    poll_times: autoPoll ? normalisePollTimes(v.poll_times) : null,
    phone: normalisePhone(v.phone),
    // Sent for every card; the server keeps it only where it is a real choice
    // (Floutek shares a line) and stores the default everywhere else.
    device_address: v.device_address ?? null,
    priority: Number(v.priority ?? 0),
    note: text(v.note),
  }
}
