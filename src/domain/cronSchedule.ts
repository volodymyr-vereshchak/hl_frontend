/**
 * The poll schedule, said in cron — and said back in words.
 *
 * The hours used to be a list of "HH:MM", which reads well for a site polled
 * twice a day and badly for everything else: hourly meant ticking twenty-four
 * boxes. A cron expression says both in five characters, and says the things a
 * list cannot say at all — weekdays only, the first of the month.
 *
 * This is the reading half: the server owns the schedule and refuses what it
 * cannot parse, but a field that only finds out after «Зберегти» is a field
 * people stop trusting. Same five rules, so the same expressions pass.
 */
export interface CronParts {
  minute: Set<number>
  hour: Set<number>
  day: Set<number>
  month: Set<number>
  weekday: Set<number>
}

const FIELDS: Array<[keyof CronParts, number, number]> = [
  ['minute', 0, 59],
  ['hour', 0, 23],
  ['day', 1, 31],
  ['month', 1, 12],
  ['weekday', 0, 7],
]

const NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

const PART = /^(\*|\d+|[a-z]{3})(?:-(\d+|[a-z]{3}))?(?:\/(\d+))?$/

/** What is wrong with the expression, or null when nothing is. */
export function cronError(expression: string): string | null {
  const text = (expression ?? '').trim().toLowerCase()
  if (!text) return null // empty means "follow the global schedule"
  const fields = text.split(/\s+/)
  if (fields.length !== FIELDS.length) {
    return `Потрібно п'ять полів: хвилина, година, день, місяць, день тижня (зараз ${fields.length})`
  }
  for (let i = 0; i < FIELDS.length; i++) {
    const [name, low, high] = FIELDS[i]
    const bad = fieldError(fields[i], String(name), low, high)
    if (bad) return bad
  }
  return null
}

function fieldError(value: string, name: string, low: number, high: number): string | null {
  for (const part of value.split(',')) {
    const match = PART.exec(part)
    if (!match) return `Не розумію «${part}» у полі «${label(name)}»`
    const [, start, end, step] = match
    if (step !== undefined && Number(step) < 1) return `Крок має бути додатним: «${part}»`
    if (start !== '*') {
      const first = number(start)
      if (first === null || first < low || first > high) {
        return `«${start}» поза межами поля «${label(name)}» (${low}–${high})`
      }
      if (end !== undefined) {
        const last = number(end)
        if (last === null || last < low || last > high) {
          return `«${end}» поза межами поля «${label(name)}» (${low}–${high})`
        }
        if (last < first) return `Діапазон навпаки: «${part}»`
      }
    }
  }
  return null
}

function number(token: string): number | null {
  if (token in NAMES) return NAMES[token]
  if (!/^\d+$/.test(token)) return null
  return Number(token)
}

function label(name: string): string {
  return (
    {
      minute: 'хвилина',
      hour: 'година',
      day: 'день',
      month: 'місяць',
      weekday: 'день тижня',
    }[name] ?? name
  )
}

function values(part: string, low: number, high: number): number[] {
  const out = new Set<number>()
  for (const piece of part.split(',')) {
    const match = PART.exec(piece)
    if (!match) continue
    const [, start, end, step] = match
    const by = step ? Number(step) : 1
    let first: number
    let last: number
    if (start === '*') {
      first = low
      last = high
    } else {
      first = number(start) ?? low
      last = end !== undefined ? (number(end) ?? first) : by > 1 ? high : first
    }
    for (let v = first; v <= last; v += by) out.add(v)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * The expression in words, for the line under the field.
 *
 * Only the shapes a poll actually uses are spelled out; anything else is named
 * as what it is rather than described wrongly.
 */
export function describeCron(expression: string): string {
  const text = (expression ?? '').trim().toLowerCase()
  if (!text) return 'За загальним розкладом'
  if (cronError(text)) return ''
  const [m, h, dom, mon, dow] = text.split(/\s+/)
  const minutes = values(m, 0, 59)
  const hours = values(h, 0, 23)
  if (dom !== '*' || mon !== '*' || dow !== '*') return 'За власним розкладом'

  if (minutes.length === 1 && hours.length === 24) {
    return minutes[0] === 0 ? 'Щогодини' : `Щогодини о :${pad(minutes[0])}`
  }
  if (minutes.length === 1 && hours.length > 1) {
    // "Every N hours" only when the hours tile the day from midnight: 8 and 20
    // are twelve apart, but they are two fixed hours — calling that "every 12
    // hours" promises a slot at 08:00 to somebody reading it at 21:00.
    const step = hours[1] - hours[0]
    const tiles = hours.length === Math.ceil(24 / step)
      && hours.every((v, i) => v === i * step)
    if (tiles) return `Кожні ${step} год`
    return 'О ' + hours.map((v) => `${pad(v)}:${pad(minutes[0])}`).join(', ')
  }
  if (minutes.length === 1 && hours.length === 1) {
    return `Щодня о ${pad(hours[0])}:${pad(minutes[0])}`
  }
  return 'За власним розкладом'
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * The next few moments the expression names, computed here.
 *
 * The reference in the help used to link out to an online cron editor to
 * answer "and when does that actually fire". The server this runs on has no
 * way out to the internet, so the answer is worked out in the browser: the
 * same five rules as the field's own check, walked forward.
 *
 * Hour by hour rather than minute by minute — an hour has at most sixty
 * candidates and the minute field already says which of them count, so a year
 * of search costs nine thousand steps instead of half a million. A year is
 * also the cap: an expression that names nothing within it (the 31st of
 * February) gets
 * an empty answer rather than a hung tab.
 */
export function nextRuns(expression: string, from: Date, count = 5): Date[] {
  const text = (expression ?? '').trim().toLowerCase()
  if (!text || cronError(text)) return []
  const [m, h, dom, mon, dow] = text.split(/\s+/)
  const minutes = new Set(values(m, 0, 59))
  const hours = new Set(values(h, 0, 23))
  const days = new Set(values(dom, 1, 31))
  const months = new Set(values(mon, 1, 12))
  // Sunday is written both ways, and both have to mean the same day.
  const weekdays = new Set(values(dow, 0, 7).map((v) => (v === 7 ? 0 : v)))
  const dayAny = days.size === 31
  const weekdayAny = weekdays.size === 7

  const out: Date[] = []
  const cursor = new Date(from.getTime())
  cursor.setSeconds(0, 0)
  const startMs = cursor.getTime() + 60_000 // strictly after "now"
  cursor.setMinutes(0)

  for (let step = 0; step < 366 * 24 && out.length < count; step++) {
    const hour = new Date(cursor.getTime() + step * 3_600_000)
    if (!hours.has(hour.getHours()) || !months.has(hour.getMonth() + 1)) continue
    const dayHit = days.has(hour.getDate())
    const weekdayHit = weekdays.has(hour.getDay())
    // Day of month and day of week are OR when both are restricted — the rule
    // every cron follows and the one that surprises everybody.
    const dateHit =
      dayAny && weekdayAny ? true
      : dayAny ? weekdayHit
      : weekdayAny ? dayHit
      : dayHit || weekdayHit
    if (!dateHit) continue
    for (const minute of [...minutes].sort((a, b) => a - b)) {
      const when = new Date(hour.getTime())
      when.setMinutes(minute, 0, 0)
      if (when.getTime() < startMs) continue
      out.push(when)
      if (out.length === count) break
    }
  }
  return out
}

/** The rhythms a poll is actually set to, ready to pick. */
export const CRON_PRESETS: Array<{ label: string; value: string }> = [
  { label: 'Щогодини', value: '0 * * * *' },
  { label: 'Кожні 2 год', value: '0 */2 * * *' },
  { label: 'Кожні 4 год', value: '0 */4 * * *' },
  { label: 'Кожні 6 год', value: '0 */6 * * *' },
  { label: 'Щодня о 08:00', value: '0 8 * * *' },
  { label: 'О 08:00 і 20:00', value: '0 8,20 * * *' },
]
