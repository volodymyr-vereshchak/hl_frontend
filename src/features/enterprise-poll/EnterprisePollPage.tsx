import { startTransition, useMemo, useRef, useState } from 'react'
import {
  Stack,
  Group,
  Title,
  Select,
  SegmentedControl,
  Button,
  Paper,
  Text,
  Table,
  Alert,
  Badge,
  Collapse,
  UnstyledButton,
  Box,
  ScrollArea,
  TextInput,
  Loader,
  Center,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import {
  IconAlertTriangle,
  IconBuildingCommunity,
  IconCalendar,
  IconChevronRight,
  IconRipple,
  IconFileSpreadsheet,
  IconPlayerPlay,
  IconSearch,
  IconPlayerStop,
} from '@tabler/icons-react'
import { useLocalStorage } from '@mantine/hooks'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { branchAdminApi, dpdLineAdminApi, lineAdminApi } from '@/api/admin'
import {
  enterpriseApi,
  enterpriseLabel,
  streamEnterpriseVolumes,
  type EnterpriseMappingRow,
  type EnterpriseRecord,
} from '@/api/enterprise'
import { PollProgress } from '@/components/PollProgress'
import { enterpriseRecordTotal } from '@/domain/enterpriseVolumes'
import { useLanguage } from '@/locales/LanguageContext'
import { useSelectionStore } from '@/store/selectionStore'
import { numericStyle } from '@/theme/theme'
import { ArchiveChart } from '@/features/archive/ArchiveChart'
import type { ArchiveRow } from '@/api/entities'

type PeriodType = 'daily' | 'hourly'

interface PollRow {
  period: string
  volume: number
  temperature: number | null
  pressure: number | null
  pressureUnit: string | null
}

/** Same split height as the archives, so the two screens line up. */
const SPLIT_HEIGHT = 'calc(100dvh - 150px)'

const NO_BRANCH = '__no_branch__'
const NO_LINE = '__no_line__'

/** Numeric cell: '—' when there is nothing to show. */
const fmtNum = (v: number | null | undefined, digits = 2) =>
  v == null || isNaN(v) ? '—' : v.toLocaleString('uk-UA', { maximumFractionDigits: digits })

const pad = (n: number) => String(n).padStart(2, '0')

/** Opens on the current month: 1st -> today, like the reports. */
function defaultRange() {
  const now = new Date()
  const y = now.getFullYear()
  const m = pad(now.getMonth() + 1)
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${pad(now.getDate())}` }
}

/**
 * Enterprise poll: pick a branch + enterprise (device) and pull its volumes
 * from the DPD API over the NDJSON progress stream (polls can run minutes).
 */
export function EnterprisePollPage() {
  const { t } = useLanguage()
  const { branchId, setBranchId } = useSelectionStore()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  // Collapsed groups survive reloads; the tree is long and reopening it every
  // time would be busywork.
  const [view, setView] = useLocalStorage<'table' | 'chart'>({
    key: 'hlv-poll-view',
    defaultValue: 'table',
  })
  const [collapsed, setCollapsed] = useLocalStorage<Record<string, boolean>>({
    key: 'hlv-poll-collapsed',
    defaultValue: {},
  })
  const toggleGroup = (key: string) => setCollapsed((p) => ({ ...p, [key]: !p[key] }))
  const [periodType, setPeriodType] = useState<PeriodType>('daily')
  const initialRange = defaultRange()
  const [from, setFrom] = useState(initialRange.from)
  const [to, setTo] = useState(initialRange.to)
  const [records, setRecords] = useState<EnterpriseRecord[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<{ done?: number; total?: number; phase?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { data: branches } = useQuery({ queryKey: ['admin', 'branches'], queryFn: branchAdminApi.getAll })
  const { data: mappings, isLoading: mappingsLoading } = useQuery({
    queryKey: ['enterprise', 'mappings'],
    queryFn: enterpriseApi.getMappings,
    staleTime: 5 * 60_000,
  })

  // Line names for the list: an enterprise points at either a physical line or
  // a DPD line, and knowing which one it feeds is the whole point of the list.
  const { data: lines } = useQuery({
    queryKey: ['admin', 'lines'],
    queryFn: () => lineAdminApi.getAll(),
    staleTime: 5 * 60_000,
  })
  const { data: dpdLines } = useQuery({
    queryKey: ['admin', 'dpd-lines'],
    queryFn: () => dpdLineAdminApi.getAll().catch(() => []),
    staleTime: 5 * 60_000,
  })

  const lineNameById = useMemo(() => {
    const m = new Map<number, string>()
    ;(lines ?? []).forEach((l) => m.set(l.id, l.name))
    ;(dpdLines ?? []).forEach((d) => m.set(d.id, `[ДПД] ${d.name}`))
    return (id: number) => m.get(id) ?? null
  }, [lines, dpdLines])

  const lineLabel = useMemo(
    () => (row: EnterpriseMappingRow) => {
      const id = row.line_id ?? row.dpd_line_id
      return id != null ? (lineNameById(id) ?? `#${id}`) : null
    },
    [lineNameById],
  )

  const list = useMemo(() => {
    const all = mappings ?? []
    const q = search.trim().toLowerCase()
    return all
      .filter((m) => !branchId || m.branch_id === branchId)
      .filter((m) => {
        if (!q) return true
        return (
          enterpriseLabel(m).toLowerCase().includes(q) ||
          String(m.ser_num ?? '').includes(q) ||
          (lineLabel(m) ?? '').toLowerCase().includes(q)
        )
      })
  }, [mappings, branchId, search, lineLabel])

  /**
   * Branch → line → enterprises, the same shape as the old poll screen. A flat
   * list of a few hundred devices is unreadable; grouping by the line they sit
   * behind is what makes an enterprise findable.
   */
  const tree = useMemo(() => {
    const byBranch = new Map<string, Map<string, EnterpriseMappingRow[]>>()
    for (const m of list) {
      const bKey = m.branch_id != null ? String(m.branch_id) : NO_BRANCH
      const lKey = (m.line_id ?? m.dpd_line_id) != null ? String(m.line_id ?? m.dpd_line_id) : NO_LINE
      if (!byBranch.has(bKey)) byBranch.set(bKey, new Map())
      const lines = byBranch.get(bKey)!
      if (!lines.has(lKey)) lines.set(lKey, [])
      lines.get(lKey)!.push(m)
    }
    const branchOrder = (branches ?? []).map((b) => String(b.id))
    const sortKey = (k: string, order: string[]) => (k === NO_BRANCH || k === NO_LINE ? 1e9 : order.indexOf(k))
    return [...byBranch.entries()]
      .sort((a, b) => sortKey(a[0], branchOrder) - sortKey(b[0], branchOrder))
      .map(([bKey, lines]) => ({
        key: bKey,
        name:
          bKey === NO_BRANCH
            ? 'Без філії'
            : ((branches ?? []).find((b) => String(b.id) === bKey)?.name ?? `Філія ${bKey}`),
        count: [...lines.values()].reduce((n, arr) => n + arr.length, 0),
        lines: [...lines.entries()]
          .sort((a, b) => (a[0] === NO_LINE ? 1 : b[0] === NO_LINE ? -1 : Number(a[0]) - Number(b[0])))
          .map(([lKey, items]) => ({
            key: lKey,
            name: lKey === NO_LINE ? 'Без лінії' : (lineNameById(Number(lKey)) ?? `Лінія ${lKey}`),
            items,
          })),
      }))
  }, [list, branches, lineNameById])

  const selectedMapping = list.find((m) => m.id === selected) ?? null

  const run = async () => {
    if (!selectedMapping) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    setProgress(null)
    setRecords(null)
    try {
      const res = await streamEnterpriseVolumes(
        {
          from_date: from,
          to_date: to,
          period_type: periodType,
          serNum: selectedMapping.ser_num ?? undefined,
          mfDev: selectedMapping.mf_dev ?? undefined,
          typeDev: selectedMapping.type_dev ?? undefined,
          chNum: selectedMapping.ch_num ?? undefined,
          line_id: (() => {
            const id = selectedMapping.line_id ?? selectedMapping.dpd_line_id
            return id != null ? [id] : undefined
          })(),
        },
        { onProgress: setProgress, signal: ctrl.signal },
      )
      setRecords(res)
    } catch (e) {
      const err = e as Error
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const stop = () => {
    abortRef.current?.abort()
    setLoading(false)
  }

  /**
   * Temperature, pressure and its unit live on the DEVICE, not on the record:
   * the record only carries the period and the rolled-up volume. Reading them
   * off the record left both columns permanently empty.
   */
  const rows: PollRow[] = useMemo(
    () =>
      (records ?? [])
        .map((r) => {
          const device = r.devices?.[0]
          return {
            period: String(r.period),
            volume: enterpriseRecordTotal(r),
            temperature: device?.temperature ?? null,
            pressure: device?.pressure ?? null,
            pressureUnit: device?.pressure_unit ?? null,
          }
        })
        .sort((a, b) => a.period.localeCompare(b.period)),
    [records],
  )

  // One unit for the whole poll (same device) — take the first the API gave us.
  // Older records may carry none; those meters report in кгс/см².
  const pressureUnit = useMemo(
    () => rows.find((r) => r.pressureUnit)?.pressureUnit ?? 'кгс/см²',
    [rows],
  )

  /** Volume sums; temperature and pressure average, like the archive footer. */
  const totals = useMemo(() => {
    const avg = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null)
    return {
      volume: rows.reduce((sum, r) => sum + (Number(r.volume) || 0), 0),
      temperature: avg(rows.map((r) => r.temperature).filter((v): v is number => v != null)),
      pressure: avg(rows.map((r) => r.pressure).filter((v): v is number => v != null)),
    }
  }, [rows])

  const exportExcel = () => {
    if (!rows.length) return
    const header = ['Період', 'Обʼєм, м³', 'Температура, °C', `Тиск, ${pressureUnit}`]
    const body = rows.map((r) => [r.period, r.volume, r.temperature ?? '', r.pressure ?? ''])
    body.push(['Разом', totals.volume, totals.temperature ?? '', totals.pressure ?? ''])
    const ws = XLSX.utils.aoa_to_sheet([header, ...body])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Підприємство')
    XLSX.writeFile(wb, `enterprise_${selectedMapping?.ser_num ?? 'poll'}_${from}_${to}.xlsx`)
  }

  return (
    <Stack gap="sm">
      {/* Same shape as the archives: one toolbar line, then tree + pane filling
          the screen. */}
      <Group gap="md" wrap="nowrap" align="center">
        <Title order={4} style={{ whiteSpace: 'nowrap' }}>
          {t('enterprisePoll')}
        </Title>
        <SegmentedControl
          size="xs"
          value={periodType}
          onChange={(v) => setPeriodType(v as PeriodType)}
          data={[
            { value: 'daily', label: t('daily') },
            { value: 'hourly', label: t('hourly') },
          ]}
        />
        <DatePickerInput
          aria-label={t('from')}
          leftSection={<IconCalendar size={15} />}
          value={from}
          onChange={(v) => v && setFrom(v)}
          valueFormat="DD.MM.YYYY"
          size="xs"
          w={140}
          popoverProps={{ zIndex: 500, withinPortal: true }}
        />
        <DatePickerInput
          aria-label={t('to')}
          leftSection={<IconCalendar size={15} />}
          value={to}
          onChange={(v) => v && setTo(v)}
          valueFormat="DD.MM.YYYY"
          size="xs"
          w={140}
          popoverProps={{ zIndex: 500, withinPortal: true }}
        />
        {loading ? (
          <Button
            size="xs"
            color="red"
            variant="light"
            leftSection={<IconPlayerStop size={15} />}
            onClick={stop}
          >
            Зупинити
          </Button>
        ) : (
          <Button
            size="xs"
            leftSection={<IconPlayerPlay size={15} />}
            onClick={run}
            disabled={!selectedMapping}
          >
            Опитати
          </Button>
        )}
        <Select
          placeholder="Всі філії"
          data={(branches ?? []).map((b) => ({ value: String(b.id), label: b.name }))}
          value={branchId != null ? String(branchId) : null}
          onChange={(v) => setBranchId(v ? Number(v) : null)}
          clearable
          searchable
          size="xs"
          w={220}
        />
        <Button
          size="xs"
          variant="light"
          color="teal"
          leftSection={<IconFileSpreadsheet size={15} />}
          onClick={exportExcel}
          disabled={!rows.length}
          ml="auto"
          style={{ flexShrink: 0 }}
        >
          {t('excel')}
        </Button>
      </Group>

      <Box style={{ display: 'flex', gap: 'var(--mantine-spacing-md)', height: SPLIT_HEIGHT, minHeight: 360 }}>
        <Paper
          withBorder
          radius="md"
          style={{ width: 420, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          <Box p="sm" pb={4}>
            <TextInput
              placeholder={t('searchEnterprise')}
              leftSection={<IconSearch size={15} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              size="xs"
            />
          </Box>
          <ScrollArea className="hlv-table-scroll" style={{ flex: 1 }} type="hover">
            {mappingsLoading ? (
              <Center py={40}>
                <Loader size="sm" color="petrol" />
              </Center>
            ) : (
              <Stack gap={2} p="xs">
                {tree.map((branch) => {
                  // While searching, every group is forced open: a hit hidden
                  // inside a collapsed branch reads as "nothing found".
                  const bOpen = !!search.trim() || !collapsed[branch.key]
                  return (
                    <Box key={branch.key}>
                      <UnstyledButton
                        onClick={() => toggleGroup(branch.key)}
                        px={6}
                        py={5}
                        w="100%"
                        style={{ borderRadius: 6 }}
                        className="hlv-picker-row"
                      >
                        <Group gap={6} wrap="nowrap">
                          <IconChevronRight
                            size={13}
                            style={{
                              transform: bOpen ? 'rotate(90deg)' : 'none',
                              transition: 'transform 150ms',
                              flexShrink: 0,
                            }}
                          />
                          <IconBuildingCommunity size={13} color="var(--mantine-color-petrol-5)" />
                          <Text size="xs" fw={600} lineClamp={1} style={{ flex: 1 }}>
                            {branch.name}
                          </Text>
                          <Badge size="xs" variant="default">
                            {branch.count}
                          </Badge>
                        </Group>
                      </UnstyledButton>

                      <Collapse expanded={bOpen}>
                        {branch.lines.map((line) => {
                          const lKey = `${branch.key}/${line.key}`
                          const lOpen = !!search.trim() || !collapsed[lKey]
                          return (
                            <Box key={lKey}>
                              <UnstyledButton
                                onClick={() => toggleGroup(lKey)}
                                pl={20}
                                pr={6}
                                py={4}
                                w="100%"
                                style={{ borderRadius: 6 }}
                                className="hlv-picker-row"
                              >
                                <Group gap={6} wrap="nowrap">
                                  <IconChevronRight
                                    size={12}
                                    style={{
                                      transform: lOpen ? 'rotate(90deg)' : 'none',
                                      transition: 'transform 150ms',
                                      flexShrink: 0,
                                    }}
                                  />
                                  <IconRipple size={12} color="var(--mantine-color-steel-6)" />
                                  <Text
                                    size="11px"
                                    c={line.key === NO_LINE ? 'amber.6' : undefined}
                                    lineClamp={1}
                                    style={{ flex: 1 }}
                                    title={line.name}
                                  >
                                    {line.name}
                                  </Text>
                                  <Text size="10px" c="dimmed">
                                    {line.items.length}
                                  </Text>
                                </Group>
                              </UnstyledButton>

                              <Collapse expanded={lOpen}>
                                {line.items.map((m) => {
                                  const on = selected === m.id
                                  return (
                                    <UnstyledButton
                                      key={m.id}
                                      onClick={() => setSelected(m.id)}
                                      pl={38}
                                      pr={6}
                                      py={4}
                                      w="100%"
                                      style={{
                                        borderRadius: 6,
                                        background: on
                                          ? 'var(--mantine-color-petrol-light)'
                                          : undefined,
                                      }}
                                      className={on ? undefined : 'hlv-picker-row'}
                                    >
                                      <Group gap={6} wrap="nowrap">
                                        <Text
                                          size="xs"
                                          fw={on ? 600 : 400}
                                          c={on ? 'petrol' : undefined}
                                          lineClamp={1}
                                          style={{ flex: 1 }}
                                          title={enterpriseLabel(m)}
                                        >
                                          {enterpriseLabel(m)}
                                        </Text>
                                        {m.ser_num != null && (
                                          <Text size="10px" c="dimmed" style={numericStyle}>
                                            {m.ser_num}
                                          </Text>
                                        )}
                                      </Group>
                                    </UnstyledButton>
                                  )
                                })}
                              </Collapse>
                            </Box>
                          )
                        })}
                      </Collapse>
                    </Box>
                  )
                })}
                {list.length === 0 && (
                  <Text size="xs" c="dimmed" ta="center" py="md" px="xs">
                    {(mappings ?? []).length === 0
                      ? 'Підприємства не налаштовані — додайте їх в Адмініструванні → Підприємства'
                      : t('noData')}
                  </Text>
                )}
              </Stack>
            )}
          </ScrollArea>
        </Paper>

        <Paper
          withBorder
          radius="md"
          style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          {/* Header of the pane: what was polled, plus the table/chart switch. */}
          <Group
            px="sm"
            py={6}
            gap="sm"
            wrap="wrap"
            style={{ borderBottom: '1px solid var(--hlv-border)', flexShrink: 0 }}
          >
            {rows.length > 0 && (
              <SegmentedControl
                size="xs"
                value={view}
                onChange={(v) => startTransition(() => setView(v as 'table' | 'chart'))}
                data={[
                  { value: 'table', label: t('table') },
                  { value: 'chart', label: t('chart') },
                ]}
              />
            )}
            {selectedMapping && (
              <Group gap="xs" wrap="wrap">
                <Badge variant="light" color="petrol" tt="none">
                  {enterpriseLabel(selectedMapping)}
                </Badge>
                {lineLabel(selectedMapping) && (
                  <Badge variant="outline" color="gray" tt="none">
                    {lineLabel(selectedMapping)}
                  </Badge>
                )}
                {selectedMapping.ser_num != null && (
                  <Text size="xs" c="dimmed" style={numericStyle}>
                    S/N {selectedMapping.ser_num}
                  </Text>
                )}
                {selectedMapping.model_name && (
                  <Text size="xs" c="dimmed">
                    {selectedMapping.manufacturer_short_name} {selectedMapping.model_name}
                  </Text>
                )}
              </Group>
            )}
            {rows.length > 0 && (
              <Text size="xs" c="dimmed" ml="auto">
                {t('records')}: {rows.length}
              </Text>
            )}
          </Group>

          {loading ? (
            <Box p="md">
              <PollProgress progress={progress ?? { phase: 'polling' }} />
            </Box>
          ) : error ? (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} m="sm">
              {error}
            </Alert>
          ) : !selectedMapping ? (
            <Center style={{ flex: 1 }}>
              <Text c="dimmed">{t('selectEnterprise')}</Text>
            </Center>
          ) : records && rows.length === 0 ? (
            <Center style={{ flex: 1 }}>
              <Text c="dimmed">{t('enterpriseNoData')}</Text>
            </Center>
          ) : !records ? (
            <Center style={{ flex: 1 }}>
              <Text c="dimmed">{t('noPollData')}</Text>
            </Center>
          ) : (
            <>
              <Box style={{ flex: 1, minHeight: 0, display: view === 'chart' ? 'none' : 'block' }}>
                <ScrollArea className="hlv-table-scroll" style={{ height: '100%' }} type="auto">
                  <Table striped highlightOnHover stickyHeader verticalSpacing={6}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th ta="center">Період</Table.Th>
                        <Table.Th ta="center">Обʼєм, м³</Table.Th>
                        <Table.Th ta="center">Температура, °C</Table.Th>
                        <Table.Th ta="center">Тиск, {pressureUnit}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {rows.map((r, i) => (
                        <Table.Tr key={i}>
                          <td className="hlv-cell hlv-cell-num">
                            {r.period.replace('T', ' ').slice(0, 16)}
                          </td>
                          <td className="hlv-cell hlv-cell-num">{fmtNum(r.volume, 3)}</td>
                          <td className="hlv-cell hlv-cell-num">{fmtNum(r.temperature)}</td>
                          <td className="hlv-cell hlv-cell-num">{fmtNum(r.pressure)}</td>
                        </Table.Tr>
                      ))}
                      {/* Keeps the totals row at the bottom of a short table. */}
                      <Table.Tr className="hlv-table-filler" aria-hidden>
                        <td colSpan={4} />
                      </Table.Tr>
                    </Table.Tbody>
                    <Table.Tfoot
                      style={{
                        position: 'sticky',
                        bottom: 0,
                        background: 'var(--hlv-surface-2)',
                        borderTop: '2px solid var(--hlv-border)',
                      }}
                    >
                      <Table.Tr>
                        <Table.Td ta="center" fw={700}>
                          Разом
                        </Table.Td>
                        <Table.Td ta="center" fw={700} style={numericStyle}>
                          {fmtNum(totals.volume, 3)}
                        </Table.Td>
                        <Table.Td ta="center" fw={700} style={numericStyle}>
                          {fmtNum(totals.temperature)}
                        </Table.Td>
                        <Table.Td ta="center" fw={700} style={numericStyle}>
                          {fmtNum(totals.pressure)}
                        </Table.Td>
                      </Table.Tr>
                    </Table.Tfoot>
                  </Table>
                </ScrollArea>
              </Box>
              {view === 'chart' && (
                <ArchiveChart
                  rows={rows as unknown as ArchiveRow[]}
                  type={periodType}
                  meta={{ kind: 'dpd' }}
                  embedded
                />
              )}
            </>
          )}
        </Paper>
      </Box>
    </Stack>
  )
}
