import { useEffect, useRef, useState } from 'react'
import { Popover, Button, Group, Input, Text, Divider, Box, Stack, ScrollArea } from '@mantine/core'
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
  disabled?: boolean
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
 * Date + hour picker for the hourly / sys / edit archives and the flow
 * calculator. Uses a 24-cell hour GRID instead of a scrolling time list —
 * every hour is one click away, which is what these views actually need
 * (values are always on the hour).
 *
 * Date and hour are picked TOGETHER and committed by the button: closing on
 * the date click meant reopening the popover just to reach the hour, which is
 * the one thing you always want to do next. Nothing leaves this component
 * until "Застосувати", so an abandoned popover changes nothing.
 */
export function HourDateTimePicker({
  value,
  onChange,
  todayValue,
  ariaLabel,
  width = 185,
  disabled,
}: Props) {
  const { t } = useLanguage()
  const [opened, setOpened] = useState(false)
  // Draft, seeded from the current value every time the popover opens — which
  // is also what makes it open ON the selected month instead of on today.
  const [draft, setDraft] = useState(() => split(value))
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement | null>(null)

  const open = () => {
    setDraft(split(value))
    setOpened(true)
  }
  const close = () => setOpened(false)
  const apply = () => {
    onChange(`${draft.date} ${draft.time}:00`)
    close()
  }

  // Bring the drafted hour into view when the popover opens.
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

  return (
    <Popover
      opened={opened}
      onChange={(o) => (o ? open() : close())}
      position="bottom-start"
      withinPortal
      zIndex={500}
      shadow="md"
      transitionProps={{ duration: 0 }}
    >
      <Popover.Target>
        {/*
          An Input rendered as a button, not a Button — which is exactly what
          Mantine's own DatePickerInput does. The date-only archives use that
          component, and a Button target next to it was visibly off: same face
          and size, but a button's line-height (11px vs 17px) and text inset
          differ, so the two pickers in one toolbar did not look like the same
          control. Sharing the primitive keeps them identical for free.
        */}
        <Input
          component="button"
          type="button"
          pointer
          size="xs"
          onClick={() => (opened ? close() : open())}
          disabled={disabled}
          leftSection={<IconCalendar size={15} />}
          w={width}
          aria-label={ariaLabel}
        >
          {fmt(value)}
        </Input>
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
              onClick={() => setDraft(split(todayValue))}
            >
              {t('today')}
            </Button>
            <DatePicker
              value={draft.date}
              /* Without this the calendar opens on the current month whatever
                 is selected — `value` alone does not move the view. */
              defaultDate={draft.date || undefined}
              onChange={(v) => v && setDraft((d) => ({ ...d, date: v }))}
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
                value={draft.time}
                onChange={(v) => v && setDraft((d) => ({ ...d, time: v }))}
                simpleGridProps={{ cols: 1, spacing: 4 }}
                size="xs"
                getControlProps={(hour) => ({
                  'data-hour': hour,
                  ref:
                    hour === draft.time
                      ? (node: HTMLButtonElement | null) => {
                          selectedRef.current = node
                        }
                      : undefined,
                })}
              />
            </ScrollArea>
          </Box>
        </Group>
        <Divider my="sm" />
        <Group justify="space-between" wrap="nowrap">
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            {fmt(`${draft.date} ${draft.time}:00`)}
          </Text>
          <Group gap="xs" wrap="nowrap">
            <Button variant="default" size="compact-xs" onClick={close}>
              {t('cancel')}
            </Button>
            <Button size="compact-xs" color="petrol" onClick={apply} disabled={!draft.date}>
              {t('apply')}
            </Button>
          </Group>
        </Group>
      </Popover.Dropdown>
    </Popover>
  )
}
