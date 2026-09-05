import { useEffect, useMemo, useRef, useState } from 'react'
import { useDisclosure, useLocalStorage } from '@mantine/hooks'
import {
  Badge,
  Box,
  Button,
  Divider,
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
import { IconLayoutColumns, IconTargetArrow } from '@tabler/icons-react'
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
import { archiveDataApi, type ArchiveRow } from '@/api/entities'
import { AggregateCell } from '@/components/AggregateCell'
import { TablePagination } from '@/components/TablePagination'
import { useFillViewportHeight, useStickyRowHeights } from '@/components/useMeasuredHeight'
import { fold, type Aggregate } from '@/domain/aggregate'
import { commercialHourlyRange } from '@/domain/commercialDay'
import { summarize } from '@/domain/fhpDeviation'
import { formatGroupPeriod } from '@/domain/groupVolumes'
import { trendColor } from '@/domain/grsTrends'
import {
  buildComparison,
  columnValues,
  comparisonChartRows,
  defaultAggFor,
  mainValues,
  quantityMeta,
  toDeltaSeries,
  totalDeltaPct,
  type ComparisonResult,
  type Quantity,
  type ToleranceMode,
} from '@/domain/lineComparison'
import {
  EMPTY_SELECTION,
  promoteToMain,
  removeLine,
  resolveSelection,
  type ResolvedLine,
  type StoredSelection,
} from '@/domain/lineComparisonSelection'
import { UNIT_LABELS } from '@/domain/pressureUnits'
import { writeSheets } from '@/lib/xlsx'
import { useLanguage } from '@/locales/LanguageContext'
import { useSelectionStore } from '@/store/selectionStore'
import { numericStyle } from '@/theme/theme'
import { PeriodPicker } from '@/features/archive/PeriodPicker'
import { TimeAxisTick, timeAxisHeight } from '@/features/archive/TimeAxisTick'
import { useTreeData } from '@/features/archive/useTreeData'
import { ChartLinePicker } from './ChartLinePicker'
import { LineComparisonPicker } from './LineComparisonPicker'
import { NoticeBar, type Notice } from './NoticeBar'
import { ReportShell } from './ReportShell'
import { SelectedLinesBar } from './SelectedLinesBar'

const pad = (n: number) => String(n).padStart(2, '0')

function defaultRange() {
  const now = new Date()
  const y = now.getFullYear()
  const m = pad(now.getMonth() + 1)
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${pad(now.getDate())}` }
}

type Granularity = 'daily' | 'hourly'
type View = 'deltas' | 'values' | 'table'

const QUANTITIES: Quantity[] = ['volume', 'pressure', 'temperature']

interface RunState {
  records: ArchiveRow[]
  main: ResolvedLine
  duplicates: ResolvedLine[]
  granularity: Granularity
  requestedIds: number[]
}

/**
 * «Порівняння ліній» — how far duplicate lines drift from the main one.
 *
 * The lines measure the same gas, so pressure and temperature should agree and
 * the volumes should differ only within instrument error. All three quantities
 * arrive in ONE request (an archive row carries them together), so switching
 * between them, and moving the tolerance, never refetches.
 */
export function LineComparisonPage() {
  const { t } = useLanguage()
  const { colorScheme } = useMantineColorScheme()
  const dark = colorScheme === 'dark'
  const { branchId } = useSelectionStore()
  const { data: tree } = useTreeData()

  const initial = defaultRange()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  // Daily by default, and deliberately: two correctors on one pipe integrate
  // against slightly different clocks, so the hourly Δ swings even on healthy
  // lines while the daily Δ is the real number.
  const [granularity, setGranularity] = useLocalStorage<Granularity>({
    key: 'hlv-line-comparison-granularity',
    defaultValue: 'daily',
  })
  // Only ids are stored; names and units are re-resolved from the tree, so a
  // line renamed in the admin panel shows up correctly without a re-pick.
  const [selection, setSelection] = useLocalStorage<StoredSelection>({
    key: 'hlv-line-comparison-selection',
    defaultValue: EMPTY_SELECTION,
  })
  const [pickerOpened, picker] = useDisclosure(false)

  const [quantity, setQuantity] = useState<Quantity>('volume')
  const [toleranceMode, setToleranceMode] = useState<ToleranceMode>('abs')
  const [tolerances, setTolerances] = useState<Record<string, number>>({})
  const [targetUnit, setTargetUnit] = useState<string | null>(null)
  const [view, setView] = useState<View>('deltas')

  const [run, setRun] = useState<RunState | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useLocalStorage<Record<number, boolean>>({
    key: 'hlv-line-comparison-hidden',
    defaultValue: {},
  })

  const resolved = useMemo(() => resolveSelection(tree, selection), [tree, selection])

  const unit =
    quantity === 'pressure'
      ? (targetUnit ?? resolved.main?.pressureUnit ?? 'кгс/см²')
      : quantityMeta(quantity, '').unit
  const meta = quantityMeta(quantity, unit)
  const tolerance =
    tolerances[`${quantity}:${toleranceMode}`] ??
    (toleranceMode === 'pct' ? meta.defaultTolerancePct : meta.defaultToleranceAbs)

  const execute = async () => {
    if (!resolved.main) {
      setError('Оберіть основну лінію')
      return
    }
    if (resolved.duplicates.length === 0) {
      setError('Оберіть щонайменше одну лінію для порівняння з основною')
      return
    }
    setRunning(true)
    setError(null)
    try {
      const ids = [resolved.main.id, ...resolved.duplicates.map((d) => d.id)]
      // The picker hands out commercial DAYS; an hour belongs to the day that
      // opens at 07:00, so the hourly window has to be widened to match.
      const win =
        granularity === 'hourly'
          ? commercialHourlyRange(from, to)
          : { from, to }
      const records =
        granularity === 'daily'
          ? await archiveDataApi.getDailyData(ids, win.from, win.to)
          : await archiveDataApi.getHourlyData(ids, win.from, win.to)
      // Frozen with the run: editing the selection afterwards must not reshape
      // the table under the numbers already on screen.
      setRun({
        records,
        main: resolved.main,
        duplicates: resolved.duplicates,
        granularity,
        requestedIds: ids,
      })
    } catch (e) {
      setRun(null)
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const result: ComparisonResult | null = useMemo(() => {
    if (!run) return null
    return buildComparison({
      records: run.records,
      main: run.main,
      duplicates: run.duplicates,
      quantity,
      targetUnit: quantity === 'pressure' ? unit : undefined,
      tolerance,
      toleranceMode,
    })
  }, [run, quantity, unit, tolerance, toleranceMode])

  const rows = result?.rows ?? []
  // Memoised: a fresh [] every render would rebuild the chart data and the
  // series picker on every keystroke in the tolerance box.
  const visibleDuplicates = useMemo(() => run?.duplicates ?? [], [run])

  const [pageSize, setPageSize] = useState(31)
  const [page, setPage] = useState(1)
  useEffect(() => {
    setPage(1)
    setPageSize(run?.granularity === 'hourly' ? 24 : 31)
  }, [run])
  const pageSizeOptions = useMemo(
    () =>
      run?.granularity === 'hourly'
        ? [
            { value: 24, label: t('pageDay') },
            { value: 168, label: t('pageWeek') },
            { value: 744, label: t('pageMonth') },
          ]
        : [
            { value: 31, label: t('pageMonth') },
            { value: 92, label: t('pageQuarter') },
            { value: 366, label: t('pageYear') },
          ],
    [run?.granularity, t],
  )
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize)

  const [footerAgg, setFooterAgg] = useLocalStorage<Record<string, Aggregate>>({
    key: 'hlv-line-comparison-agg',
    defaultValue: {},
  })
  const aggOf = (role: 'value' | 'delta'): Aggregate =>
    footerAgg[`${quantity}:${role}`] ?? defaultAggFor(quantity, role)
  const pickAgg = (role: 'value' | 'delta', how: Aggregate) =>
    setFooterAgg({ ...footerAgg, [`${quantity}:${role}`]: how })

  const notices = useMemo<Notice[]>(() => {
    const out: Notice[] = []
    if (!run || !result) return out
    for (const w of result.warnings) out.push({ tone: 'warn', text: w })
    for (const id of result.silentLineIds) {
      const line = run.duplicates.find((d) => d.id === id)
      if (line) out.push({ tone: 'warn', text: `Лінія «${line.name}» не звітувала за період` })
    }
    // The archive silently narrows to the lines the viewer may see; a mute
    // empty column with no explanation is worse than saying so.
    const returned = new Set(run.records.map((r) => r.line_id))
    const absent = run.requestedIds.filter((id) => !returned.has(id))
    if (absent.length > 0 && absent.length < run.requestedIds.length) {
      out.push({
        tone: 'warn',
        text: `${absent.length} лінія(ї) не повернули жодного рядка — можливо, немає доступу`,
      })
    }
    const calcs = new Set([run.main, ...run.duplicates].map((l) => l.calcName ?? ''))
    if (calcs.size > 1) {
      out.push({
        tone: 'info',
        text: 'Лінії з різних ГРС — переконайтесь, що це справді дублі одного вузла',
      })
    }
    if (resolved.missingIds.length > 0) {
      out.push({
        tone: 'warn',
        text: `${resolved.missingIds.length} збережена лінія(ї) більше недоступна — перевиберіть`,
      })
    }
    return out
  }, [run, result, resolved.missingIds])

  const exportExcel = () => {
    if (!run) return
    // Collected first, written once: the summary belongs at the end of the
    // book but is only complete after every quantity has been folded.
    const sheets: { name: string; aoa: (string | number | null | undefined)[][] }[] = []
    for (const q of QUANTITIES) {
      const qUnit = q === 'pressure' ? unit : quantityMeta(q, '').unit
      const block = buildComparison({
        records: run.records,
        main: run.main,
        duplicates: run.duplicates,
        quantity: q,
        targetUnit: q === 'pressure' ? qUnit : undefined,
        tolerance: tolerances[`${q}:${toleranceMode}`] ?? quantityMeta(q, qUnit).defaultToleranceAbs,
        toleranceMode,
      })
      const head = ['Період', `Основа: ${run.main.name}, ${qUnit}`]
      for (const d of run.duplicates) head.push(d.name, 'Δ', 'Δ%')
      const body = block.rows.map((row) => {
        const line: (string | number | null)[] = [
          formatGroupPeriod(row.period, run.granularity),
          row.main,
        ]
        for (const d of run.duplicates) {
          const cell = row.byLine[d.id]
          line.push(cell?.value ?? null, cell?.delta ?? null, cell?.deltaPct ?? null)
        }
        return line
      })
      const totals: (string | number | null)[] = [
        'Разом',
        fold(mainValues(block.rows), defaultAggFor(q, 'value')),
      ]
      for (const d of run.duplicates) {
        totals.push(
          fold(columnValues(block.rows, d.id, 'value'), defaultAggFor(q, 'value')),
          fold(columnValues(block.rows, d.id, 'delta'), defaultAggFor(q, 'delta')),
          totalDeltaPct(block.rows, d.id),
        )
      }
      sheets.push({
        name: quantityMeta(q, qUnit).label,
        aoa: [head, ...body, totals],
      })
    }

    const sumHead = ['Величина', 'Лінія', 'Сер. Δ', 'Сер. |Δ|', 'Макс. |Δ|', 'Коли', 'Поза допуском', '%']
    const sumBody: (string | number)[][] = []
    for (const q of QUANTITIES) {
      const qUnit = q === 'pressure' ? unit : quantityMeta(q, '').unit
      const block = buildComparison({
        records: run.records,
        main: run.main,
        duplicates: run.duplicates,
        quantity: q,
        targetUnit: q === 'pressure' ? qUnit : undefined,
        tolerance: tolerances[`${q}:${toleranceMode}`] ?? quantityMeta(q, qUnit).defaultToleranceAbs,
        toleranceMode,
      })
      const periods = block.rows.map((r) => r.period)
      for (const d of run.duplicates) {
        const stats = summarize(
          toDeltaSeries(block.rows, d.id),
          periods,
          tolerances[`${q}:${toleranceMode}`] ?? quantityMeta(q, qUnit).defaultToleranceAbs,
          toleranceMode,
        )
        if (!stats) continue
        sumBody.push([
          quantityMeta(q, qUnit).label,
          d.name,
          stats.meanDelta,
          stats.meanAbsDelta,
          stats.maxAbsDelta,
          formatGroupPeriod(stats.maxAbsDeltaAt, run.granularity),
          stats.outOfTolerance,
          stats.outOfToleranceShare,
        ])
      }
    }
    sheets.push({ name: 'Зведення', aoa: [sumHead, ...sumBody] })
    void writeSheets(`porivnyannya_liniy_${sanitize(run.main.name)}_${from}_${to}`, sheets)
  }

  const paneRef = useRef<HTMLDivElement>(null)
  const paneHeight = useFillViewportHeight(paneRef)
  const { containerRef, theadRef, tfootRef, theadHeight, tfootHeight } = useStickyRowHeights()

  const chartData = useMemo(
    () =>
      result
        ? comparisonChartRows(
            result.rows,
            visibleDuplicates.map((d) => d.id),
            view === 'values' ? 'values' : 'deltas',
            view === 'deltas' && toleranceMode === 'pct',
          )
        : [],
    [result, visibleDuplicates, view, toleranceMode],
  )
  const pickerLines = useMemo(
    () =>
      visibleDuplicates.map((d, i) => ({
        id: d.id,
        name: d.name,
        color: trendColor(i, visibleDuplicates.length),
      })),
    [visibleDuplicates],
  )

  const grid = dark ? 'var(--mantine-color-dark-4)' : 'var(--mantine-color-gray-3)'
  const axis = dark ? 'var(--mantine-color-dark-1)' : 'var(--mantine-color-gray-7)'
  const dec = meta.decimals
  const showPct = view === 'deltas' && toleranceMode === 'pct'

  return (
    <ReportShell
      title="Порівняння ліній"
      description="Відхилення ліній-дублів від основної лінії по обʼєму, тиску та температурі"
      onRun={execute}
      running={running}
      error={error}
      onExport={exportExcel}
      canExport={!!run}
      controls={
        <>
          <Box>
            <Text size="xs" fw={500} mb={4}>
              Лінії
            </Text>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconLayoutColumns size={14} />}
              onClick={picker.open}
              disabled={running}
            >
              {resolved.main
                ? `Основа + ${resolved.duplicates.length}`
                : 'Обрати лінії'}
            </Button>
          </Box>
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
              onChange={(v) => setGranularity(v as Granularity)}
              disabled={running}
              data={[
                { value: 'daily', label: 'Доба' },
                { value: 'hourly', label: 'Година' },
              ]}
            />
          </Box>
        </>
      }
    >
      <SelectedLinesBar
        main={resolved.main}
        duplicates={resolved.duplicates}
        colorOf={(i) => trendColor(i, Math.max(resolved.duplicates.length, 1))}
        onPromote={(id) => setSelection(promoteToMain(selection, id))}
        onRemove={(id) => setSelection(removeLine(selection, id))}
      />

      <LineComparisonPicker
        opened={pickerOpened}
        onClose={picker.close}
        branchId={branchId}
        selection={selection}
        onChange={setSelection}
      />

      {run && result && rows.length > 0 && (
        <Stack gap="sm" mt="sm">
          <Group gap="sm" align="flex-end" wrap="wrap">
            <Box>
              <Text size="xs" fw={500} mb={4}>
                Величина
              </Text>
              <SegmentedControl
                size="xs"
                value={quantity}
                onChange={(v) => setQuantity(v as Quantity)}
                data={QUANTITIES.map((q) => ({
                  value: q,
                  label: quantityMeta(q, unit).label,
                }))}
              />
            </Box>
            <NumberInput
              label={`Допуск, ${toleranceMode === 'pct' ? '%' : meta.unit}`}
              size="xs"
              w={140}
              min={0}
              decimalScale={toleranceMode === 'pct' ? 2 : dec}
              value={tolerance}
              onChange={(v) =>
                setTolerances((prev) => ({
                  ...prev,
                  [`${quantity}:${toleranceMode}`]: Number(v) || 0,
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
            {quantity === 'pressure' && (
              <Select
                label="Одиниця тиску"
                size="xs"
                w={130}
                data={UNIT_LABELS}
                value={unit}
                onChange={(v) => setTargetUnit(v)}
                allowDeselect={false}
              />
            )}
            <NoticeBar notices={notices} />
          </Group>

          <Paper
            ref={paneRef}
            withBorder
            radius="md"
            style={{
              // Measured, not `100dvh − <constant>`: whatever ends up above the
              // panel, it takes exactly the rest of the screen. A definite
              // height, not a max — the ScrollArea and ResponsiveContainer both
              // size their viewport off this box.
              height: paneHeight ?? 'calc(100dvh - 330px)',
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
              <Group gap="sm" wrap="nowrap">
                {/* Deviations first: the brief asks for them, and a systematic
                    drift is visible at a glance on the plot, not in a column. */}
                <SegmentedControl
                  size="xs"
                  value={view}
                  onChange={(v) => setView(v as View)}
                  data={[
                    { value: 'deltas', label: 'Відхилення' },
                    { value: 'values', label: 'Значення' },
                    { value: 'table', label: t('table') },
                  ]}
                />
                <Badge size="sm" variant="light" color="petrol" leftSection={<IconTargetArrow size={11} />}>
                  {run.main.name}
                </Badge>
              </Group>
              {view !== 'table' && (
                <ChartLinePicker lines={pickerLines} hidden={hidden} onChange={setHidden} />
              )}
            </Group>

            {view === 'table' ? (
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
                      <Table.Th rowSpan={2} style={{ textAlign: 'center' }}>
                        <Group gap={4} justify="center" wrap="nowrap">
                          <IconTargetArrow size={13} />
                          <span>{run.main.name}</span>
                        </Group>
                      </Table.Th>
                      {run.duplicates.map((d) => (
                        <Table.Th key={d.id} colSpan={3} style={{ textAlign: 'center' }}>
                          {d.name}
                          {result.silentLineIds.includes(d.id) && (
                            <Badge ml={6} size="xs" variant="light" color="gray">
                              немає даних
                            </Badge>
                          )}
                        </Table.Th>
                      ))}
                    </Table.Tr>
                    <Table.Tr>
                      {run.duplicates.flatMap((d) => [
                        <Table.Th key={`${d.id}-v`} style={{ textAlign: 'center' }}>
                          Знач.
                        </Table.Th>,
                        <Table.Th key={`${d.id}-d`} style={{ textAlign: 'center' }}>
                          Δ
                        </Table.Th>,
                        <Table.Th key={`${d.id}-p`} style={{ textAlign: 'center' }}>
                          Δ%
                        </Table.Th>,
                      ])}
                    </Table.Tr>
                  </Table.Thead>

                  <Table.Tbody>
                    {pageRows.map((row) => (
                      <Table.Tr key={row.period}>
                        <Table.Td ta="center" style={{ ...numericStyle, whiteSpace: 'nowrap' }}>
                          {formatGroupPeriod(row.period, run.granularity)}
                          {row.main === null && (
                            <Tooltip label="Основна лінія не звітувала">
                              <Text span c="orange" ml={4}>
                                *
                              </Text>
                            </Tooltip>
                          )}
                        </Table.Td>
                        <Table.Td ta="center" style={numericStyle} fw={600}>
                          {fmt(row.main, dec)}
                        </Table.Td>
                        {run.duplicates.flatMap((d) => {
                          const cell = row.byLine[d.id]
                          return [
                            <Table.Td
                              key={`${d.id}-v`}
                              ta="center"
                              style={numericStyle}
                              c={cell?.lonely ? 'dimmed' : undefined}
                              fs={cell?.lonely ? 'italic' : undefined}
                            >
                              {fmt(cell?.value ?? null, dec)}
                            </Table.Td>,
                            <Table.Td
                              key={`${d.id}-d`}
                              ta="center"
                              style={numericStyle}
                              c={cell?.breach ? 'red' : undefined}
                              fw={cell?.breach ? 600 : undefined}
                            >
                              {fmtDelta(cell?.delta ?? null, dec)}
                            </Table.Td>,
                            <Table.Td
                              key={`${d.id}-p`}
                              ta="center"
                              style={numericStyle}
                              c={cell?.breach ? 'red' : 'dimmed'}
                            >
                              {fmtDelta(cell?.deltaPct ?? null, 2)}
                            </Table.Td>,
                          ]
                        })}
                      </Table.Tr>
                    ))}
                    {/* Pins the totals row to the bottom of the pane. */}
                    <Table.Tr className="hlv-table-filler" aria-hidden>
                      <td colSpan={2 + run.duplicates.length * 3} />
                    </Table.Tr>
                  </Table.Tbody>

                  <Table.Tfoot ref={tfootRef}>
                    <Table.Tr>
                      <FootCell first>{t('summaryRow')}</FootCell>
                      <FootCell>
                        <AggregateCell
                          value={fmt(fold(mainValues(rows), aggOf('value')), dec)}
                          how={aggOf('value')}
                          onPick={(how) => pickAgg('value', how)}
                          t={t}
                        />
                      </FootCell>
                      {run.duplicates.flatMap((d) => [
                        <FootCell key={`${d.id}-v`}>
                          <AggregateCell
                            value={fmt(fold(columnValues(rows, d.id, 'value'), aggOf('value')), dec)}
                            how={aggOf('value')}
                            onPick={(how) => pickAgg('value', how)}
                            t={t}
                          />
                        </FootCell>,
                        <FootCell key={`${d.id}-d`}>
                          <AggregateCell
                            value={fmtDelta(fold(columnValues(rows, d.id, 'delta'), aggOf('delta')), dec)}
                            how={aggOf('delta')}
                            onPick={(how) => pickAgg('delta', how)}
                            t={t}
                          />
                        </FootCell>,
                        <FootCell key={`${d.id}-p`}>
                          {/* Weighted: ΣΔ / |Σосновa|. The average of the
                              per-period percentages would let a period with a
                              tiny baseline dominate the whole month. */}
                          <Tooltip label="Зважене: сума Δ до суми основної" withArrow>
                            <Text fw={700} size="sm">
                              {fmtDelta(totalDeltaPct(rows, d.id), 2)}
                            </Text>
                          </Tooltip>
                        </FootCell>,
                      ])}
                    </Table.Tr>
                  </Table.Tfoot>
                </Table>
              </ScrollArea>
            ) : (
              <Box p="md" style={{ flex: 1, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                    <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="period"
                      tick={
                        <TimeAxisTick
                          format={(v) => axisLabel(String(v), run.granularity)}
                          fill={axis}
                        />
                      }
                      height={timeAxisHeight(run.granularity === 'hourly')}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: axis }}
                      width={78}
                      tickFormatter={(v) => fmt(Number(v), dec)}
                      label={{
                        value:
                          view === 'deltas'
                            ? showPct
                              ? 'Δ, %'
                              : `Δ, ${meta.unit}`
                            : meta.unit,
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
                      labelFormatter={(label) =>
                        formatGroupPeriod(String(label), run.granularity)
                      }
                      formatter={(v) => fmt(Number(v), dec)}
                    />
                    {view === 'deltas' && (
                      <>
                        <ReferenceLine y={0} stroke={axis} />
                        <ReferenceLine
                          y={tolerance}
                          stroke="var(--mantine-color-red-6)"
                          strokeDasharray="4 4"
                        />
                        <ReferenceLine
                          y={-tolerance}
                          stroke="var(--mantine-color-red-6)"
                          strokeDasharray="4 4"
                        />
                      </>
                    )}
                    {visibleDuplicates.map((d, i) =>
                      hidden[d.id] ? null : (
                        <Line
                          key={d.id}
                          type="monotone"
                          dataKey={`line_${d.id}`}
                          name={d.name}
                          stroke={trendColor(i, visibleDuplicates.length)}
                          dot={false}
                          strokeWidth={1.6}
                          connectNulls
                          isAnimationActive={false}
                        />
                      ),
                    )}
                    {view === 'values' && (
                      <Line
                        type="monotone"
                        dataKey="main"
                        name={run.main.name}
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
            )}

            {view === 'table' && rows.length > 0 && (
              <>
                <Divider />
                <TablePagination
                  page={page}
                  pageSize={pageSize}
                  total={rows.length}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  shownLabel={`${t('records')}: ${rows.length.toLocaleString('uk-UA')}`}
                  pageSizes={pageSizeOptions}
                />
              </>
            )}
          </Paper>
        </Stack>
      )}

      {run && rows.length === 0 && (
        <Box ta="center" py="xl">
          <Text c="dimmed">{t('noDataForPeriod')}</Text>
        </Box>
      )}
    </ReportShell>
  )
}

const fmt = (v: number | null | undefined, decimals: number) =>
  v == null || Number.isNaN(v)
    ? '—'
    : v.toLocaleString('uk-UA', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })

const fmtDelta = (v: number | null | undefined, decimals: number) => {
  if (v == null || Number.isNaN(v)) return '—'
  const body = fmt(Math.abs(v), decimals)
  if (v > 0) return `+${body}`
  if (v < 0) return `−${body}`
  return body
}

function axisLabel(period: string, granularity: Granularity): [string, string] {
  const [datePart, timePart = ''] = period.replace(' ', 'T').split('T')
  const [, m, d] = datePart.split('-')
  return granularity === 'daily' ? [`${d}.${m}`, ''] : [`${d}.${m}`, timePart.slice(0, 5)]
}

const sanitize = (s: string) => s.replace(/[\\/:*?"<>|[\]]/g, ' ').trim()
// Sheet names are writeSheets' business now — it also de-duplicates them.

function FootCell({ children, first }: { children: React.ReactNode; first?: boolean }) {
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
