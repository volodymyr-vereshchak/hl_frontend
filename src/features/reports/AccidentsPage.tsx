import { useMemo, useState } from 'react'
import {
  Paper,
  Table,
  Text,
  Badge,
  Group,
  Collapse,
  UnstyledButton,
  Box,
  ScrollArea,
  MultiSelect,
  SimpleGrid,
  Card,
} from '@mantine/core'
import { IconChevronRight, IconAlertTriangle, IconClockHour4, IconList } from '@tabler/icons-react'
import * as XLSX from 'xlsx'
import { sysArchiveApi } from '@/api/entities'
import { useLanguage } from '@/locales/LanguageContext'
import { useSelectionStore } from '@/store/selectionStore'
import { numericStyle } from '@/theme/theme'
import {
  pairAccidents,
  groupAccidentsByType,
  type AccidentGroup,
  type SysRecord,
} from '@/domain/accidentsCalculator'
import { PeriodPicker } from '@/features/archive/PeriodPicker'
import { ReportShell } from './ReportShell'
import { useBranchLines } from './useBranchLines'

const pad = (n: number) => String(n).padStart(2, '0')

function todayRange() {
  const now = new Date()
  const to = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const prev = new Date(now.getTime() - 7 * 864e5)
  const from = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(prev.getDate())}`
  return { from, to }
}

const fmtTime = (iso: string) => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return `${d.toLocaleDateString('uk-UA')} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function GroupRow({ group, lineNames }: { group: AccidentGroup; lineNames: Map<number, string> }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Table.Tr>
        <Table.Td>
          <UnstyledButton onClick={() => setOpen((o) => !o)} w="100%">
            <Group gap={6} wrap="nowrap">
              <IconChevronRight
                size={14}
                style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
              />
              <Text size="sm">{group.sys_name ?? `#${group.sys_type_id}`}</Text>
              {group.isStandalone && (
                <Badge size="xs" variant="light" color="steel">
                  сповіщення
                </Badge>
              )}
            </Group>
          </UnstyledButton>
        </Table.Td>
        <Table.Td ta="center" style={numericStyle}>
          {group.totalCount}
        </Table.Td>
        <Table.Td ta="center" style={numericStyle}>
          {group.totalDurationFormatted}
        </Table.Td>
        <Table.Td ta="center" style={numericStyle}>
          {group.totalVolume.toLocaleString('uk-UA', { maximumFractionDigits: 2 })}
        </Table.Td>
      </Table.Tr>
      {open && (
        <Table.Tr>
          <Table.Td colSpan={4} p={0}>
            <Collapse expanded={open}>
              <Box px="md" py="xs" style={{ background: 'var(--hlv-surface-2)' }}>
                <Table striped={false} verticalSpacing={4} fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Лінія</Table.Th>
                      <Table.Th ta="center">Початок</Table.Th>
                      <Table.Th ta="center">Кінець</Table.Th>
                      <Table.Th ta="center">Тривалість</Table.Th>
                      <Table.Th ta="center">Обʼєм</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {group.occurrences.map((o, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>{o.line_id ? (lineNames.get(o.line_id) ?? o.line_id) : '—'}</Table.Td>
                        <Table.Td ta="center" style={numericStyle}>
                          {fmtTime(o.startTime)}
                        </Table.Td>
                        <Table.Td ta="center" style={numericStyle}>
                          {o.type === 'standalone' ? '—' : fmtTime(o.endTime)}
                        </Table.Td>
                        <Table.Td ta="center" style={numericStyle}>
                          {o.duration}
                        </Table.Td>
                        <Table.Td ta="center" style={numericStyle}>
                          {o.volume.toLocaleString('uk-UA', { maximumFractionDigits: 2 })}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Box>
            </Collapse>
          </Table.Td>
        </Table.Tr>
      )}
    </>
  )
}

export function AccidentsPage() {
  const { t } = useLanguage()
  const { branchId } = useSelectionStore()
  const { data: lines } = useBranchLines(branchId)
  const initial = todayRange()
  const [from, setFrom] = useState(`${initial.from} 00:00:00`)
  const [to, setTo] = useState(`${initial.to} 23:00:00`)
  const [selectedLines, setSelectedLines] = useState<string[]>([])
  const [groups, setGroups] = useState<AccidentGroup[] | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Accidents live in the sys archive, so only physical lines apply. Default to
  // the report-flagged ones — a branch can hold 300+ lines and querying them all
  // is far too heavy; the picker still exposes every line.
  const physicalLines = useMemo(() => (lines ?? []).filter((l) => l.kind === 'physical'), [lines])
  const defaultLines = useMemo(() => {
    const flagged = physicalLines.filter((l) => l.include_in_report)
    return flagged.length > 0 ? flagged : physicalLines
  }, [physicalLines])
  const lineNames = useMemo(
    () => new Map((lines ?? []).map((l) => [l.id, l.name])),
    [lines],
  )

  const run = async () => {
    const ids = selectedLines.length ? selectedLines.map(Number) : defaultLines.map((l) => l.id)
    if (ids.length === 0) {
      setError('Немає ліній для аналізу')
      return
    }
    setRunning(true)
    setError(null)
    try {
      const rows = (await sysArchiveApi.getData(
        ids,
        from.replace(' ', 'T'),
        to.replace(' ', 'T'),
      )) as unknown as SysRecord[]
      const accidents = pairAccidents(rows, { fromDate: from, toDate: to })
      setGroups(groupAccidentsByType(accidents))
    } catch (e) {
      setError((e as Error).message)
      setGroups(null)
    } finally {
      setRunning(false)
    }
  }

  const exportExcel = () => {
    if (!groups) return
    const header = ['Тип аварії', 'Кількість', 'Загальна тривалість', 'Загальний обʼєм']
    const body = groups.map((g) => [
      g.sys_name ?? `#${g.sys_type_id}`,
      g.totalCount,
      g.totalDurationFormatted,
      g.totalVolume,
    ])
    const detail = [['Тип', 'Лінія', 'Початок', 'Кінець', 'Тривалість', 'Обʼєм']]
    groups.forEach((g) =>
      g.occurrences.forEach((o) =>
        detail.push([
          g.sys_name ?? `#${g.sys_type_id}`,
          String(o.line_id ? (lineNames.get(o.line_id) ?? o.line_id) : '—'),
          fmtTime(o.startTime),
          o.type === 'standalone' ? '—' : fmtTime(o.endTime),
          o.duration,
          String(o.volume),
        ]),
      ),
    )
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...body]), 'Зведення')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detail), 'Деталі')
    XLSX.writeFile(wb, `accidents_${from.slice(0, 10)}_${to.slice(0, 10)}.xlsx`)
  }

  const totals = useMemo(() => {
    if (!groups) return null
    return {
      types: groups.length,
      count: groups.reduce((s, g) => s + g.totalCount, 0),
      volume: groups.reduce((s, g) => s + g.totalVolume, 0),
    }
  }, [groups])

  return (
    <ReportShell
      title={t('accidentsReport')}
      description={t('accidentsDescription')}
      onRun={run}
      running={running}
      onExport={exportExcel}
      canExport={!!groups?.length}
      error={error}
      controls={
        <>
          <PeriodPicker
            withTime
            from={from}
            to={to}
            onChange={({ from: f, to: t2 }) => {
              setFrom(f)
              setTo(t2)
            }}
          />
          <MultiSelect
            placeholder={`Звітні лінії (${defaultLines.length})`}
            data={physicalLines.map((l) => ({ value: String(l.id), label: l.name }))}
            value={selectedLines}
            onChange={setSelectedLines}
            searchable
            clearable
            size="xs"
            w={280}
            maxDropdownHeight={280}
          />
        </>
      }
    >
      {totals && (
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Card padding="sm" radius="md">
            <Group gap="xs">
              <IconAlertTriangle size={16} color="var(--mantine-color-amber-5)" />
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                {t('totalAccidents')}
              </Text>
            </Group>
            <Text fz={24} fw={700} style={numericStyle}>
              {totals.count}
            </Text>
          </Card>
          <Card padding="sm" radius="md">
            <Group gap="xs">
              <IconList size={16} color="var(--mantine-color-petrol-5)" />
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                {t('accidentTypes')}
              </Text>
            </Group>
            <Text fz={24} fw={700} style={numericStyle}>
              {totals.types}
            </Text>
          </Card>
          <Card padding="sm" radius="md">
            <Group gap="xs">
              <IconClockHour4 size={16} color="var(--mantine-color-steel-5)" />
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                {t('totalVolume')}
              </Text>
            </Group>
            <Text fz={24} fw={700} style={numericStyle}>
              {totals.volume.toLocaleString('uk-UA', { maximumFractionDigits: 2 })}
            </Text>
          </Card>
        </SimpleGrid>
      )}

      {groups && groups.length > 0 && (
        <Paper withBorder radius="md">
          <ScrollArea.Autosize mah="calc(100dvh - 380px)" type="auto">
            <Table striped highlightOnHover stickyHeader verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('accidentType')}</Table.Th>
                  <Table.Th ta="center" w={140}>
                    {t('occurrenceCount')}
                  </Table.Th>
                  <Table.Th ta="center" w={180}>
                    {t('totalDuration')}
                  </Table.Th>
                  <Table.Th ta="center" w={160}>
                    {t('totalVolume')}
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {groups.map((g) => (
                  <GroupRow key={g.sys_type_id} group={g} lineNames={lineNames} />
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        </Paper>
      )}

      {groups && groups.length === 0 && (
        <Text c="dimmed" ta="center" py="xl">
          {t('noAccidentsFound')}
        </Text>
      )}
    </ReportShell>
  )
}
