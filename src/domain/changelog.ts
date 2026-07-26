/**
 * Update history shown in the "What's new" dialog, newest entry first — one
 * entry per page. `date` also drives the unread dot: it is compared against the
 * newest date the user has already opened.
 *
 * To add an update, prepend an entry with today's date and a few bilingual
 * bullets. This is release notes for the people using the app, so write what
 * changed for them, not what changed in the code.
 */
export interface ChangelogEntry {
  date: string
  title: { ru: string; uk: string }
  items: { ru: string[]; uk: string[] }
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-07-26',
    title: {
      ru: 'Новая версия интерфейса',
      uk: 'Нова версія інтерфейсу',
    },
    items: {
      ru: ['Используется новая версия фронтенда.'],
      uk: ['Використовується нова версія фронтенду.'],
    },
  },
]

/** Newest entry's date — the value stored once the user has seen the dialog. */
export const CHANGELOG_KEY = CHANGELOG[0]?.date ?? ''
export const CHANGELOG_SEEN_STORAGE = 'hlv-changelog-seen'
