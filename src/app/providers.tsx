import { type ReactNode } from 'react'
import {
  MantineProvider,
  localStorageColorSchemeManager,
} from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { ModalsProvider } from '@mantine/modals'
import { QueryClientProvider } from '@tanstack/react-query'
import { theme } from '@/theme/theme'
import { queryClient } from '@/lib/queryClient'

const colorSchemeManager = localStorageColorSchemeManager({
  key: 'hlv-color-scheme',
})

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MantineProvider
      theme={theme}
      defaultColorScheme="dark"
      colorSchemeManager={colorSchemeManager}
    >
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <ModalsProvider>{children}</ModalsProvider>
      </QueryClientProvider>
    </MantineProvider>
  )
}
