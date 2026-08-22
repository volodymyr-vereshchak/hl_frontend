import { useState, type FormEvent } from 'react'
import {
  Box,
  Button,
  Card,
  Checkbox,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Alert,
} from '@mantine/core'
import { IconGauge, IconAlertTriangle, IconShieldLock } from '@tabler/icons-react'
import { ApiError } from '@/lib/apiClient'
import { useLanguage } from '@/locales/LanguageContext'
import { ColorSchemeToggle } from '@/components/ColorSchemeToggle'
import { LanguagePicker } from '@/components/LanguagePicker'
import { useUser } from './UserContext'

export function LoginPage() {
  const { login, sessionNotice } = useUser()
  const { t } = useLanguage()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password, rememberMe)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('loginError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--mantine-spacing-md)',
        // Subtle instrument-panel backdrop.
        backgroundImage:
          'radial-gradient(1200px 500px at 50% -10%, var(--mantine-color-petrol-light), transparent)',
      }}
    >
      <Group pos="absolute" top={16} right={16} gap="xs">
        <LanguagePicker />
        <ColorSchemeToggle />
      </Group>

      <Card w={380} maw="100%" padding="xl" radius="lg" shadow="md">
        <Stack gap="lg">
          <Group gap="sm">
            <ThemeIcon size={44} radius="md" variant="light" color="petrol">
              <IconGauge size={26} />
            </ThemeIcon>
            <Box>
              <Text fw={700} fz="xl" ff="'Space Grotesk Variable', sans-serif" lh={1.1}>
                {t('loginTitle')}
              </Text>
              <Text c="dimmed" size="sm">
                {t('loginSubtitle')}
              </Text>
            </Box>
          </Group>

          {sessionNotice && (
            <Alert
              color="amber"
              variant="light"
              icon={<IconShieldLock size={16} />}
              py="xs"
            >
              {sessionNotice === 'domain-login-off'
                ? t('sessionDomainLoginOff')
                : t('sessionRightsChanged')}
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <TextInput
                label={t('loginUsername')}
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
                autoFocus
                autoComplete="username"
                required
              />
              <PasswordInput
                label={t('loginPassword')}
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                autoComplete="current-password"
                required
              />
              <Checkbox
                label={t('loginRemember')}
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.currentTarget.checked)}
              />
              {error && (
                <Alert
                  color="red"
                  variant="light"
                  icon={<IconAlertTriangle size={16} />}
                  py="xs"
                >
                  {error}
                </Alert>
              )}
              <Button type="submit" loading={loading} fullWidth size="md">
                {loading ? t('loginSubmitting') : t('loginSubmit')}
              </Button>
            </Stack>
          </form>
        </Stack>
      </Card>
    </Box>
  )
}
