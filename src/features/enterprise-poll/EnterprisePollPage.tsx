import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
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
  ActionIcon,
  Tooltip,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import {
  IconAlertTriangle,
  IconBuildingCommunity,
  IconCalendar,
  IconChevronRight,
  IconChevronsDown,
  IconChevronsUp,
  IconRipple,
  IconFileSpreadsheet,
  IconPlayerPlay,
  IconPlugConnectedX,
  IconSearch,
  IconPlayerStop,
} from '@tabler/icons-react'
import { useLocalStorage } from '@mantine/hooks'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { AggregateCell } from '@/components/AggregateCell'
import { TablePagination, type PageSizeOption } from '@/components/TablePagination'
import { columnAggregate, fold, type Aggregate } from '@/domain/aggregate'
import { DEFAULT_PERIOD_PAGE_SIZE, PERIOD_PAGE_SIZES } from '@/domain/periodPaging'
import { branchAdminApi, dpdLineAdminApi, lineAdminApi } from '@/api/admin'
import {
  enterpriseApi,
  correctorLabel,
  currentDevice,
  enterpriseLabel,
  streamEnterpriseVolumes,
  type EnterpriseMappingRow,
  type EnterpriseRecord,
} from '@/api/enterprise'
import { PollProgress } from '@/components/PollProgress'
import { UnpolledReport } from './UnpolledReport'
import { EMPTY_UNPOLLED_FILTERS, type UnpolledFilters } from './unpolledFilters'
import { useStickyRowHeights } from '@/components/useMeasuredHeight'
import { enterpriseRecordTotal } from '@/domain/enterpriseVolumes'
import { normalizeUnit, PRESSURE_UNIT_DEFAULT } from '@/domain/pressureUnits'
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

/**
 * The three numeric columns of the poll table, in the order they are shown.
 * `isSummable` picks the footer's default: volumes add up, a temperature or a
 * pressure summed over a month means nothing, so those average.
 */
const COLUMNS: {
  key: 'volume' | 'temperature' | 'pressure'
  isSummable: boolean
  decimals: number
}[] = [
  { key: 'volume', isSummable: true, decimals: 3 },
  { key: 'temperature', isSummable: false, decimals: 2 },
  { key: 'pressure', isSummable: false, decimals: 2 },
]

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
  // "Всі філії" belongs to THIS screen, not to the reports. It used to write
  // straight into the shared selection, so clearing the filter here left every
  // report screen with no branch — the branch looked lost on the next tab.
  // Picking a branch still carries over; only the empty state stays local.
  const [branchFilter, setBranchFilter] = useState<number | null>(branchId)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  // Feed the scrollbars, which run between the sticky header and totals row.
  const { containerRef, theadRef, tfootRef, theadHeight, tfootHeight } = useStickyRowHeights()
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
  const [unpolled, setUnpolled] = useState<EnterpriseMappingRow[] | null>(null)
  /**
   * Whether the report is on screen — kept apart from the data behind it.
   * Picking an enterprise off the report switches the pane to the poll, and
   * dropping the rows at that moment meant the only way back was to re-run the
   * whole check.
   */
  const [reportOpen, setReportOpen] = useState(false)
  /** Filters, view and page of the report, held here for the same reason the
   *  rows are: hiding the report unmounts it. */
  const [reportFilters, setReportFilters] = useState<UnpolledFilters>(EMPTY_UNPOLLED_FILTERS)
  /** What the last check covered — shown above the report so the number means
   *  something ("3 of 340" reads differently from a bare "3"). */
  const [checkedRange, setCheckedRange] = useState({ from: '', to: '', count: 0 })
  const [checking, setChecking] = useState(false)
  const [checkProgress, setCheckProgress] = useState<{ done?: number; total?: number; phase?: string } | null>(null)
  const checkAbortRef = useRef<AbortController | null>(null)
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
      .filter((m) => !branchFilter || m.branch_id === branchFilter)
      .filter((m) => {
        if (!q) return true
        return (
          enterpriseLabel(m).toLowerCase().includes(q) ||
          (m.devices ?? []).some((d) => String(d.ser_num).includes(q)) ||
          (lineLabel(m) ?? '').toLowerCase().includes(q)
        )
      })
  }, [mappings, branchFilter, search, lineLabel])

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

  // Every collapsible key in the tree — branches and the lines under them.
  const allGroupKeys = useMemo(
    () => tree.flatMap((b) => [b.key, ...b.lines.map((l) => `${b.key}/${l.key}`)]),
    [tree],
  )
  const collapseAll = () => setCollapsed(Object.fromEntries(allGroupKeys.map((k) => [k, true])))
  const expandAll = () => setCollapsed({})

  const selectedMapping = list.find((m) => m.id === selected) ?? null

  /**
   * "Немає опитування" — which enterprises have gone silent.
   *
   * Poll the last four COMPLETED days for every line that has an active
   * enterprise behind it, and call a device polled if ANY period in that window
   * came back with a volume. A null volume is the whole signal here — it means
   * the corrector was not reached — so `include_devices` must stay on (the
   * endpoint defaults it to true) and `live` must be set, or the check reports
   * on the archive instead of on the meters.
   *
   * The window ends YESTERDAY. Today's commercial day is still running, so DPD
   * has no daily record for it yet for anybody — including it polled a day that
   * can only come back empty and pushed the whole window a day short of what it
   * claimed to check. On the 25th the check covers the 21st through the 24th.
   */
  const checkUnpolled = async () => {
    const active = (mappings ?? []).filter(
      (m) => m.active !== false && (!branchFilter || m.branch_id === branchFilter),
    )
    // setDate, not millisecond arithmetic: subtracting 24h across a DST switch
    // lands on the wrong calendar day.
    const end = new Date()
    end.setDate(end.getDate() - 1)
    const start = new Date(end)
    start.setDate(start.getDate() - 3)
    const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    setCheckedRange({ from: day(start), to: day(end), count: active.length })
    const lineIds = [...new Set(active.map((m) => m.line_id ?? m.dpd_line_id).filter((id): id is number => id != null))]
    if (lineIds.length === 0) {
      setUnpolled([])
      setReportOpen(true)
      return
    }
    checkAbortRef.current?.abort()
    const ctrl = new AbortController()
    checkAbortRef.current = ctrl
    // Drop the previous report so the pane shows this check's progress.
    setUnpolled(null)
    setReportOpen(false)
    setChecking(true)
    setError(null)
    setCheckProgress(null)
    try {
      const records = await streamEnterpriseVolumes(
        {
          line_id: lineIds,
          from_date: day(start),
          to_date: day(end),
          period_type: 'daily',
          live: true,
        },
        { onProgress: setCheckProgress, signal: ctrl.signal },
      )
      const polled = new Set<string>()
      for (const record of records) {
        for (const d of record.devices ?? []) {
          if (d.volume != null) polled.add(`${d.serNum}_${d.chNum}`)
        }
      }
      setUnpolled(
        active.filter((m) => {
          const device = currentDevice(m)
          // A point with no corrector fitted has nothing to poll — reporting
          // it as unpolled would make an empty slot look like a failure.
          if (!device) return false
          return !polled.has(`${device.ser_num}_${device.ch_num}`)
        }),
      )
      setReportOpen(true)
    } catch (e) {
      const err = e as Error
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setChecking(false)
      setCheckProgress(null)
    }
  }

  const exportUnpolled = (rowsToExport: EnterpriseMappingRow[]) => {
    if (!rowsToExport.length) return
    const header = [
      t('branch'),
      t('enterprise'),
      t('correctorType'),
      t('correctorNumber'),
      t('channelNumber'),
      t('lineName'),
      t('status'),
    ]
    const body = rowsToExport.map((m) => [
      (branches ?? []).find((b) => b.id === m.branch_id)?.name ?? '',
      enterpriseLabel(m),
      correctorLabel(m),
      currentDevice(m)?.ser_num ?? '',
      currentDevice(m)?.ch_num ?? '',
      lineLabel(m) ?? t('withoutLine'),
      m.enabled === false ? t('statusDisabled') : t('statusEnabled'),
    ])
    const ws = XLSX.utils.aoa_to_sheet([header, ...body])
    ws['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 20 }, { wch: 12 }]
    const wb = XLSX.utils.book_new()

    // Both views go into the file regardless of which one is on screen: whoever
    // opens it later wants the totals, and re-exporting to get them is busywork.
    const on = rowsToExport.filter((m) => m.enabled !== false).length
    const byCorrector = new Map<string, { on: number; off: number }>()
    for (const m of rowsToExport) {
      const name = correctorLabel(m) || t('unknownCorrector')
      const e = byCorrector.get(name) ?? { on: 0, off: 0 }
      if (m.enabled === false) e.off += 1
      else e.on += 1
      byCorrector.set(name, e)
    }
    const summary: (string | number)[][] = [
      [t('unpolledChecked'), checkedRange.count],
      [t('unpolledTotal'), rowsToExport.length],
      [t('unpolledOn'), on],
      [t('unpolledOff'), rowsToExport.length - on],
      [],
      [t('correctorType'), t('unpolledOn'), t('unpolledOff'), t('total')],
      ...[...byCorrector.entries()]
        .sort((a, b) => b[1].on + b[1].off - (a[1].on + a[1].off))
        .map(([name, c]) => [name, c.on, c.off, c.on + c.off]),
    ]
    const wsSummary = XLSX.utils.aoa_to_sheet(summary)
    wsSummary['!cols'] = [{ wch: 34 }, { wch: 14 }, { wch: 14 }, { wch: 12 }]
    XLSX.utils.book_append_sheet(wb, wsSummary, t('unpolledSummary'))
    XLSX.utils.book_append_sheet(wb, ws, t('unpolledByName'))
    const d = new Date()
    XLSX.writeFile(wb, `unpolled_enterprises_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.xlsx`)
  }

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
          // The corrector standing there now: this screen asks the meter,
          // and the meter is whichever device is fitted today.
          serNum: currentDevice(selectedMapping)?.ser_num,
          mfDev: currentDevice(selectedMapping)?.mf_dev ?? undefined,
          typeDev: currentDevice(selectedMapping)?.type_dev ?? undefined,
          chNum: currentDevice(selectedMapping)?.ch_num,
          line_id: (() => {
            const id = selectedMapping.line_id ?? selectedMapping.dpd_line_id
            return id != null ? [id] : undefined
          })(),
          // This screen exists to ASK the meter, so the DPD API is the source:
          // `live` re-polls the whole range and only falls back to the archive
          // when the API cannot be reached. Without it the button read the DB
          // and answered with whatever the last scheduled import had left —
          // the one thing an operator opening "Опитування" is not asking for.
          live: true,
          // A deactivated point is still selectable here, and asking its meter
          // is often WHY it is being looked at. Without this the poll ran and
          // came back empty, because every lookup drops inactive points. It
          // changes nothing anywhere else: daily, hourly, trends and the night
          // report resolve through the ring path, which refuses this flag.
          include_inactive: true,
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
            pressureUnit: normalizeUnit(device?.pressure_unit),
          }
        })
        .sort((a, b) => a.period.localeCompare(b.period)),
    [records],
  )

  // One unit for the whole poll (same device) — take the first the API gave us.
  // Records with no unit (never sent, or sent as the literal "None") fall back
  // to the project default; those meters report in кгс/см².
  const pressureUnit = useMemo(
    () => rows.find((r) => r.pressureUnit)?.pressureUnit ?? PRESSURE_UNIT_DEFAULT,
    [rows],
  )

  // ── Paging ────────────────────────────────────────────────────────────────
  // A page is a stretch of time, the same spans the daily and hourly archives
  // page by — a month of hourly readings is 744 rows, and scrolling through
  // them to reach the totals row was the whole problem.
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useLocalStorage({
    key: `hlv-poll-pagesize-${periodType}`,
    defaultValue: DEFAULT_PERIOD_PAGE_SIZE[periodType],
  })
  // A new poll, or a switch between daily and hourly, starts at page one —
  // clamping alone would leave the reader on page 7 of a different dataset.
  useEffect(() => {
    setPage(1)
  }, [records, periodType])
  const pageSizeOptions: PageSizeOption[] = useMemo(
    () => PERIOD_PAGE_SIZES[periodType].map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [periodType, t],
  )
  // A fresh poll, or a shorter page, can leave the open page past the end.
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleRows = useMemo(
    () => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [rows, currentPage, pageSize],
  )

  // ── Footer ────────────────────────────────────────────────────────────────
  /**
   * Per column, kept per granularity — a daily poll and an hourly one get read
   * for different things. Folded over the WHOLE poll, not the open page: the
   * row answers "what did this point consume over the period", which a page
   * cannot. Same rule, and the same picker, as the archive footer.
   */
  const [aggregates, setAggregates] = useLocalStorage<Record<string, Aggregate>>({
    key: `hlv-poll-agg-cols-${periodType}`,
    defaultValue: {},
  })
  const pickAggregate = (key: string, how: Aggregate) =>
    setAggregates({ ...aggregates, [key]: how })

  const totals = useMemo(() => {
    const out: Record<string, { text: string; how: Aggregate }> = {}
    for (const col of COLUMNS) {
      const how = columnAggregate(col, aggregates[col.key])
      const values = rows
        .map((r) => Number(r[col.key]))
        .filter((n) => isFinite(n))
      const folded = fold(values, how)
      out[col.key] = { text: folded == null ? '—' : fmtNum(folded, col.decimals), how }
    }
    return out
  }, [rows, aggregates])

  const exportExcel = () => {
    if (!rows.length) return
    const header = ['Період', 'Обʼєм, м³', 'Температура, °C', `Тиск, ${pressureUnit}`]
    const body = rows.map((r) => [r.period, r.volume, r.temperature ?? '', r.pressure ?? ''])
    body.push(['Разом', totals.volume.text, totals.temperature.text, totals.pressure.text])
    const ws = XLSX.utils.aoa_to_sheet([header, ...body])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Підприємство')
    XLSX.writeFile(wb, `enterprise_${(selectedMapping && currentDevice(selectedMapping)?.ser_num) ?? 'poll'}_${from}_${to}.xlsx`)
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
        {/* Answers "is anything not reporting?" without picking a device
            first — the reason it is a toolbar button and not a row action.
            Once a report exists the button re-opens it rather than spending
            another multi-minute poll; re-running is «Оновити» inside it. */}
        <Button
          size="xs"
          variant="light"
          color="amber"
          leftSection={<IconPlugConnectedX size={15} />}
          rightSection={
            unpolled !== null && !reportOpen ? (
              <Badge size="xs" circle variant="filled" color={unpolled.length ? 'amber' : 'teal'}>
                {unpolled.length}
              </Badge>
            ) : undefined
          }
          onClick={() => (unpolled !== null ? setReportOpen(true) : void checkUnpolled())}
          loading={checking}
          disabled={loading}
        >
          {t('unpolledEnterprises')}
        </Button>
        <Select
          placeholder="Всі філії"
          data={(branches ?? []).map((b) => ({ value: String(b.id), label: b.name }))}
          value={branchFilter != null ? String(branchFilter) : null}
          onChange={(v) => {
            const next = v ? Number(v) : null
            setBranchFilter(next)
            if (next != null) setBranchId(next)
          }}
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
            <Group gap={4} wrap="nowrap">
              <TextInput
                placeholder={t('searchEnterprise')}
                leftSection={<IconSearch size={15} />}
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                size="xs"
                style={{ flex: 1 }}
              />
              {/* A few hundred devices across a dozen branches: opening or
                  closing them one at a time is the slow part of finding one. */}
              <Tooltip label={t('expandAll')} withArrow>
                <ActionIcon variant="default" size="md" onClick={expandAll} aria-label={t('expandAll')}>
                  <IconChevronsDown size={15} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('collapseAll')} withArrow>
                <ActionIcon variant="default" size="md" onClick={collapseAll} aria-label={t('collapseAll')}>
                  <IconChevronsUp size={15} />
                </ActionIcon>
              </Tooltip>
            </Group>
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
                                        {m.active === false && (
                                          <Badge
                                            size="xs"
                                            variant="light"
                                            color="amber"
                                            tt="none"
                                            title={t('inactiveNotInReports')}
                                          >
                                            {t('inactive')}
                                          </Badge>
                                        )}
                                        {currentDevice(m) && (
                                          <Text size="10px" c="dimmed" style={numericStyle}>
                                            {currentDevice(m)!.ser_num}
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
          {/* The "no poll" result takes the whole pane: it is a report in its
              own right, and as a modal it covered the tree its rows link into. */}
          {unpolled !== null && reportOpen ? (
            <UnpolledReport
              rows={unpolled}
              filters={reportFilters}
              onFiltersChange={setReportFilters}
              checked={checkedRange.count}
              from={checkedRange.from}
              to={checkedRange.to}
              branchName={(id) => (branches ?? []).find((b) => b.id === id)?.name ?? '—'}
              lineLabel={lineLabel}
              correctorName={correctorLabel}
              onSelect={(id) => {
                setSelected(id)
                // Hide, don't discard: the toolbar button brings it straight back.
                setReportOpen(false)
              }}
              onClose={() => setReportOpen(false)}
              onExport={exportUnpolled}
              onRefresh={() => void checkUnpolled()}
            />
          ) : (
          <>
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
                {/* Polling one of these works on purpose; what it must not do
                    is look like data the reports counted. */}
                {selectedMapping.active === false && (
                  <Badge variant="light" color="amber" tt="none" title={t('inactiveNotInReports')}>
                    {t('inactive')}
                  </Badge>
                )}
                {currentDevice(selectedMapping) && (
                  <Text size="xs" c="dimmed" style={numericStyle}>
                    S/N {currentDevice(selectedMapping)!.ser_num}
                  </Text>
                )}
                {currentDevice(selectedMapping)?.model_name && (
                  <Text size="xs" c="dimmed">
                    {currentDevice(selectedMapping)!.manufacturer_short_name}{' '}
                    {currentDevice(selectedMapping)!.model_name}
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

          {checking ? (
            // The check polls every device of the branch — minutes, not seconds.
            <Box p="md">
              <PollProgress progress={checkProgress ?? { phase: 'polling' }} />
              <Group justify="flex-end" mt="md">
                <Button
                  size="xs"
                  variant="light"
                  color="red"
                  leftSection={<IconPlayerStop size={15} />}
                  onClick={() => checkAbortRef.current?.abort()}
                >
                  {t('stop')}
                </Button>
              </Group>
            </Box>
          ) : loading ? (
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
                {/* Scrollbars keep clear of the sticky rows — see global.css. */}
                <ScrollArea
                  ref={containerRef}
                  className="hlv-table-scroll"
                  style={
                    {
                      height: '100%',
                      '--hlv-thead-h': `${theadHeight}px`,
                      '--hlv-tfoot-h': `${tfootHeight}px`,
                    } as React.CSSProperties
                  }
                  type="auto"
                >
                  <Table striped highlightOnHover stickyHeader verticalSpacing={6}>
                    <Table.Thead ref={theadRef}>
                      <Table.Tr>
                        <Table.Th ta="center">Період</Table.Th>
                        <Table.Th ta="center">Обʼєм, м³</Table.Th>
                        <Table.Th ta="center">Температура, °C</Table.Th>
                        <Table.Th ta="center">Тиск, {pressureUnit}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {visibleRows.map((r, i) => (
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
                      ref={tfootRef}
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
                        {COLUMNS.map((col) => (
                          <Table.Td key={col.key} ta="center" style={numericStyle}>
                            <AggregateCell
                              value={totals[col.key].text}
                              how={totals[col.key].how}
                              onPick={(how) => pickAggregate(col.key, how)}
                              t={t}
                            />
                          </Table.Td>
                        ))}
                      </Table.Tr>
                    </Table.Tfoot>
                  </Table>
                </ScrollArea>
              </Box>
              {view !== 'chart' && rows.length > pageSize && (
                <TablePagination
                  page={currentPage}
                  pageSize={pageSize}
                  total={rows.length}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  shownLabel={`${t('records')}: ${rows.length.toLocaleString('uk-UA')}`}
                  pageSizes={pageSizeOptions}
                />
              )}
              {view === 'chart' && (
                <ArchiveChart
                  rows={rows as unknown as ArchiveRow[]}
                  type={periodType}
                  // Same unit the table header shows: it comes from the poll
                  // response, not from any line configuration.
                  meta={{ kind: 'dpd', pressure_unit: pressureUnit }}
                  embedded
                />
              )}
            </>
          )}
          </>
          )}
        </Paper>
      </Box>
    </Stack>
  )
}
