import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  Progress,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import {
  IconAlertTriangle,
  IconCalendar,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconFileSpreadsheet,
  IconPlayerPlay,
  IconPlayerStop,
  IconSearch,
  IconX,
} from '@tabler/icons-react'
import type { EventGroup, EventReport, StreamProgress } from '@/api/enterprise'
import { useLanguage } from '@/locales/LanguageContext'
import { numericStyle } from '@/theme/theme'

/**
 * Seconds → "3 дн 4 год 05 хв". Alarms run from seconds to weeks, so a fixed
 * unit is unreadable at one end or the other; the largest two units carry all
 * the meaning and the rest is noise.
 */
export function formatDuration(seconds: number, t: (k: string) => string): string {
  if (!seconds) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (d) return `${d} ${t('unitDayShort')} ${h} ${t('unitHourShort')}`
  if (h) return `${h} ${t('unitHourShort')} ${String(m).padStart(2, '0')} ${t('unitMinShort')}`
  if (m) return `${m} ${t('unitMinShort')} ${String(s).padStart(2, '0')} ${t('unitSecShort')}`
  return `${s} ${t('unitSecShort')}`
}

/** 'YYYY-MM-DD HH:mm:ss' → 'DD.MM HH:mm'. Seconds never matter here. */
function stamp(value: string | null | undefined): string {
  if (!value) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value)
  return m ? `${m[3]}.${m[2]} ${m[4]}:${m[5]}` : value
}

function Stat({ label, value, of, color }: { label: string; value: string | number; of?: string; color?: string }) {
  return (
    <Paper radius="md" withBorder p="md">
      <Text size="10px" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: 0.6 }}>
        {label}
      </Text>
      <Group align="baseline" gap={6} mt={4} wrap="nowrap">
        <Text fz={26} fw={700} lh={1.05} c={color} style={numericStyle}>
          {value}
        </Text>
        {of && (
          <Text size="xs" c="dimmed">
            {of}
          </Text>
        )}
      </Group>
    </Paper>
  )
}

export interface AccidentsReportProps {
  report: EventReport | null
  loading: boolean
  progress: StreamProgress | null
  error: string | null
  /** 'YYYY-MM-DD' — this page keeps its ranges as strings. */
  from: string
  to: string
  onFromChange: (d: string) => void
  onToChange: (d: string) => void
  onRun: () => void
  onStop: () => void
  onClose: () => void
  onExport: (groups: EventGroup[]) => void
}

/**
 * Alarms of the branch's enterprises, as a pane over the poll results.
 *
 * A pane rather than a modal for the same reason the "no poll" report is one:
 * the list runs to hundreds of rows and a modal both caps them at 60vh and
 * covers the enterprise tree behind it.
 *
 * Nothing here is stored server-side, so the pane owns no cache: closing it
 * keeps the last result in the page's state, and «Опитати» polls DPD again.
 */
export function AccidentsReport({
  report,
  loading,
  progress,
  error,
  from,
  to,
  onFromChange,
  onToChange,
  onRun,
  onStop,
  onClose,
  onExport,
}: AccidentsReportProps) {
  const { t } = useLanguage()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    const all = report?.groups ?? []
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.type.toLowerCase().includes(q) ||
        g.objects.some((o) => o.enterprise_name.toLowerCase().includes(q)),
    )
  }, [report, search])

  const totalDuration = useMemo(() => groups.reduce((a, g) => a + g.duration, 0), [groups])
  const totalAppearances = useMemo(() => groups.reduce((a, g) => a + g.appearances, 0), [groups])

  const toggle = (type: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })

  const phaseLabel =
    progress?.phase === 'list' ? t('entAccPhaseList') : t('entAccPhasePolling')
  const pct =
    progress?.total && progress.done != null
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : null

  // The page already wraps this slot in a bordered Paper, so the report is a
  // fragment: nesting a second Paper drew a border inside a border.
  return (
    <>
      <Group
        px="sm"
        py={8}
        gap="xs"
        wrap="nowrap"
        style={{ borderBottom: '1px solid var(--hlv-border)', flexShrink: 0 }}
      >
        <IconAlertTriangle size={17} style={{ color: 'var(--mantine-color-amber-5)' }} />
        <Text size="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
          {t('accidentsReport')}
        </Text>
        {report && (
          <Badge size="sm" variant="light" color={report.groups.length ? 'amber' : 'teal'}>
            {search ? `${groups.length} / ${report.groups.length}` : report.groups.length}
          </Badge>
        )}

        {/* The report's own range: it is opened to ask about a week that the
            volume poll above may have nothing to do with. */}
        <DatePickerInput
          aria-label={t('from')}
          leftSection={<IconCalendar size={15} />}
          value={from}
          onChange={(v) => v && onFromChange(v)}
          valueFormat="DD.MM.YYYY"
          size="xs"
          w={140}
          disabled={loading}
          popoverProps={{ zIndex: 500, withinPortal: true }}
        />
        <DatePickerInput
          aria-label={t('to')}
          leftSection={<IconCalendar size={15} />}
          value={to}
          onChange={(v) => v && onToChange(v)}
          valueFormat="DD.MM.YYYY"
          size="xs"
          w={140}
          disabled={loading}
          popoverProps={{ zIndex: 500, withinPortal: true }}
        />
        {loading ? (
          <Button size="xs" color="red" variant="light" leftSection={<IconPlayerStop size={15} />} onClick={onStop}>
            {t('stop')}
          </Button>
        ) : (
          <Button size="xs" leftSection={<IconPlayerPlay size={15} />} onClick={onRun}>
            {t('poll')}
          </Button>
        )}

        <TextInput
          placeholder={t('entAccSearchType')}
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          size="xs"
          w={220}
          disabled={!report}
        />
        <Button
          size="xs"
          variant="light"
          color="teal"
          leftSection={<IconFileSpreadsheet size={15} />}
          onClick={() => onExport(groups)}
          disabled={!groups.length}
          ml="auto"
        >
          {t('excel')}
        </Button>
        <ActionIcon variant="subtle" color="gray" onClick={onClose} aria-label={t('close')}>
          <IconX size={16} />
        </ActionIcon>
      </Group>

      {loading && (
        <Box px="sm" py={6} style={{ borderBottom: '1px solid var(--hlv-border)', flexShrink: 0 }}>
          <Group gap={8} wrap="nowrap" mb={4}>
            <Loader size={13} />
            <Text size="xs" c="dimmed">
              {phaseLabel}
              {progress?.done != null && progress?.total
                ? ` — ${progress.done} / ${progress.total}`
                : ''}
            </Text>
          </Group>
          {/* The list phase has no known total (DPD pages until it runs out),
              so it animates instead of pretending to a percentage. */}
          <Progress value={pct ?? 100} animated={pct === null} size="sm" radius="xl" color="amber" />
        </Box>
      )}

      {error && (
        <Box px="sm" py={6} style={{ borderBottom: '1px solid var(--hlv-border)', flexShrink: 0 }}>
          <Text size="xs" c="red">
            {error}
          </Text>
        </Box>
      )}

      {!report && !loading ? (
        <Center style={{ flex: 1 }}>
          <Stack align="center" gap={8} c="dimmed">
            <IconAlertTriangle size={40} stroke={1.2} />
            <Text size="sm">{t('entAccPoll')}</Text>
          </Stack>
        </Center>
      ) : !report ? (
        <Box style={{ flex: 1 }} />
      ) : report.groups.length === 0 ? (
        <Center style={{ flex: 1 }}>
          <Stack align="center" gap={8} c="teal">
            <IconCircleCheck size={44} stroke={1.2} />
            <Text size="sm" fw={600}>
              {t('entAccNone')}
            </Text>
            <Text size="xs" c="dimmed">
              {t('entAccChecked')}: {report.stats.ours}
            </Text>
          </Stack>
        </Center>
      ) : (
        <ScrollArea className="hlv-table-scroll" type="auto" style={{ flex: 1 }}>
          <Box p="md">
            <SimpleGrid cols={{ base: 1, sm: 4 }} spacing="sm">
              <Stat
                label={t('entAccWithEvents')}
                value={report.stats.with_events}
                of={`${t('unpolledOutOf')} ${report.stats.ours} ${t('entAccOfOurs')}`}
                color="amber.5"
              />
              <Stat label={t('entAccTypes')} value={groups.length} />
              <Stat label={t('entAccCount')} value={totalAppearances} />
              <Stat label={t('entAccDuration')} value={formatDuration(totalDuration, t)} />
            </SimpleGrid>

            {report.stats.untranslated.length > 0 && (
              <Text size="xs" c="dimmed" mt="sm">
                {t('entAccUntranslated')}: {report.stats.untranslated.join(', ')}
              </Text>
            )}

            <Paper radius="md" withBorder mt="lg" style={{ overflow: 'hidden' }}>
              <Table striped highlightOnHover verticalSpacing={6}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={34} />
                    <Table.Th>{t('entAccType')}</Table.Th>
                    <Table.Th ta="center" w={120}>
                      {t('entAccFirst')}
                    </Table.Th>
                    <Table.Th ta="center" w={120}>
                      {t('entAccLast')}
                    </Table.Th>
                    <Table.Th ta="right" w={150}>
                      {t('entAccDuration')}
                    </Table.Th>
                    <Table.Th ta="right" w={90}>
                      {t('entAccCount')}
                    </Table.Th>
                    <Table.Th ta="right" w={90}>
                      {t('entAccObjects')}
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {groups.map((g) => {
                    const expanded = open.has(g.type)
                    return [
                      <Table.Tr key={g.type} style={{ cursor: 'pointer' }} onClick={() => toggle(g.type)}>
                        <Table.Td>
                          <UnstyledButton aria-label={g.name} style={{ display: 'flex' }}>
                            {expanded ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
                          </UnstyledButton>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <Text size="sm">{g.name}</Text>
                            {/* A key with no wording of ours is worth seeing:
                                it is the signal to extend the dictionary. */}
                            {!g.translated && (
                              <Tooltip label={g.type} withArrow>
                                <Badge size="xs" variant="light" color="gray">
                                  ?
                                </Badge>
                              </Tooltip>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td ta="center" style={numericStyle}>
                          {stamp(g.first)}
                        </Table.Td>
                        <Table.Td ta="center" style={numericStyle}>
                          {stamp(g.last)}
                        </Table.Td>
                        <Table.Td ta="right" style={numericStyle}>
                          {formatDuration(g.duration, t)}
                        </Table.Td>
                        <Table.Td ta="right" style={numericStyle}>
                          {g.appearances}
                        </Table.Td>
                        <Table.Td ta="right" style={numericStyle}>
                          {g.devices}
                        </Table.Td>
                      </Table.Tr>,
                      expanded ? (
                        <Table.Tr key={`${g.type}-x`}>
                          <Table.Td colSpan={7} p={0} style={{ background: 'var(--hlv-surface-2)' }}>
                            <Table verticalSpacing={4} style={{ tableLayout: 'fixed' }}>
                              <Table.Tbody>
                                {g.objects.map((o) => (
                                  <Table.Tr key={`${o.enterprise_id}-${o.serNum}-${o.chNum}`}>
                                    <Table.Td w={34} />
                                    <Table.Td>
                                      <Text size="xs">{o.enterprise_name}</Text>
                                      <Text size="10px" c="dimmed" style={numericStyle}>
                                        № {o.serNum}
                                        {o.chNum ? ` · ${t('channelNumber')} ${o.chNum}` : ''}
                                      </Text>
                                    </Table.Td>
                                    <Table.Td ta="center" w={120} style={numericStyle}>
                                      <Text size="xs">{stamp(o.first)}</Text>
                                    </Table.Td>
                                    <Table.Td ta="center" w={120} style={numericStyle}>
                                      <Text size="xs">{stamp(o.last)}</Text>
                                    </Table.Td>
                                    <Table.Td ta="right" w={150} style={numericStyle}>
                                      <Text size="xs">{formatDuration(o.duration, t)}</Text>
                                    </Table.Td>
                                    <Table.Td ta="right" w={90} style={numericStyle}>
                                      <Text size="xs">{o.appearances}</Text>
                                    </Table.Td>
                                    <Table.Td w={90} />
                                  </Table.Tr>
                                ))}
                              </Table.Tbody>
                            </Table>
                          </Table.Td>
                        </Table.Tr>
                      ) : null,
                    ]
                  })}
                </Table.Tbody>
              </Table>
            </Paper>
          </Box>
        </ScrollArea>
      )}
    </>
  )
}
