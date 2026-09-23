/**
 * What clearing a line's archive over a range is about to do, in words.
 *
 * Both ends are optional, and that is the point: the stretch somebody wants
 * gone is usually described as "everything before we noticed" or "everything
 * since the swap", so demanding two dates would have people type one they do
 * not mean. The three readings — from a day on, up to a day, between two days
 * — are told apart by which fields are filled, and the sentence this builds is
 * what saves anybody from having to work that out for themselves.
 */

export interface ArchiveExtent {
  first: string | null
  last: string | null
}

export type RangeVerdict =
  | { kind: 'backwards'; text: string }
  | { kind: 'none'; text: string }
  | { kind: 'from'; text: string }
  | { kind: 'to'; text: string }
  | { kind: 'span'; text: string; days: number }

/** "2026-09-23" → "23.09.2026"; an empty date stays empty. */
export const humanDate = (iso: string | null | undefined): string =>
  iso ? iso.split('-').reverse().join('.') : ''

/** Whole days between two ISO dates, both ends counted. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1

export function describeRange(
  from: string | null,
  to: string | null,
  extent?: ArchiveExtent | null,
): RangeVerdict {
  if (from && to && from > to) {
    return {
      kind: 'backwards',
      text: 'Початкова дата пізніша за кінцеву — поміняйте їх місцями',
    }
  }
  if (from && to) {
    return {
      kind: 'span',
      days: daysBetween(from, to),
      text: `Буде видалено з ${humanDate(from)} по ${humanDate(to)} включно — ${daysBetween(from, to)} діб`,
    }
  }
  if (from) {
    const till = extent?.last ? `, до кінця архіву (${humanDate(extent.last)})` : ''
    return { kind: 'from', text: `Буде видалено все від ${humanDate(from)} і новіше${till}` }
  }
  if (to) {
    const since = extent?.first ? `, від початку архіву (${humanDate(extent.first)})` : ''
    return { kind: 'to', text: `Буде видалено все до ${humanDate(to)} включно${since}` }
  }
  return {
    kind: 'none',
    text:
      'Лишіть початок порожнім, щоб видалити все до кінцевої дати; ' +
      'лишіть кінець порожнім, щоб видалити все від початкової і новіше',
  }
}
