import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocalStorage } from '@mantine/hooks'
import {
  Anchor,
  Badge,
  Box,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  Tooltip,
  useMantineColorScheme,
} from '@mantine/core'
import { IconTargetArrow } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import * as XLSX from 'xlsx'
import { fhpReportApi, type FhpParamBlock, type RouteFhpReport } from '@/api/fhpReport'
import {
  chartRows,
  referenceChanged,
  summarize,
  tableRows,
  type ToleranceMode,
} from '@/domain/fhpDeviation'
import {
  FHP_PARAMS,
  FHP_PARAM_ORDER,
  defaultTolerance,
  formatDelta,
  formatFhp,
  formatPeriod,
  periodAxisLabel,
  type FhpParamCode,
} from '@/domain/fhpParams'
import { fold, type Aggregate } from '@/domain/aggregate'
import { trendColor } from '@/domain/grsTrends'
import { useLanguage } from '@/locales/LanguageContext'
import { useSelectionStore } from '@/store/selectionStore'
import { numericStyle } from '@/theme/theme'
import { PeriodPicker } from '@/features/archive/PeriodPicker'
import { TimeAxisTick, timeAxisHeight } from '@/features/archive/TimeAxisTick'
import { AggregateCell } from '@/components/AggregateCell'
import { TablePagination } from '@/components/TablePagination'
import {
  useFillViewportHeight,
  useStickyRowHeights,
} from '@/components/useMeasuredHeight'
import { ChartLinePicker } from './ChartLinePicker'
import { NoticeBar } from './NoticeBar'
import { FhpVolumeTable } from './FhpVolumeTable'
import { ReportShell } from './ReportShell'

const pad = (n: number) => String(n).padStart(2, '0')

function defaultRange() {
  const now = new Date()
  const y = now.getFullYear()
  const m = pad(now.getMonth() + 1)
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${pad(now.getDate())}` }
}

type View = 'table' | 'values' | 'deltas'

/**
 * «Звірка ФХП»: how far a route's manually entered gas composition drifts
 * from the lines marked as its reference.
 *
 * One parameter is shown at a time — three parameters times N lines times
 * value/Δ/Δ% is unreadable — but all three arrive in a single response, so
 * switching between them is instant and so is moving the tolerance.
 */
export function FhpComparisonPage() {
  const { t } = useLanguage()
  const { colorScheme } = useMantineColorScheme()
  const dark = colorScheme === 'dark'
  const { branchId } = useSelectionStore()

  const initial = defaultRange()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [routeId, setRouteId] = useState<string | null>(null)
  const [granularity, setGranularity] = useState<'hourly' | 'daily'>('hourly')
  const [param, setParam] = useState<FhpParamCode | 'volume'>('density')
  const [toleranceMode, setToleranceMode] = useState<ToleranceMode>('abs')
  const [tolerances, setTolerances] = useState<Record<string, number>>({})
  const [view, setView] = useState<View>('table')

  const [report, setReport] = useState<RouteFhpReport | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useLocalStorage<Record<number, boolean>>({
    key: 'hlv-fhp-hidden-lines',
    defaultValue: {},
  })

  const routes = useQuery({
    queryKey: ['fhp-routes', branchId],
    queryFn: () => fhpReportApi.routesOfBranch(branchId as number),
    enabled: branchId != null,
  })

  // Where the archive ends for this route. Nothing can be compared past it —
  // beyond that point a held value is not a measurement — so the screen says
  // so before the period is chosen rather than after the report comes back
  // empty.
  const dataUntil = useQuery({
    queryKey: ['fhp-data-until', routeId],
    queryFn: () => fhpReportApi.dataUntil(Number(routeId)),
    enabled: routeId != null,
  })
  const horizon = dataUntil.data?.data_until ?? null
  const beyondData = horizon !== null && from > horizon.slice(0, 10)

  const toleranceParam: FhpParamCode = param === 'volume' ? 'density' : param
  const tolerance =
    tolerances[`${toleranceParam}:${toleranceMode}`] ??
    defaultTolerance(toleranceParam, toleranceMode)

  const run = async () => {
    if (!routeId) {
      setError('Оберіть маршрут')
      return
    }
    setRunning(true)
    setError(null)
    try {
      const data = await fhpReportApi.report(Number(routeId), {
        date_from: from,
        date_to: to,
        granularity,
        tolerance_mode: toleranceMode,
      })
      setReport(data)
    } catch (e) {
      setReport(null)
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const showVolume = param === 'volume'
  const volumeBlock = report?.volume ?? null
  // In volume mode this stays on density: the alerts, the notices and the
  // «no reference» handling are about the composition either way, and keeping
  // it non-null avoids threading a null through the whole screen.
  const block: FhpParamBlock | null = useMemo(
    () => report?.params.find((b) => b.param === toleranceParam) ?? null,
    [report, toleranceParam],
  )

  const rows = useMemo(
    () => (block ? tableRows(block, tolerance, toleranceMode) : []),
    [block, tolerance, toleranceMode],
  )

  // The table is paginated for the same reason the archive is: a month of
  // hours is 744 rows, and the page has to stay the size of the screen. The
  // data is already here, so paging is a slice, not a request — the chart and
  // the summary keep showing the WHOLE period.
  const pageSizeOptions = useMemo(
    () =>
      granularity === 'daily'
        ? [
            { value: 31, label: t('pageMonth') },
            { value: 92, label: t('pageQuarter') },
            { value: 366, label: t('pageYear') },
          ]
        : [
            { value: 24, label: t('pageDay') },
            { value: 168, label: t('pageWeek') },
            { value: 744, label: t('pageMonth') },
          ],
    [granularity, t],
  )
  const [pageSize, setPageSize] = useState(24)
  const [page, setPage] = useState(1)

  // A new report — or a switch between hours and days — starts at page one
  // with a span that means something for that granularity.
  useEffect(() => {
    setPage(1)
    setPageSize(report?.granularity === 'daily' ? 31 : 24)
  }, [report])

  const pageRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  )
  // The volume view has its own row set, but shares the pager.
  const tableTotal = showVolume ? (volumeBlock?.periods.length ?? 0) : rows.length

  // The totals row, as in the archives: how a column is folded is chosen per
  // COLUMN ROLE rather than per line — «максимум» on Δ has to mean the same
  // thing in every line's Δ column, or the row stops being comparable across
  // the table. Kept in localStorage so the choice survives a reload.
  const [footerAgg, setFooterAgg] = useLocalStorage<Record<string, Aggregate>>({
    key: 'hlv-fhp-agg-cols',
    defaultValue: {},
  })
  // Not `sum`: adding up densities or deviations answers nothing.
  const aggOf = (role: string): Aggregate => footerAgg[role] ?? 'avg'
  const pickAgg = (role: string, how: Aggregate) =>
    setFooterAgg({ ...footerAgg, [role]: how })

  // Folded over the WHOLE period, not the open page — the row answers "what
  // did this line do over the period", which one page cannot.
  const foldCol = (values: (number | null | undefined)[], role: string) =>
    fold(
      values.filter((v): v is number => v != null && Number.isFinite(v)),
      aggOf(role),
    )

  // Four stacked alerts ate a third of the screen for a few sentences that
  // are read once. They collapse into one line here: the first notice inline,
  // the rest behind a counter — the information stays, the height does not.
  const notices = useMemo(() => {
    if (!report || !block) return [] as { tone: 'info' | 'warn'; text: string }[]
    const out: { tone: 'info' | 'warn'; text: string }[] = []
    if (report.range_clipped_at) {
      out.push({
        tone: 'info',
        text:
          'Період обмежено моментом останніх даних: ' +
          formatPeriod(report.data_until ?? report.range_clipped_at, 'hourly'),
      })
    }
    if (!block.has_reference) {
      out.push({
        tone: 'info',
        text: block.lines.every((l) => l.is_reference)
          ? 'Усі лінії маршруту еталонні — показано значення та розкид між ними'
          : 'На маршруті не позначено еталонної лінії — показано значення та розкид',
      })
    }
    if (referenceChanged(block)) {
      out.push({
        tone: 'warn',
        text: 'Склад еталона змінювався протягом періоду — стрибок еталона не є відхиленням лінії',
      })
    }
    for (const w of report.warnings) out.push({ tone: 'warn', text: w })
    return out
  }, [report, block])

  const chartData = useMemo(
    () => (block ? chartRows(block, view === 'deltas' ? 'deltas' : 'values') : []),
    [block, view],
  )

  // The scrollbars run between the sticky header and the bottom edge, so the
  // header height has to be measured, not assumed: this table's header is TWO
  // rows (line names above, Знач./Δ/Δ% below), and the 34px CSS fallback left
  // the vertical thumb running up across it.
  const { containerRef, theadRef, tfootRef, theadHeight, tfootHeight } =
    useStickyRowHeights()
  const paneRef = useRef<HTMLDivElement>(null)
  const paneHeight = useFillViewportHeight(paneRef)

  const pickerLines = useMemo(() => {
    const all = block?.lines ?? []
    return all.map((l, i) => ({
      id: l.line_id,
      name: l.line_name,
      color: trendColor(i, all.length),
    }))
  }, [block])

  const exportExcel = () => {
    if (!report) return
    const wb = XLSX.utils.book_new()
    for (const b of report.params) {
      const head = ['Період']
      for (const line of b.lines) {
        head.push(line.line_name)
        if (!line.is_reference && line.deltas) head.push('Δ', 'Δ%')
      }
      if (b.has_reference) head.push('Еталон')
      head.push('Мін', 'Макс', 'Розкид')

      const body = b.periods.map((period, i) => {
        const row: (string | number | null)[] = [formatPeriod(period, report.granularity)]
        for (const line of b.lines) {
          row.push(line.values[i])
          if (!line.is_reference && line.deltas) {
            row.push(line.deltas[i], line.delta_pcts?.[i] ?? null)
          }
        }
        if (b.has_reference) row.push(b.reference?.[i] ?? null)
        row.push(b.spread_min[i], b.spread_max[i], b.spread[i])
        return row
      })
      const sheet = XLSX.utils.aoa_to_sheet([head, ...body])
      XLSX.utils.book_append_sheet(wb, sheet, sheetName(b.label))
    }

    if (report.volume) {
      const v = report.volume
      const head = ['Період']
      for (const line of v.lines) {
        head.push(`${line.line_name}, ${v.unit}`, 'ΔV', 'ΔV%')
      }
      const body = v.periods.map((period, i) => {
        const row: (string | number | null)[] = [formatPeriod(period, report.granularity)]
        for (const line of v.lines) {
          row.push(line.volume[i], line.delta[i], line.delta_pct[i])
        }
        return row
      })
      const totals: (string | number | null)[] = ['Разом']
      for (const line of v.lines) {
        totals.push(line.total_volume ?? null, line.total_delta ?? null, line.total_delta_pct ?? null)
      }
      XLSX.utils.book_append_sheet(
        wb, XLSX.utils.aoa_to_sheet([head, ...body, totals]), "Об'єм",
      )
    }

    const summaryHead = ['Параметр', 'Лінія', 'Сер. Δ', 'Сер. |Δ|', 'Макс. |Δ|', 'Коли', 'Поза допуском', '%']
    const summaryBody: (string | number)[][] = []
    for (const b of report.params) {
      const tol = tolerances[`${b.param}:${toleranceMode}`] ?? b.tolerance
      for (const line of b.lines) {
        const stats = summarize(line, b.periods, tol, toleranceMode)
        if (!stats) continue
        summaryBody.push([
          b.label, line.line_name,
          stats.meanDelta, stats.meanAbsDelta, stats.maxAbsDelta,
          formatPeriod(stats.maxAbsDeltaAt, report.granularity),
          stats.outOfTolerance, stats.outOfToleranceShare,
        ])
      }
    }
    XLSX.utils.book_append_sheet(
      wb, XLSX.utils.aoa_to_sheet([summaryHead, ...summaryBody]), 'Зведення',
    )
    XLSX.writeFile(wb, `fhp_${report.route_number}_${from}_${to}.xlsx`)
  }

  const grid = dark ? 'var(--mantine-color-dark-4)' : 'var(--mantine-color-gray-3)'
  const axis = dark ? 'var(--mantine-color-dark-1)' : 'var(--mantine-color-gray-7)'
  const meta = block ?? null
  const decimals = meta?.decimals ?? FHP_PARAMS[toleranceParam].decimals
  const unit = meta?.unit ?? FHP_PARAMS[toleranceParam].unit

  return (
    <ReportShell
      title="Звірка ФХП"
      description="Наскільки введене вручну ФХП відрізняється від еталонного по маршруту"
      onRun={run}
      running={running}
      error={error}
      onExport={exportExcel}
      canExport={report !== null}
      controls={
        <>
          <Select
            label="Маршрут"
            size="xs"
            w={240}
            placeholder={branchId == null ? 'Спершу оберіть філію' : 'Оберіть маршрут'}
            data={(routes.data ?? []).map((r) => ({
              value: String(r.id),
              label: r.name ? `№ ${r.number} — ${r.name}` : `№ ${r.number}`,
            }))}
            value={routeId}
            onChange={setRouteId}
            disabled={running || branchId == null}
            searchable
          />
          <PeriodPicker
            withTime={false}
            from={from}
            to={to}
            onChange={(next) => {
              setFrom(next.from)
              setTo(next.to)
            }}
            disabled={running}
          />
          <Box>
            <Text size="xs" fw={500} mb={4}>
              Гранулярність
            </Text>
            <SegmentedControl
              size="xs"
              value={granularity}
              onChange={(v) => setGranularity(v as 'hourly' | 'daily')}
              disabled={running}
              data={[
                { value: 'hourly', label: 'Година' },
                { value: 'daily', label: 'Доба' },
              ]}
            />
          </Box>
        </>
      }
    >
      {horizon && (
        <Group gap={6} mt={-4}>
          <Text size="xs" c={beyondData ? 'orange' : 'dimmed'}>
            Дані по маршруту є до {formatPeriod(horizon, 'hourly')}
          </Text>
          {beyondData && (
            <Anchor
              component="button"
              type="button"
              size="xs"
              onClick={() => {
                // Snap onto the last week of data that actually exists — an
                // empty report tells the user nothing about why it is empty.
                const end = horizon.slice(0, 10)
                const start = new Date(new Date(end).getTime() - 6 * 864e5)
                  .toISOString()
                  .slice(0, 10)
                setFrom(start)
                setTo(end)
              }}
            >
              підставити останній тиждень даних
            </Anchor>
          )}
        </Group>
      )}

      {report && block && (
        <Stack gap="sm">
          {/* Parameter + tolerance: both are client-side, no refetch. The
              notices ride along on the same row instead of stacking above it. */}
          <Group gap="sm" align="flex-end" wrap="wrap">
            <Box>
              <Text size="xs" fw={500} mb={4}>
                Параметр
              </Text>
              <SegmentedControl
                size="xs"
                value={param}
                onChange={(v) => setParam(v as FhpParamCode | 'volume')}
                data={[
                  ...FHP_PARAM_ORDER.map((code) => ({
                    value: code,
                    label: FHP_PARAMS[code].label,
                  })),
                  // Present only when there is a reference to correct towards.
                  ...(volumeBlock ? [{ value: 'volume', label: "Об'єм" }] : []),
                ]}
              />
            </Box>
            {!showVolume && (
              <>
            <NumberInput
              label={`Допуск, ${toleranceMode === 'pct' ? '%' : unit}`}
              size="xs"
              w={140}
              step={toleranceMode === 'pct' ? 0.1 : 10 ** -decimals}
              decimalScale={toleranceMode === 'pct' ? 2 : decimals}
              min={0}
              value={tolerance}
              onChange={(v) =>
                setTolerances((prev) => ({
                  ...prev,
                  [`${toleranceParam}:${toleranceMode}`]: Number(v) || 0,
                }))
              }
            />
            <Box>
              <Text size="xs" fw={500} mb={4}>
                Тип допуску
              </Text>
              <SegmentedControl
                size="xs"
                value={toleranceMode}
                onChange={(v) => setToleranceMode(v as ToleranceMode)}
                data={[
                  { value: 'abs', label: 'абс.' },
                  { value: 'pct', label: '%' },
                ]}
              />
            </Box>
              </>
            )}
            <NoticeBar notices={notices} />
          </Group>

          <Paper
            ref={paneRef}
            withBorder
            radius="md"
            style={{
              // A DEFINITE height, not a max: the inner ScrollArea sizes its
              // viewport off this box, and with `max-height` alone the box
              // stays content-sized, the viewport never caps, and `overflow:
              // hidden` clips the wide table with no scrollbar to get it back.
              // ResponsiveContainer needs the same definite parent.
              // Measured rather than `100dvh - <constant>`: whatever ends up
              // above the panel, it takes exactly the rest of the screen and
              // the page itself never scrolls.
              height: paneHeight ?? 'calc(100dvh - 300px)',
              minHeight: 260,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <Group
              justify="space-between"
              px="sm"
              py={8}
              wrap="wrap"
              style={{ borderBottom: '1px solid var(--hlv-border)', flexShrink: 0 }}
            >
              <SegmentedControl
                size="xs"
                value={showVolume ? 'table' : view}
                onChange={(v) => setView(v as View)}
                data={
                  showVolume
                    ? [{ value: 'table', label: t('table') }]
                    : [
                        { value: 'table', label: t('table') },
                        { value: 'values', label: 'Значення' },
                        { value: 'deltas', label: 'Відхилення' },
                      ]
                }
              />
              {showVolume && volumeBlock?.total_delta != null && (
                <Badge
                  size="lg"
                  variant="light"
                  color={volumeBlock.total_delta < 0 ? 'red' : 'teal'}
                >
                  Разом по маршруту: {formatDelta(volumeBlock.total_delta, 1)}{' '}
                  {volumeBlock.unit}
                </Badge>
              )}
              {view !== 'table' && !showVolume && (
                <ChartLinePicker lines={pickerLines} hidden={hidden} onChange={setHidden} />
              )}
            </Group>

            {view === 'table' && showVolume && volumeBlock && (
              <FhpVolumeTable
                block={volumeBlock}
                granularity={report.granularity}
                page={page}
                pageSize={pageSize}
                t={t}
              />
            )}

            {view === 'table' && !showVolume ? (
              <ScrollArea
                ref={containerRef}
                className="hlv-table-scroll"
                style={
                  {
                    flex: 1,
                    minHeight: 0,
                    '--hlv-thead-h': `${theadHeight}px`,
                    '--hlv-tfoot-h': `${tfootHeight}px`,
                  } as React.CSSProperties
                }
                type="auto"
              >
                <Table striped highlightOnHover stickyHeader verticalSpacing={5}>
                  <Table.Thead ref={theadRef}>
                    <Table.Tr>
                      <Table.Th rowSpan={2} style={{ textAlign: 'center' }}>
                        Період
                      </Table.Th>
                      {block.lines
                        .filter((l) => l.is_reference)
                        .map((l) => (
                          <Table.Th key={l.line_id} rowSpan={2} style={{ textAlign: 'center' }}>
                            <Group gap={4} justify="center" wrap="nowrap">
                              <IconTargetArrow size={13} />
                              <span>{l.line_name}</span>
                            </Group>
                          </Table.Th>
                        ))}
                      {block.has_reference && (
                        <Table.Th rowSpan={2} style={{ textAlign: 'center' }}>
                          Еталон
                        </Table.Th>
                      )}
                      {block.lines
                        .filter((l) => !l.is_reference)
                        .map((l) => (
                          <Table.Th
                            key={l.line_id}
                            colSpan={block.has_reference ? 3 : 1}
                            style={{ textAlign: 'center' }}
                          >
                            {l.line_name}
                            {l.status === 'no_data' && (
                              <Badge ml={6} size="xs" variant="light" color="gray">
                                немає даних
                              </Badge>
                            )}
                          </Table.Th>
                        ))}
                      {!block.has_reference && (
                        <>
                          <Table.Th rowSpan={2} style={{ textAlign: 'center' }}>
                            Мін
                          </Table.Th>
                          <Table.Th rowSpan={2} style={{ textAlign: 'center' }}>
                            Макс
                          </Table.Th>
                          <Table.Th rowSpan={2} style={{ textAlign: 'center' }}>
                            Розкид
                          </Table.Th>
                        </>
                      )}
                    </Table.Tr>
                    <Table.Tr>
                      {block.has_reference &&
                        block.lines
                          .filter((l) => !l.is_reference)
                          .flatMap((l) => [
                            <Table.Th key={`${l.line_id}-v`} style={{ textAlign: 'center' }}>
                              Знач.
                            </Table.Th>,
                            <Table.Th key={`${l.line_id}-d`} style={{ textAlign: 'center' }}>
                              Δ
                            </Table.Th>,
                            <Table.Th key={`${l.line_id}-p`} style={{ textAlign: 'center' }}>
                              Δ%
                            </Table.Th>,
                          ])}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {pageRows.map((row) => {
                      const byLine = new Map(row.cells.map((c) => [c.lineId, c]))
                      const partial =
                        row.hoursPresent !== null && row.hoursPresent > 0 && row.hoursPresent < 24
                      return (
                        <Table.Tr key={row.period}>
                          <Table.Td ta="center" style={{ ...numericStyle, whiteSpace: 'nowrap' }}>
                            {formatPeriod(row.period, report.granularity)}
                            {partial && (
                              <Tooltip label={`Неповна доба: ${row.hoursPresent} год`}>
                                <Text span c="dimmed" ml={4}>
                                  *
                                </Text>
                              </Tooltip>
                            )}
                          </Table.Td>
                          {block.lines
                            .filter((l) => l.is_reference)
                            .map((l) => (
                              <Table.Td
                                key={l.line_id}
                                ta="center"
                                style={numericStyle}
                                c={byLine.get(l.line_id)?.stale ? 'dimmed' : undefined}
                                fs={byLine.get(l.line_id)?.stale ? 'italic' : undefined}
                              >
                                {formatFhp(byLine.get(l.line_id)?.value ?? null, decimals)}
                              </Table.Td>
                            ))}
                          {block.has_reference && (
                            <Table.Td ta="center" style={numericStyle} fw={600}>
                              {formatFhp(row.reference, decimals)}
                              {referenceChanged(block) && row.referenceCount !== null && (
                                <Text span size="9px" c="dimmed" ml={2}>
                                  {row.referenceCount}
                                </Text>
                              )}
                            </Table.Td>
                          )}
                          {block.lines
                            .filter((l) => !l.is_reference)
                            .flatMap((l) => {
                              const cell = byLine.get(l.line_id)
                              const dim = cell?.stale
                              const cells = [
                                <Table.Td
                                  key={`${l.line_id}-v`}
                                  ta="center"
                                  style={numericStyle}
                                  c={dim ? 'dimmed' : undefined}
                                  fs={dim ? 'italic' : undefined}
                                >
                                  {formatFhp(cell?.value ?? null, decimals)}
                                </Table.Td>,
                              ]
                              if (block.has_reference) {
                                cells.push(
                                  <Table.Td
                                    key={`${l.line_id}-d`}
                                    ta="center"
                                    style={numericStyle}
                                    c={cell?.breach ? 'red' : undefined}
                                    fw={cell?.breach ? 600 : undefined}
                                  >
                                    {formatDelta(cell?.delta ?? null, decimals)}
                                  </Table.Td>,
                                  <Table.Td
                                    key={`${l.line_id}-p`}
                                    ta="center"
                                    style={numericStyle}
                                    c={cell?.breach ? 'red' : 'dimmed'}
                                  >
                                    {formatDelta(cell?.deltaPct ?? null, 2)}
                                  </Table.Td>,
                                )
                              }
                              return cells
                            })}
                          {!block.has_reference && (
                            <>
                              <Table.Td ta="center" style={numericStyle}>
                                {formatFhp(row.spreadMin, decimals)}
                              </Table.Td>
                              <Table.Td ta="center" style={numericStyle}>
                                {formatFhp(row.spreadMax, decimals)}
                              </Table.Td>
                              <Table.Td
                                ta="center"
                                style={numericStyle}
                                c={
                                  row.spread !== null && row.spread > tolerance && toleranceMode === 'abs'
                                    ? 'red'
                                    : undefined
                                }
                              >
                                {formatFhp(row.spread, decimals)}
                              </Table.Td>
                            </>
                          )}
                        </Table.Tr>
                      )
                    })}
                  </Table.Tbody>

                  {rows.length > 0 && (
                    /* Pinned to the bottom while the rows scroll, like the
                       archives — and folded over the period, not the page. */
                    <Table.Tfoot ref={tfootRef}>
                      <Table.Tr>
                        <FooterCell first>{t('summaryRow')}</FooterCell>

                        {block.lines
                          .filter((l) => l.is_reference)
                          .map((l) => (
                            <FooterCell key={l.line_id}>
                              <AggregateCell
                                value={formatFhp(foldCol(l.values, 'value'), decimals)}
                                how={aggOf('value')}
                                onPick={(how) => pickAgg('value', how)}
                                t={t}
                              />
                            </FooterCell>
                          ))}

                        {block.has_reference && (
                          <FooterCell>
                            <AggregateCell
                              value={formatFhp(
                                foldCol(block.reference ?? [], 'reference'),
                                decimals,
                              )}
                              how={aggOf('reference')}
                              onPick={(how) => pickAgg('reference', how)}
                              t={t}
                            />
                          </FooterCell>
                        )}

                        {block.lines
                          .filter((l) => !l.is_reference)
                          .flatMap((l) => {
                            const cells = [
                              <FooterCell key={`${l.line_id}-v`}>
                                <AggregateCell
                                  value={formatFhp(foldCol(l.values, 'value'), decimals)}
                                  how={aggOf('value')}
                                  onPick={(how) => pickAgg('value', how)}
                                  t={t}
                                />
                              </FooterCell>,
                            ]
                            if (block.has_reference) {
                              cells.push(
                                <FooterCell key={`${l.line_id}-d`}>
                                  <AggregateCell
                                    value={formatDelta(
                                      foldCol(l.deltas ?? [], 'delta'),
                                      decimals,
                                    )}
                                    how={aggOf('delta')}
                                    onPick={(how) => pickAgg('delta', how)}
                                    t={t}
                                  />
                                </FooterCell>,
                                <FooterCell key={`${l.line_id}-p`}>
                                  <AggregateCell
                                    value={formatDelta(
                                      foldCol(l.delta_pcts ?? [], 'pct'),
                                      2,
                                    )}
                                    how={aggOf('pct')}
                                    onPick={(how) => pickAgg('pct', how)}
                                    t={t}
                                  />
                                </FooterCell>,
                              )
                            }
                            return cells
                          })}

                        {!block.has_reference && (
                          <>
                            <FooterCell>
                              <AggregateCell
                                value={formatFhp(foldCol(block.spread_min, 'min'), decimals)}
                                how={aggOf('min')}
                                onPick={(how) => pickAgg('min', how)}
                                t={t}
                              />
                            </FooterCell>
                            <FooterCell>
                              <AggregateCell
                                value={formatFhp(foldCol(block.spread_max, 'max'), decimals)}
                                how={aggOf('max')}
                                onPick={(how) => pickAgg('max', how)}
                                t={t}
                              />
                            </FooterCell>
                            <FooterCell>
                              <AggregateCell
                                value={formatFhp(foldCol(block.spread, 'spread'), decimals)}
                                how={aggOf('spread')}
                                onPick={(how) => pickAgg('spread', how)}
                                t={t}
                              />
                            </FooterCell>
                          </>
                        )}
                      </Table.Tr>
                    </Table.Tfoot>
                  )}
                </Table>
              </ScrollArea>
            ) : null}

            {view === 'table' && tableTotal > 0 && (
              <Box style={{ borderTop: '1px solid var(--hlv-border)', flexShrink: 0 }}>
                <TablePagination
                  page={page}
                  pageSize={pageSize}
                  total={tableTotal}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  shownLabel={`${t('records')}: ${tableTotal.toLocaleString('uk-UA')}`}
                  pageSizes={pageSizeOptions}
                />
              </Box>
            )}

            {view !== 'table' && !showVolume ? (
              <Box p="md" style={{ flex: 1, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                    <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="period"
                      tick={
                        <TimeAxisTick
                          format={(v) => periodAxisLabel(String(v), report.granularity)}
                          fill={axis}
                        />
                      }
                      height={timeAxisHeight(report.granularity === 'hourly')}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: axis }}
                      width={78}
                      tickFormatter={(v) => formatFhp(Number(v), decimals)}
                      label={{
                        value: view === 'deltas' ? `Δ, ${unit}` : unit,
                        angle: -90,
                        position: 'insideLeft',
                        style: { fontSize: 11, fill: axis },
                      }}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        background: 'var(--hlv-surface)',
                        border: '1px solid var(--hlv-border)',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelFormatter={(label) => formatPeriod(String(label), report.granularity)}
                      formatter={(v) => formatFhp(Number(v), decimals)}
                    />
                    {view === 'deltas' && (
                      <>
                        <ReferenceLine y={tolerance} stroke="var(--mantine-color-red-6)" strokeDasharray="4 4" />
                        <ReferenceLine y={-tolerance} stroke="var(--mantine-color-red-6)" strokeDasharray="4 4" />
                        <ReferenceLine y={0} stroke={axis} />
                      </>
                    )}
                    {block.lines
                      .filter((l) => (view === 'deltas' ? !l.is_reference && l.deltas : true))
                      .filter((l) => !hidden[l.line_id])
                      .map((l, i) => (
                        <Line
                          key={l.line_id}
                          type="monotone"
                          dataKey={`line_${l.line_id}`}
                          name={l.line_name}
                          stroke={trendColor(i, block.lines.length)}
                          dot={false}
                          strokeWidth={1.6}
                          connectNulls
                          isAnimationActive={false}
                        />
                      ))}
                    {view === 'values' && block.has_reference && (
                      <Line
                        type="monotone"
                        dataKey="reference"
                        name="Еталон"
                        stroke={dark ? '#fff' : '#000'}
                        strokeDasharray="6 3"
                        strokeWidth={2.4}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            ) : null}
          </Paper>
        </Stack>
      )}

      {report && block && rows.length === 0 && (
        <Box ta="center" py="xl">
          <Text c="dimmed">{t('noDataForPeriod')}</Text>
        </Box>
      )}
    </ReportShell>
  )
}

/** One cell of the pinned totals row. */
function FooterCell({ children, first }: { children: ReactNode; first?: boolean }) {
  return (
    <Table.Td
      style={{
        textAlign: 'center',
        ...numericStyle,
        position: 'sticky',
        bottom: 0,
        zIndex: 2,
        background: 'var(--hlv-surface-2)',
        borderTop: '1px solid var(--hlv-border)',
        whiteSpace: 'nowrap',
      }}
    >
      {first ? (
        <Text fw={700} size="sm">
          {children}
        </Text>
      ) : (
        children
      )}
    </Table.Td>
  )
}

/** Excel sheet names cannot carry []:*?/\ and stop at 31 characters. */
function sheetName(label: string): string {
  return label.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31)
}
