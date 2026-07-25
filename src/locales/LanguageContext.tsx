import { createContext, use, useCallback, useState, type ReactNode } from 'react'
import {
  getDateLocale,
  getSavedLanguage,
  getTranslation,
  saveLanguage,
  type Language,
  type TranslationKey,
} from './index'

interface LanguageContextValue {
  currentLanguage: Language
  changeLanguage: (lang: Language) => void
  t: (key: TranslationKey | string) => string
  getLocale: () => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [currentLanguage, setCurrentLanguage] = useState<Language>(getSavedLanguage)

  const changeLanguage = useCallback((lang: Language) => {
    setCurrentLanguage(lang)
    saveLanguage(lang)
  }, [])

  const t = useCallback(
    (key: TranslationKey | string) => getTranslation(currentLanguage, key as string),
    [currentLanguage],
  )

  const getLocale = useCallback(() => getDateLocale(currentLanguage), [currentLanguage])

  return (
    <LanguageContext value={{ currentLanguage, changeLanguage, t, getLocale }}>
      {children}
    </LanguageContext>
  )
}

export function useLanguage(): LanguageContextValue {
  const ctx = use(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider')
  return ctx
}
