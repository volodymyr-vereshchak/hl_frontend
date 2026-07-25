import { AppShell, Group, Text, Title, Card, SimpleGrid, Badge, Stack, Box } from '@mantine/core'
import { IconGauge } from '@tabler/icons-react'
import { ColorSchemeToggle } from '@/components/ColorSchemeToggle'
import { LanguagePicker } from '@/components/LanguagePicker'
import { UserBadge } from '@/features/auth/UserBadge'
import { numericStyle } from '@/theme/theme'

/**
 * Temporary authenticated landing — proves the full auth loop and design
 * system. Replaced by the real AppShell + router (nav, Overview, archives).
 */
export function AuthedLanding() {
  return (
    <AppShell header={{ height: 56 }} padding="lg">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <IconGauge size={22} color="var(--mantine-color-petrol-6)" />
            <Text fw={700} ff="'Space Grotesk Variable', sans-serif" size="lg">
              HLViewer
            </Text>
            <Badge variant="light" color="petrol" size="sm">
              ГРС · телеметрія
            </Badge>
          </Group>
          <Group gap="xs">
            <LanguagePicker />
            <ColorSchemeToggle />
            <UserBadge />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Stack gap="lg">
          <Box>
            <Title order={2}>Каркас нового фронтенду</Title>
            <Text c="dimmed">Автентифікація, тема та мова підключені. Далі — навігація й екрани.</Text>
          </Box>

          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
            {[
              { label: 'Обʼєм за 24 год', value: '128 540', unit: 'м³' },
              { label: 'Середній тиск', value: '1.204', unit: 'МПа' },
              { label: 'Активних ліній', value: '14 / 16', unit: '' },
              { label: 'Аварій за добу', value: '0', unit: '' },
            ].map((m) => (
              <Card key={m.label} padding="md" radius="md">
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  {m.label}
                </Text>
                <Group align="baseline" gap={6} mt={4}>
                  <Text fz={28} fw={600} style={numericStyle}>
                    {m.value}
                  </Text>
                  {m.unit && (
                    <Text c="dimmed" size="sm">
                      {m.unit}
                    </Text>
                  )}
                </Group>
              </Card>
            ))}
          </SimpleGrid>
        </Stack>
      </AppShell.Main>
    </AppShell>
  )
}
