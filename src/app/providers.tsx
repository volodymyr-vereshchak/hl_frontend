import { type ReactNode } from 'react'
import {
  MantineProvider,
  localStorageColorSchemeManager,
} from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { ModalsProvider } from '@mantine/modals'
import { DatesProvider } from '@mantine/dates'
import { QueryClientProvider } from '@tanstack/react-query'
import dayjs from 'dayjs'
import 'dayjs/locale/uk'
import 'dayjs/locale/ru'
import { useLanguage } from '@/locales/LanguageContext'
import { theme } from '@/theme/theme'
import { queryClient } from '@/lib/queryClient'
import { LanguageProvider } from '@/locales/LanguageContext'
import { UserProvider } from '@/features/auth/UserContext'

const colorSchemeManager = localStorageColorSchemeManager({
  key: 'hlv-color-scheme',
})

/** Feeds the UI language into Mantine dates (month names, weekday labels). */
function LocalizedDates({ children }: { children: ReactNode }) {
  const { currentLanguage } = useLanguage()
  dayjs.locale(currentLanguage)
  return (
    <DatesProvider settings={{ locale: currentLanguage, firstDayOfWeek: 1, weekendDays: [0, 6] }}>
      {children}
    </DatesProvider>
  )
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MantineProvider
      theme={theme}
      defaultColorScheme="dark"
      colorSchemeManager={colorSchemeManager}
    >
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <UserProvider>
            <LocalizedDates>
              <ModalsProvider>{children}</ModalsProvider>
            </LocalizedDates>
          </UserProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </MantineProvider>
  )
}
