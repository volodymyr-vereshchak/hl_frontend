import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Box,
  Button,
  Checkbox,
  Group,
  Popover,
  ScrollArea,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { IconChevronDown, IconSearch, IconTarget } from '@tabler/icons-react'
import { useLanguage } from '@/locales/LanguageContext'

export interface PickerLine {
  id: number
  name: string
  color: string
}

interface Props {
  lines: PickerLine[]
  /** Line ids currently hidden from the chart. */
  hidden: Record<number, boolean>
  onChange: (hidden: Record<number, boolean>) => void
}

/**
 * Series toggles for a chart that can carry ~90 lines. A row of buttons per line
 * pushed the chart off screen, so the whole set collapses into one control that
 * reports how many are shown and opens a searchable checklist.
 */
export function ChartLinePicker({ lines, hidden, onChange }: Props) {
  const { t } = useLanguage()
  const [opened, setOpened] = useState(false)
  const [query, setQuery] = useState('')

  const shown = lines.filter((l) => !hidden[l.id]).length
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? lines.filter((l) => l.name.toLowerCase().includes(q)) : lines
  }, [lines, query])

  const setAll = (hide: boolean) => {
    if (!hide) {
      onChange({})
      return
    }
    const next: Record<number, boolean> = {}
    lines.forEach((l) => (next[l.id] = true))
    onChange(next)
  }

  /** Show this line and nothing else — the fastest way to read one curve. */
  const solo = (id: number) => {
    const next: Record<number, boolean> = {}
    lines.forEach((l) => (next[l.id] = l.id !== id))
    onChange(next)
  }

  const toggle = (id: number) => onChange({ ...hidden, [id]: !hidden[id] })

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      shadow="md"
      radius="md"
      width={320}
      trapFocus
    >
      <Popover.Target>
        <Button
          size="compact-sm"
          variant="default"
          onClick={() => setOpened((o) => !o)}
          rightSection={<IconChevronDown size={14} />}
        >
          {t('linesShown')}: {shown} / {lines.length}
        </Button>
      </Popover.Target>

      <Popover.Dropdown p={0}>
        <Box p="xs" style={{ borderBottom: '1px solid var(--hlv-border)' }}>
          <TextInput
            size="xs"
            placeholder={t('searchLine')}
            leftSection={<IconSearch size={14} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            data-autofocus
          />
          <Group gap={6} mt="xs">
            <Button size="compact-xs" variant="light" onClick={() => setAll(false)}>
              {t('selectAll')}
            </Button>
            <Button size="compact-xs" variant="light" color="gray" onClick={() => setAll(true)}>
              {t('selectNone')}
            </Button>
          </Group>
        </Box>

        <ScrollArea.Autosize mah={320} type="auto">
          <Box p={6}>
            {filtered.length === 0 && (
              <Text size="xs" c="dimmed" ta="center" py="sm">
                {t('nothingFound')}
              </Text>
            )}
            {filtered.map((l) => (
              <Group
                key={l.id}
                gap={8}
                wrap="nowrap"
                px={6}
                py={4}
                style={{ borderRadius: 6 }}
                className="hlv-picker-row"
              >
                <Checkbox
                  size="xs"
                  checked={!hidden[l.id]}
                  onChange={() => toggle(l.id)}
                  color="petrol"
                  styles={{ input: { cursor: 'pointer' } }}
                />
                <Box
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: l.color,
                    flexShrink: 0,
                  }}
                />
                <Text
                  size="xs"
                  lineClamp={1}
                  title={l.name}
                  style={{ flex: 1, cursor: 'pointer' }}
                  onClick={() => toggle(l.id)}
                >
                  {l.name}
                </Text>
                <Tooltip label={t('onlyThis')} withArrow openDelay={400}>
                  <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => solo(l.id)}>
                    <IconTarget size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ))}
          </Box>
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  )
}
