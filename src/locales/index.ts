import { ru } from './ru'
import { uk } from './uk'

export const translations = { ru, uk }

export type Language = keyof typeof translations
export type TranslationKey = keyof typeof ru

export const defaultLanguage: Language = 'ru'

export const languages: { code: Language; name: string; flag: string }[] = [
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'uk', name: 'Українська', flag: '🇺🇦' },
]

/** Look up a key; falls back to the default language, then the key itself. */
export function getTranslation(language: Language, key: string): string {
  const lang = translations[language] ?? translations[defaultLanguage]
  return (lang as Record<string, string>)[key] ?? key
}

export function getBrowserLanguage(): Language {
  const browserLang = navigator.language || ''
  if (browserLang.startsWith('uk')) return 'uk'
  if (browserLang.startsWith('ru')) return 'ru'
  return defaultLanguage
}

const STORAGE_KEY = 'hlviewer-language'

export function getSavedLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && saved in translations) return saved as Language
  return getBrowserLanguage()
}

export function saveLanguage(language: Language): void {
  localStorage.setItem(STORAGE_KEY, language)
}

export function getDateLocale(language: Language): string {
  return language === 'uk' ? 'uk-UA' : 'ru-RU'
}
