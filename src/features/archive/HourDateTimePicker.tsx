import { useEffect, useRef, useState } from 'react'
import { Popover, Button, Group, Text, Divider, Box, Stack, ScrollArea } from '@mantine/core'
import { DatePicker, TimeGrid } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import { useLanguage } from '@/locales/LanguageContext'

interface Props {
  /** "YYYY-MM-DD HH:mm:ss" */
  value: string
  onChange: (value: string) => void
  /** Jump target for the "today" shortcut, same string format. */
  todayValue: string
  ariaLabel?: string
  width?: number
}

const pad = (n: number) => String(n).padStart(2, '0')
const HOURS = Array.from({ length: 24 }, (_, h) => `${pad(h)}:00`)

function split(value: string): { date: string; time: string } {
  const [date = '', rest = ''] = value.split(' ')
  return { date, time: rest.slice(0, 5) || '00:00' }
}

function fmt(value: string): string {
  const { date, time } = split(value)
  const [y, m, d] = date.split('-')
  return y ? `${d}.${m}.${y} ${time}` : value
}

/**
 * Date + hour picker for the hourly / sys / edit archives. Uses a 24-cell hour
 * GRID instead of a scrolling time list — every hour is one click away, which
 * is what these archives actually need (values are always on the hour).
 */
export function HourDateTimePicker({ value, onChange, todayValue, ariaLabel, width = 185 }: Props) {
  const { t } = useLanguage()
  const [opened, setOpened] = useState(false)
  const close = () => setOpened(false)
  const toggle = () => setOpened((o) => !o)
  const { date, time } = split(value)
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement | null>(null)

  // Bring the current hour into view when the popover opens.
  useEffect(() => {
    if (!opened) return
    const id = requestAnimationFrame(() => {
      const el = selectedRef.current
      const viewport = scrollRef.current
      if (el && viewport) {
        viewport.scrollTop = el.offsetTop - viewport.clientHeight / 2 + el.clientHeight / 2
      }
    })
    return () => cancelAnimationFrame(id)
  }, [opened])

  const commit = (nextDate: string, nextTime: string) => {
    onChange(`${nextDate} ${nextTime}:00`)
  }

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      withinPortal
      zIndex={500}
      shadow="md"
      transitionProps={{ duration: 0 }}
    >
      <Popover.Target>
        <Button
          variant="default"
          size="xs"
          onClick={toggle}
          leftSection={<IconCalendar size={15} />}
          w={width}
          justify="flex-start"
          aria-label={ariaLabel}
          styles={{ label: { fontWeight: 400 } }}
        >
          {fmt(value)}
        </Button>
      </Popover.Target>
      {/* Explicit opaque surface: the dropdown overlaps the tree sidebar. */}
      <Popover.Dropdown
        p="sm"
        style={{ background: 'var(--hlv-surface)', border: '1px solid var(--hlv-border)' }}
      >
        <Group align="flex-start" gap="md" wrap="nowrap">
          <Stack gap="xs" align="stretch">
            <Button
              variant="light"
              size="compact-xs"
              onClick={() => {
                onChange(todayValue)
                close()
              }}
            >
              {t('today')}
            </Button>
            <DatePicker
              value={date}
              onChange={(v) => {
                if (!v) return
                commit(v, time)
                close()
              }}
              size="sm"
            />
          </Stack>
          <Divider orientation="vertical" />
          {/* Compact scrolling hour column — keeps the popover narrow. */}
          <Box>
            <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb={6} ta="center">
              {t('time')}
            </Text>
            <ScrollArea h={248} w={78} type="auto" viewportRef={scrollRef} offsetScrollbars>
              <TimeGrid
                data={HOURS}
                value={time}
                onChange={(v) => {
                  if (!v) return
                  commit(date, v)
                  close()
                }}
                simpleGridProps={{ cols: 1, spacing: 4 }}
                size="xs"
                getControlProps={(hour) => ({
                  'data-hour': hour,
                  ref:
                    hour === time
                      ? (node: HTMLButtonElement | null) => {
                          selectedRef.current = node
                        }
                      : undefined,
                })}
              />
            </ScrollArea>
          </Box>
        </Group>
      </Popover.Dropdown>
    </Popover>
  )
}
