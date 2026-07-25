import { Center, Loader, Stack, Text } from '@mantine/core'
import { useUser } from '@/features/auth/UserContext'
import { useLanguage } from '@/locales/LanguageContext'
import { LoginPage } from '@/features/auth/LoginPage'
import { AuthedLanding } from './AuthedLanding'

/** Auth gate: loading → login → authenticated app. */
export function App() {
  const { user, loading } = useUser()
  const { t } = useLanguage()

  if (loading) {
    return (
      <Center h="100dvh">
        <Stack align="center" gap="sm">
          <Loader color="petrol" />
          <Text c="dimmed" size="sm">
            {t('appLoading')}
          </Text>
        </Stack>
      </Center>
    )
  }

  if (!user) return <LoginPage />

  return <AuthedLanding />
}
