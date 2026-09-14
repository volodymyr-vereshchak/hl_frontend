/**
 * What the modem settings on the enterprise card accept, and what they show
 * while somebody types.
 *
 * The backend refuses the same things (services/poll_validation.py) — this is
 * not the guard, it is the feedback. Each rule is a failure that would
 * otherwise surface on an operator's machine hours later and look like broken
 * equipment: an undialable number reads as "no dialtone", an hour that is not
 * an hour is a slot the agent never reaches.
 *
 * Only these two live here now. Everything else a poll card used to ask for is
 * either derived (the driver comes from the corrector's model) or belongs to
 * the machine rather than the site (the COM port and the speed live in the
 * agent), and the card itself is no longer edited by hand — Опитування
 * модемом is a monitor.
 */
/** Ukrainian numbers only, and always one shape: the agent dials it as-is. */
const PHONE_RE = /^\+380\d{9}$/

/**
 * Bring a typed number to +380XXXXXXXXX, or return null if it cannot be.
 *
 * People write the same number four ways — 050…, 8050…, +38 (050) … — and
 * all four reach the same modem, so all four are accepted and stored
 * identically. Anything else is refused here rather than at 3 a.m. by a
 * modem that has no idea what it was asked to dial.
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

