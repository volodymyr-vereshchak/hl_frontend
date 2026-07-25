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
  Select,
  SimpleGrid,
  Card,
} from '@mantine/core'
import { IconChevronRight, IconAlertTriangle, IconList, IconGauge } from '@tabler/icons-react'
import * as XLSX from 'xlsx'
import { sysArchiveApi } from '@/api/entities'
import { useLanguage } from '@/locales/LanguageContext'
import { numericStyle } from '@/theme/theme'
import {
  pairAccidents,
  groupAccidentsByType,
  summarizeOccurrencesByLine,
  groupBounds,
  type AccidentGroup,
  type SysRecord,
} from '@/domain/accidentsCalculator'
import { PeriodPicker } from '@/features/archive/PeriodPicker'
import { ReportShell } from './ReportShell'
import { useTopologySelects } from './useTopologySelects'

const pad = (n: number) => String(n).padStart(2, '0')

function defaultRange() {
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

const fmtNum = (n: number) => n.toLocaleString('uk-UA', { maximumFractionDigits: 2 })

function GroupRow({ group, lineNames }: { group: AccidentGroup; lineNames: Map<number, string> }) {
  const [open, setOpen] = useState(false)
  const bounds = groupBounds(group)
  // Expanded view rolls occurrences up per line rather than listing each event.
  const perLine = useMemo(
    () => summarizeOccurrencesByLine(group.occurrences, group.isStandalone),
    [group],
  )

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
          {fmtTime(bounds.firstStart)}
        </Table.Td>
        <Table.Td ta="center" style={numericStyle}>
          {group.isStandalone ? '—' : fmtTime(bounds.lastEnd)}
        </Table.Td>
        <Table.Td ta="center" style={numericStyle}>
          {group.totalCount}
        </Table.Td>
        <Table.Td ta="center" style={numericStyle}>
          {group.totalDurationFormatted}
        </Table.Td>
        <Table.Td ta="center" style={numericStyle}>
          {fmtNum(group.totalVolume)}
        </Table.Td>
      </Table.Tr>
      {open && (
        <Table.Tr>
          <Table.Td colSpan={6} p={0}>
            <Collapse expanded={open}>
              <Box px="md" py="xs" style={{ background: 'var(--hlv-surface-2)' }}>
                <Table verticalSpacing={4} fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Лінія</Table.Th>
                      <Table.Th ta="center">Перша поява</Table.Th>
                      <Table.Th ta="center">Остання поява</Table.Th>
                      <Table.Th ta="center">Кількість</Table.Th>
                      <Table.Th ta="center">Тривалість</Table.Th>
                      <Table.Th ta="center">Обʼєм</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {perLine.map((l) => (
                      <Table.Tr key={l.line_id}>
                        <Table.Td>{lineNames.get(l.line_id) ?? `Лінія ${l.line_id}`}</Table.Td>
                        <Table.Td ta="center" style={numericStyle}>
                          {fmtTime(l.firstStart)}
                        </Table.Td>
                        <Table.Td ta="center" style={numericStyle}>
                          {group.isStandalone ? '—' : fmtTime(l.lastEnd)}
                        </Table.Td>
                        <Table.Td ta="center" style={numericStyle}>
                          {l.count}
                        </Table.Td>
                        <Table.Td ta="center" style={numericStyle}>
                          {l.durationFormatted}
                        </Table.Td>
                        <Table.Td ta="center" style={numericStyle}>
                          {fmtNum(l.volume)}
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
  const [branchId, setBranchId] = useState('')
  const [calcId, setCalcId] = useState('')
  const [lineId, setLineId] = useState('')
  const { branches, calcs, lines, allLines } = useTopologySelects(branchId, calcId)

  const initial = defaultRange()
  const [from, setFrom] = useState(`${initial.from} 00:00:00`)
  const [to, setTo] = useState(`${initial.to} 23:00:00`)
  const [groups, setGroups] = useState<AccidentGroup[] | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lineNames = useMemo(() => new Map(allLines.map((l) => [l.id, l.name])), [allLines])

  const run = async () => {
    const ids = lineId ? [Number(lineId)] : lines.map((l) => l.id)
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
    const summary = [['Тип аварії', 'Перша поява', 'Остання поява', 'Кількість', 'Тривалість', 'Обʼєм']]
    const perLine = [
      ['Тип аварії', 'Лінія', 'Перша поява', 'Остання поява', 'Кількість', 'Тривалість', 'Обʼєм'],
    ]
    for (const g of groups) {
      const b = groupBounds(g)
      const name = g.sys_name ?? `#${g.sys_type_id}`
      summary.push([
        name,
        fmtTime(b.firstStart),
        g.isStandalone ? '—' : fmtTime(b.lastEnd),
        String(g.totalCount),
        g.totalDurationFormatted,
        String(g.totalVolume),
      ])
      for (const l of summarizeOccurrencesByLine(g.occurrences, g.isStandalone)) {
        perLine.push([
          name,
          lineNames.get(l.line_id) ?? `Лінія ${l.line_id}`,
          fmtTime(l.firstStart),
          g.isStandalone ? '—' : fmtTime(l.lastEnd),
          String(l.count),
          l.durationFormatted,
          String(l.volume),
        ])
      }
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Зведення')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(perLine), 'По лініях')
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
      withBranchPicker={false}
      controls={
        <>
          {/* Cascading scope: branch → calc → line, each with an "all" option. */}
          <Select
            placeholder="Всі філії"
            data={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            value={branchId || null}
            onChange={(v) => {
              setBranchId(v ?? '')
              setCalcId('')
              setLineId('')
            }}
            clearable
            searchable
            size="xs"
            w={210}
          />
          <Select
            placeholder="Всі обчислювачі"
            data={calcs.map((c) => ({ value: String(c.id), label: c.name }))}
            value={calcId || null}
            onChange={(v) => {
              setCalcId(v ?? '')
              setLineId('')
            }}
            clearable
            searchable
            size="xs"
            w={230}
          />
          <Select
            placeholder={`Всі лінії (${lines.length})`}
            data={lines.map((l) => ({ value: String(l.id), label: l.name }))}
            value={lineId || null}
            onChange={(v) => setLineId(v ?? '')}
            clearable
            searchable
            size="xs"
            w={210}
          />
          <PeriodPicker
            withTime
            from={from}
            to={to}
            onChange={({ from: f, to: t2 }) => {
              setFrom(f)
              setTo(t2)
            }}
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
              <IconGauge size={16} color="var(--mantine-color-steel-5)" />
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                {t('totalVolume')}
              </Text>
            </Group>
            <Text fz={24} fw={700} style={numericStyle}>
              {fmtNum(totals.volume)}
            </Text>
          </Card>
        </SimpleGrid>
      )}

      {groups && groups.length > 0 && (
        /* Height follows the content; the page scrolls, not the table. */
        <Paper withBorder radius="md">
          <Table striped highlightOnHover verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('accidentType')}</Table.Th>
                <Table.Th ta="center" w={170}>
                  {t('startTime')}
                </Table.Th>
                <Table.Th ta="center" w={170}>
                  {t('endTime')}
                </Table.Th>
                <Table.Th ta="center" w={120}>
                  {t('occurrenceCount')}
                </Table.Th>
                <Table.Th ta="center" w={150}>
                  {t('totalDuration')}
                </Table.Th>
                <Table.Th ta="center" w={150}>
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
