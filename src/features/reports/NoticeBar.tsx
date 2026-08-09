import { Badge, Group, Popover, Stack, Text } from '@mantine/core'
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react'

export interface Notice {
  tone: 'info' | 'warn'
  text: string
}

/**
 * Every notice about a report on one line: the first one inline, the rest
 * behind a counter that opens them. Four stacked alerts pushed the table off
 * the screen for text that is read once and then in the way.
 */
export function NoticeBar({ notices }: { notices: Notice[] }) {
  if (notices.length === 0) return null
  const [first, ...rest] = notices
  const worst = notices.some((n) => n.tone === 'warn') ? 'warn' : 'info'
  const color = worst === 'warn' ? 'var(--mantine-color-yellow-7)' : 'var(--mantine-color-blue-6)'
  const Icon = worst === 'warn' ? IconAlertTriangle : IconInfoCircle

  return (
    <Group gap={6} wrap="nowrap" ml="auto" style={{ minWidth: 0 }}>
      <Icon size={15} style={{ color, flexShrink: 0 }} />
      <Text size="xs" c="dimmed" lineClamp={1} title={first.text}>
        {first.text}
      </Text>
      {rest.length > 0 && (
        <Popover width={420} position="bottom-end" withArrow shadow="md">
          <Popover.Target>
            <Badge
              size="sm"
              variant="light"
              color={worst === 'warn' ? 'yellow' : 'blue'}
              style={{ cursor: 'pointer', flexShrink: 0 }}
            >
              +{rest.length}
            </Badge>
          </Popover.Target>
          <Popover.Dropdown>
            <Stack gap={6}>
              {notices.map((n) => (
                <Group key={n.text} gap={6} wrap="nowrap" align="flex-start">
                  {n.tone === 'warn' ? (
                    <IconAlertTriangle
                      size={14}
                      style={{ color: 'var(--mantine-color-yellow-7)', flexShrink: 0, marginTop: 2 }}
                    />
                  ) : (
                    <IconInfoCircle
                      size={14}
                      style={{ color: 'var(--mantine-color-blue-6)', flexShrink: 0, marginTop: 2 }}
                    />
                  )}
                  <Text size="xs">{n.text}</Text>
                </Group>
              ))}
            </Stack>
          </Popover.Dropdown>
        </Popover>
      )}
    </Group>
  )
}
