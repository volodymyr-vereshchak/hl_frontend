import { useMemo, useState } from 'react'
import { Box, Button, Checkbox, Group, Popover, ScrollArea, Text, TextInput } from '@mantine/core'
import { IconChevronDown, IconSearch } from '@tabler/icons-react'
import { useLanguage } from '@/locales/LanguageContext'

export interface CheckboxFilterOption {
  value: string
  label: string
  /** How many rows sit behind this option; shown dimmed on the right. */
  count?: number
}

interface Props {
  /** Name of the filter, shown on the closed control. */
  label: string
  options: CheckboxFilterOption[]
  /** Selected values. EMPTY MEANS NO RESTRICTION, not "nothing shown". */
  value: string[]
  onChange: (next: string[]) => void
  searchPlaceholder?: string
  /** Below this many options a search box is more noise than help. */
  searchFrom?: number
  width?: number
}

/**
 * A many-of-N filter that keeps the same width however much is picked.
 *
 * Mantine's MultiSelect grows a pill per value: with half a dozen corrector
 * models chosen the filter strip was taller than the toolbar above it and the
 * table lost several rows to it. Here the selection stays a count — «3 / 12» —
 * and the list itself lives in a dropdown, the same shape `ChartLinePicker`
 * uses for chart series.
 *
 * Empty selection means everything passes, so the two actions are not opposites:
 * «Усі» ticks what is currently listed (after a search, that is the point of it)
 * and «Очистити» drops the filter altogether.
 */
export function CheckboxFilter({
  label,
  options,
  value,
  onChange,
  searchPlaceholder,
  searchFrom = 8,
  width = 300,
}: Props) {
  const { t } = useLanguage()
  const [opened, setOpened] = useState(false)
  const [query, setQuery] = useState('')

  const withSearch = options.length >= searchFrom
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  }, [options, query])

  const picked = new Set(value)
  const toggle = (v: string) =>
    onChange(picked.has(v) ? value.filter((x) => x !== v) : [...value, v])
  const addVisible = () =>
    onChange([...value, ...visible.map((o) => o.value).filter((v) => !picked.has(v))])
  const allVisiblePicked = visible.length > 0 && visible.every((o) => picked.has(o.value))

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      shadow="md"
      radius="md"
      width={width}
      trapFocus
    >
      <Popover.Target>
        <Button
          size="xs"
          // A set filter is visibly set even when the dropdown is closed —
          // otherwise a narrowed table looks like missing data.
          variant={value.length ? 'light' : 'default'}
          color={value.length ? 'petrol' : undefined}
          onClick={() => setOpened((o) => !o)}
          rightSection={<IconChevronDown size={14} />}
        >
          {label}: {value.length ? `${value.length} / ${options.length}` : t('selectAll').toLowerCase()}
        </Button>
      </Popover.Target>

      <Popover.Dropdown p={0}>
        <Box p="xs" style={{ borderBottom: '1px solid var(--hlv-border)' }}>
          {withSearch && (
            <TextInput
              size="xs"
              placeholder={searchPlaceholder}
              leftSection={<IconSearch size={14} />}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              data-autofocus
            />
          )}
          <Group gap={6} mt={withSearch ? 'xs' : 0}>
            <Button
              size="compact-xs"
              variant="light"
              onClick={addVisible}
              disabled={allVisiblePicked}
            >
              {t('selectAll')}
            </Button>
            <Button
              size="compact-xs"
              variant="light"
              color="gray"
              onClick={() => onChange([])}
              disabled={value.length === 0}
            >
              {t('clearSelection')}
            </Button>
          </Group>
        </Box>

        <ScrollArea.Autosize mah={320} type="auto">
          <Box p={6}>
            {visible.length === 0 && (
              <Text size="xs" c="dimmed" ta="center" py="sm">
                {t('nothingFound')}
              </Text>
            )}
            {visible.map((o) => (
              <Group
                key={o.value}
                gap={8}
                wrap="nowrap"
                px={6}
                py={4}
                style={{ borderRadius: 6 }}
                className="hlv-picker-row"
              >
                <Checkbox
                  size="xs"
                  checked={picked.has(o.value)}
                  onChange={() => toggle(o.value)}
                  color="petrol"
                  styles={{ input: { cursor: 'pointer' } }}
                />
                <Text
                  size="xs"
                  lineClamp={1}
                  title={o.label}
                  style={{ flex: 1, cursor: 'pointer' }}
                  onClick={() => toggle(o.value)}
                >
                  {o.label}
                </Text>
                {o.count !== undefined && (
                  <Text size="xs" c="dimmed">
                    {o.count}
                  </Text>
                )}
              </Group>
            ))}
          </Box>
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  )
}
