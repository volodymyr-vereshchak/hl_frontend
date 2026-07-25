import {
  AppShell,
  Group,
  Text,
  Title,
  Card,
  SimpleGrid,
  Badge,
  Stack,
  Button,
  Box,
} from '@mantine/core'
import { IconGauge } from '@tabler/icons-react'
import { ColorSchemeToggle } from '@/components/ColorSchemeToggle'
import { numericStyle } from '@/theme/theme'

/**
 * Temporary landing that proves the design system is wired (theme, fonts,
 * light/dark). Replaced by the real AppShell + router in a later step.
 */
export function App() {
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
          <ColorSchemeToggle />
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Stack gap="lg">
          <Box>
            <Title order={2}>Каркас нового фронтенду</Title>
            <Text c="dimmed">
              Дизайн-система, тема (світла/темна) та шрифти підключені. Далі —
              навігація, автентифікація й екрани.
            </Text>
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

          <Group>
            <Button>Основна дія</Button>
            <Button variant="light" color="amber">
              Сигнал
            </Button>
            <Button variant="default">Другорядна</Button>
          </Group>
        </Stack>
      </AppShell.Main>
    </AppShell>
  )
}
