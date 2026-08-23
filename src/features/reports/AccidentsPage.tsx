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
  Stack,
} from '@mantine/core'
import { IconChevronRight, IconAlertTriangle, IconList, IconGauge } from '@tabler/icons-react'
import * as XLSX from 'xlsx'
import { sysArchiveApi, archiveDataApi } from '@/api/entities'
import { useLanguage } from '@/locales/LanguageContext'
import { numericStyle } from '@/theme/theme'
import {
  pairAccidents,
  groupAccidentsByBranch,
  summarizeOccurrencesByLine,
  groupBounds,
  type AccidentGroup,
  type BranchAccidentGroup,
  type SysRecord,
  type DailyVolumeLookup,
} from '@/domain/accidentsCalculator'
import { getContractHour, addDays } from '@/domain/commercialDay'
import { PeriodPicker } from '@/features/archive/PeriodPicker'
import { ReportShell } from './ReportShell'
import { useTopologySelects } from './useTopologySelects'

const pad = (n: number) => String(n).padStart(2, '0')

/** Timestamp cell: monospaced digits, never wrapped onto a second line. */
const stampStyle = { ...numericStyle, whiteSpace: 'nowrap' as const }

/** Reports open on the current month: 1st → today. */
function defaultRange() {
  const now = new Date()
  const y = now.getFullYear()
  const m = pad(now.getMonth() + 1)
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${pad(now.getDate())}` }
}

/**
 * Timestamp on ONE line, seconds included — they matter for accidents. The row
 * is kept short by the two-digit year and by never wrapping (see stampStyle),
 * not by dropping precision.
 */
const fmtTime = (iso: string) => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const date = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const fmtNum = (n: number) => n.toLocaleString('uk-UA', { maximumFractionDigits: 2 })

/**
 * Where a line sits in the topology.
 *
 * The archive knows only `line_id`, but an accident is only actionable once you
 * know whose line it is — so branch, LUMG and calculator are resolved once, up
 * front, and carried through both the grouping and the expanded rows.
 */
export interface LineMeta {
  lineName: string
  calcName: string
  branchId: number | null
}

export type LineMetaMap = Map<number, LineMeta>

const UNKNOWN: LineMeta = { lineName: '', calcName: '—', branchId: null }

const metaOf = (meta: LineMetaMap, lineId: number): LineMeta =>
  meta.get(lineId) ?? { ...UNKNOWN, lineName: `Лінія ${lineId}` }

function GroupRow({
  group,
  lineMeta,
  dailyVolume,
}: {
  group: AccidentGroup
  lineMeta: LineMetaMap
  dailyVolume: DailyVolumeLookup
}) {
  const [open, setOpen] = useState(false)
  const bounds = groupBounds(group)
  // Expanded view rolls occurrences up per line rather than listing each event.
  // The same daily lookup is used as for the totals, so the rows add up.
  const perLine = useMemo(
    () => summarizeOccurrencesByLine(group.occurrences, group.isStandalone, dailyVolume),
    [group, dailyVolume],
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
        <Table.Td ta="center" style={stampStyle} title={bounds.firstStart}>
          {fmtTime(bounds.firstStart)}
        </Table.Td>
        <Table.Td ta="center" style={stampStyle} title={bounds.lastEnd}>
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
                      <Table.Th>Обчислювач</Table.Th>
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
                        <Table.Td>{metaOf(lineMeta, l.line_id).calcName}</Table.Td>
                        <Table.Td>{metaOf(lineMeta, l.line_id).lineName}</Table.Td>
                        <Table.Td ta="center" style={stampStyle} title={l.firstStart}>
                          {fmtTime(l.firstStart)}
                        </Table.Td>
                        <Table.Td ta="center" style={stampStyle} title={l.lastEnd}>
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

/** The by-type table: the accidents of one branch, or of the whole report. */
function AccidentTable({
  groups,
  lineMeta,
  dailyVolume,
}: {
  groups: AccidentGroup[]
  lineMeta: LineMetaMap
  dailyVolume: DailyVolumeLookup
}) {
  const { t } = useLanguage()
  return (
    /* Height follows the content; the page scrolls, not the table. */
    <Table striped highlightOnHover verticalSpacing={4} fz="sm">
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
          <GroupRow key={g.sys_type_id} group={g} lineMeta={lineMeta} dailyVolume={dailyVolume} />
        ))}
      </Table.Tbody>
    </Table>
  )
}

/**
 * One branch, holding its own by-type table — the outer level of the report
 * whenever it was run for all branches (as on the overview, where LUMG is the
 * outer level). It appears even if only one branch turned out to have
 * accidents: that is a result worth naming, not a reason to hide the heading.
 * Picking a branch in the selector removes the level — the name is right there
 * in the selector, so on every section it would only cost a click.
 */
function BranchSection({
  branch,
  branchName,
  lineMeta,
  dailyVolume,
}: {
  branch: BranchAccidentGroup
  branchName: string
  lineMeta: LineMetaMap
  dailyVolume: DailyVolumeLookup
}) {
  const [open, setOpen] = useState(true)
  return (
    <Paper withBorder radius="md">
      <UnstyledButton onClick={() => setOpen((o) => !o)} p="sm" w="100%">
        <Group gap="xs">
          <IconChevronRight
            size={16}
            style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
          />
          <Text fw={600} fz="lg" ff="'Space Grotesk Variable', sans-serif">
            {branchName}
          </Text>
          <Badge variant="light" color="amber" size="sm">
            {branch.totalCount}
          </Badge>
          <Badge variant="light" color="steel" size="sm" style={numericStyle}>
            {fmtNum(branch.totalVolume)}
          </Badge>
        </Group>
      </UnstyledButton>
      <Collapse expanded={open}>
        <AccidentTable groups={branch.groups} lineMeta={lineMeta} dailyVolume={dailyVolume} />
      </Collapse>
    </Paper>
  )
}

export function AccidentsPage() {
  const { t } = useLanguage()
  const [branchId, setBranchId] = useState('')
  const [calcId, setCalcId] = useState('')
  const [lineId, setLineId] = useState('')
  const { branches, lumgs, calcs, lines, allCalcs, allLines } = useTopologySelects(branchId, calcId)

  // Calendar dates only — the 07:00 contract-day window is derived in run().
  const initial = defaultRange()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [branchGroups, setBranchGroups] = useState<BranchAccidentGroup[] | null>(null)
  // Whether the RUN that produced these results spanned every branch. Captured
  // at run time, not read from the selector: changing the selector afterwards
  // must not relabel results that were computed for something else.
  const [sectioned, setSectioned] = useState(false)
  const [unionVolume, setUnionVolume] = useState(0)
  // Kept so the expandable rows use the same daily totals as the summary.
  const [dailyLookup, setDailyLookup] = useState<DailyVolumeLookup>(() => () => undefined)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // line → (branch, calculator). Built from the whole topology, not the
  // filtered selectors: a report run for «всі філії» shows lines from all of them.
  // The LUMG is only walked through to reach the branch — it is not shown,
  // since a line is named within its calculator anyway.
  const lineMeta = useMemo<LineMetaMap>(() => {
    const lumgById = new Map(lumgs.map((l) => [l.id, l]))
    const calcById = new Map(allCalcs.map((c) => [c.id, c]))
    const map: LineMetaMap = new Map()
    for (const line of allLines) {
      const calc = line.gas_volume_calc_id != null ? calcById.get(line.gas_volume_calc_id) : undefined
      // `line.lumg_id` is the fallback: DPD and virtual lines hang off a LUMG
      // directly, without a calculator.
      const lumgId = calc?.lumg_id ?? line.lumg_id ?? null
      const lumg = lumgId != null ? lumgById.get(lumgId) : undefined
      map.set(line.id, {
        lineName: line.name,
        calcName: calc?.name ?? '—',
        branchId: lumg?.branch_id ?? null,
      })
    }
    return map
  }, [allLines, allCalcs, lumgs])

  const branchNames = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])
  const branchLabel = (id: number | null) =>
    (id != null ? branchNames.get(id) : undefined) ?? 'Поза філіями'

  const run = async () => {
    const ids = lineId ? [Number(lineId)] : lines.map((l) => l.id)
    if (ids.length === 0) {
      setError('Немає ліній для аналізу')
      return
    }
    setRunning(true)
    setError(null)
    try {
      // Accidents belong to the COMMERCIAL day (07:00 → 07:00), so the selected
      // calendar range maps to the half-open interval
      //   [from CONTRACT_HOUR:00 , (to + 1 day) CONTRACT_HOUR:00)
      // Built as naive local datetimes: a bare "YYYY-MM-DD" parses as UTC
      // midnight and shifts the hour in UTC+ zones.
      const h = String(getContractHour()).padStart(2, '0')
      const contractFrom = `${from}T${h}:00:00`
      const contractEnd = `${addDays(to, 1)}T${h}:00:00`

      // The daily archive supplies each commercial day's total, needed to close
      // accidents that are still open when the period (or a day) ends.
      const [raw, daily] = await Promise.all([
        sysArchiveApi.getData(ids, contractFrom, contractEnd) as unknown as Promise<SysRecord[]>,
        archiveDataApi.getDailyData(ids, from, to).catch(() => []),
      ])
      const dailyByLineDay = new Map<string, number>()
      for (const row of daily) {
        const day = String(row.period).slice(0, 10)
        dailyByLineDay.set(`${row.line_id}_${day}`, Number(row.volume) || 0)
      }
      const dailyVolume: DailyVolumeLookup = (lineId, day) =>
        dailyByLineDay.get(`${lineId}_${day}`)
      setDailyLookup(() => dailyVolume)

      // The backend filters period <= to_date, but the contract day ends at
      // 07:00 EXCLUSIVE — an event at exactly 07:00 belongs to the next day.
      const endMs = new Date(contractEnd).getTime()
      const rows = (raw ?? []).filter((r) => new Date(r.period).getTime() < endMs)

      // Contract bounds are passed on so accidents missing their start/end
      // record snap to 07:00 rather than calendar midnight.
      const accidents = pairAccidents(rows, { fromDate: contractFrom, toDate: contractEnd })
      // With a branch picked in the selector everything belongs to it by
      // construction, so the whole report collapses into that one bucket and
      // is rendered without a header — the name is already in the selector.
      const chosen = branchId ? Number(branchId) : null
      const byBranch = groupAccidentsByBranch(
        accidents,
        chosen != null ? () => chosen : (id) => (id != null ? (lineMeta.get(id)?.branchId ?? null) : null),
        dailyVolume,
      )
      setBranchGroups(byBranch)
      setSectioned(chosen == null)

      // Overall volume is the union across ALL types per line: alarms of
      // different types overlap in time, so summing their volumes would count
      // the same gas twice and could exceed what the line actually passed. A
      // line belongs to one branch, so summing the branch unions is exact.
      setUnionVolume(byBranch.reduce((s, b) => s + b.totalVolume, 0))
    } catch (e) {
      setError((e as Error).message)
      setBranchGroups(null)
    } finally {
      setRunning(false)
    }
  }

  const exportExcel = () => {
    if (!branchGroups) return
    // The sheets are flat, so the branch that the UI shows as a section header
    // becomes a column on every row.
    const summary = [
      ['Філія', 'Тип аварії', 'Перша поява', 'Остання поява', 'Кількість', 'Тривалість', 'Обʼєм'],
    ]
    const perLine = [
      [
        'Філія',
        'Тип аварії',
        'Обчислювач',
        'Лінія',
        'Перша поява',
        'Остання поява',
        'Кількість',
        'Тривалість',
        'Обʼєм',
      ],
    ]
    for (const branch of branchGroups) {
      const branchName = branchLabel(branch.branchId)
      for (const g of branch.groups) {
        const b = groupBounds(g)
        const name = g.sys_name ?? `#${g.sys_type_id}`
        summary.push([
          branchName,
          name,
          fmtTime(b.firstStart),
          g.isStandalone ? '—' : fmtTime(b.lastEnd),
          String(g.totalCount),
          g.totalDurationFormatted,
          String(g.totalVolume),
        ])
        for (const l of summarizeOccurrencesByLine(g.occurrences, g.isStandalone, dailyLookup)) {
          const meta = metaOf(lineMeta, l.line_id)
          perLine.push([
            branchName,
            name,
            meta.calcName,
            meta.lineName,
            fmtTime(l.firstStart),
            g.isStandalone ? '—' : fmtTime(l.lastEnd),
            String(l.count),
            l.durationFormatted,
            String(l.volume),
          ])
        }
      }
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Зведення')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(perLine), 'По лініях')
    XLSX.writeFile(wb, `accidents_${from}_${to}.xlsx`)
  }

  const totals = useMemo(() => {
    if (!branchGroups) return null
    // One event type can fire in several branches; the card counts types, not
    // branch-type pairs.
    const types = new Set<number>()
    let count = 0
    for (const branch of branchGroups) {
      count += branch.totalCount
      for (const g of branch.groups) types.add(g.sys_type_id)
    }
    return { types: types.size, count, volume: unionVolume }
  }, [branchGroups, unionVolume])

  return (
    <ReportShell
      title={t('accidentsReport')}
      description={t('accidentsDescription')}
      onRun={run}
      running={running}
      onExport={exportExcel}
      canExport={!!branchGroups?.length}
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
            withTime={false}
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

      {branchGroups && branchGroups.length > 0 && !sectioned && (
        <Paper withBorder radius="md">
          <AccidentTable
            groups={branchGroups[0].groups}
            lineMeta={lineMeta}
            dailyVolume={dailyLookup}
          />
        </Paper>
      )}

      {branchGroups && branchGroups.length > 0 && sectioned && (
        <Stack gap="md">
          {branchGroups.map((b) => (
            <BranchSection
              key={b.branchId ?? 'unknown'}
              branch={b}
              branchName={branchLabel(b.branchId)}
              lineMeta={lineMeta}
              dailyVolume={dailyLookup}
            />
          ))}
        </Stack>
      )}

      {branchGroups && branchGroups.length === 0 && (
        <Text c="dimmed" ta="center" py="xl">
          {t('noAccidentsFound')}
        </Text>
      )}
    </ReportShell>
  )
}
