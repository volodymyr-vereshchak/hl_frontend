import { useEffect, useMemo, useState } from 'react'
import { useLocalStorage } from '@mantine/hooks'
import {
  Alert,
  Box,
  Center,
  Divider,
  Group,
  Loader,
  ScrollArea,
  SegmentedControl,
  Table,
  Text,
  useMantineColorScheme,
} from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { archiveDataApi } from '@/api/entities'
import { AggregateCell } from '@/components/AggregateCell'
import { TablePagination, type PageSizeOption } from '@/components/TablePagination'
import { useStickyRowHeights } from '@/components/useMeasuredHeight'
import { fold, type Aggregate } from '@/domain/aggregate'
import { trendColor } from '@/domain/grsTrends'
import { formatGroupPeriod, lineTotals, pivotVolumes } from '@/domain/groupVolumes'
import { writeSheet, today } from '@/lib/xlsx'
import { useLanguage } from '@/locales/LanguageContext'
import type { DateRange, GroupSelection } from '@/store/selectionStore'
import { numericStyle } from '@/theme/theme'
import { ChartLinePicker } from '@/features/reports/ChartLinePicker'
import { TimeAxisTick, timeAxisHeight } from './TimeAxisTick'
import type { TreeLine } from './useTreeData'

interface Props {
  sel: GroupSelection
  lines: TreeLine[]
  type: 'daily' | 'hourly'
  range: DateRange
  enabled: boolean
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  pageSizes?: PageSizeOption[]
  /** Registers the export handler so the toolbar button can call it. */
  onExportReady: (fn: (() => void) | null) => void
}

const fmt = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('uk-UA', { maximumFractionDigits: 2 })

/**
 * Volumes of every line under a tree node, side by side, plus their sum.
 *
 * One request, not one per line: `/daily/` and `/hourly/` already take a
 * repeated `line_id`, so a філія of ninety lines is a single round trip and the
 * pivot happens here.
 *
 * Only volumes. Pressure, temperature and Δp belong to a line and mean nothing
 * added up, so a node shows the one column that does.
 */
export function GroupVolumes({
  sel,
  lines,
  type,
  range,
  enabled,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizes,
  onExportReady,
}: Props) {
  const { t } = useLanguage()
  const { colorScheme } = useMantineColorScheme()
  const dark = colorScheme === 'dark'
  const [view, setView] = useLocalStorage<'table' | 'chart'>({
    key: `hlv-group-view-${type}`,
    defaultValue: 'table',
  })
  const [hidden, setHidden] = useState<Record<number, boolean>>({})
  const [agg, setAgg] = useLocalStorage<Record<string, Aggregate>>({
    key: 'hlv-group-agg',
    defaultValue: {},
  })
  const aggOf = (role: string): Aggregate => agg[role] ?? 'sum'

  const lineIds = useMemo(() => lines.map((l) => l.id), [lines])

  const query = useQuery({
    queryKey: ['group-volumes', type, sel.kind, sel.id, range.fromDate, range.toDate, lineIds],
    enabled: enabled && lineIds.length > 0,
    queryFn: () =>
      type === 'daily'
        ? archiveDataApi.getDailyData(lineIds, range.fromDate, range.toDate)
        : archiveDataApi.getHourlyData(lineIds, range.fromDate, range.toDate),
  })

  const rows = useMemo(
    () => pivotVolumes(query.data ?? [], lineIds),
    [query.data, lineIds],
  )
  const totals = useMemo(() => lineTotals(rows, lineIds), [rows, lineIds])
  const grandTotal = useMemo(
    () => rows.reduce((s, r) => s + r.total, 0),
    [rows],
  )

  // Lines that reported nothing at all are dropped from the table: a філія can
  // hold dozens of them, and an all-dash column is noise, not information.
  const shown = useMemo(
    () => lines.filter((l) => rows.some((r) => r.byLine[l.id] !== undefined)),
    [lines, rows],
  )

  const chartData = useMemo(
    () =>
      rows.map((r) => {
        const point: Record<string, number | string | null> = { period: r.period }
        for (const l of shown) point[`line_${l.id}`] = r.byLine[l.id] ?? null
        point.total = r.total
        return point
      }),
    [rows, shown],
  )

  const pickerLines = useMemo(
    () => shown.map((l, i) => ({ id: l.id, name: l.name, color: trendColor(i, shown.length) })),
    [shown],
  )

  const exportExcel = useMemo(() => {
    if (rows.length === 0) return null
    return () => {
      const head = ['Період', ...shown.map((l) => l.name), 'Разом']
      const body = rows.map((r) => [
        formatGroupPeriod(r.period, type),
        ...shown.map((l) => r.byLine[l.id] ?? null),
        r.total,
      ])
      const foot = ['Разом', ...shown.map((l) => totals[l.id] ?? 0), grandTotal]
      // Sheet-name sanitising and the date stamp live in writeSheets now.
      const name = sel.name.replace(/[\\/:*?"<>|[\]]/g, ' ').trim()
      void writeSheet(
        `${t(type === 'daily' ? 'dailyArchive' : 'hourlyArchive')}_${name}_${today()}`,
        'Обсяги',
        [head, ...body, foot],
      )
    }
  }, [rows, shown, totals, grandTotal, type, sel.name, t])

  // Handed up so the one export button in the toolbar drives this pane too.
  useEffect(() => {
    onExportReady(exportExcel)
    return () => onExportReady(null)
  }, [exportExcel, onExportReady])

  const { containerRef, theadRef, tfootRef, theadHeight, tfootHeight } =
    useStickyRowHeights()

  if (!enabled) {
    return (
      <Center style={{ flex: 1 }}>
        <Text c="dimmed">{t('activateDate')}</Text>
      </Center>
    )
  }
  if (lineIds.length === 0) {
    return (
      <Center style={{ flex: 1 }}>
        <Text c="dimmed">{t('groupHasNoLines')}</Text>
      </Center>
    )
  }
  if (query.isLoading) {
    return (
      <Center style={{ flex: 1 }}>
        <Loader color="petrol" />
      </Center>
    )
  }
  if (query.error) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} m="sm">
        {(query.error as Error).message}
      </Alert>
    )
  }
  if (rows.length === 0) {
    return (
      <Center style={{ flex: 1 }}>
        <Text c="dimmed">{t('noDataForPeriod')}</Text>
      </Center>
    )
  }

  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize)
  const grid = dark ? 'var(--mantine-color-dark-4)' : 'var(--mantine-color-gray-3)'
  const axis = dark ? 'var(--mantine-color-dark-1)' : 'var(--mantine-color-gray-7)'

  return (
    <>
      <Group
        px="sm"
        py={6}
        justify="space-between"
        wrap="wrap"
        style={{ borderBottom: '1px solid var(--hlv-border)', flexShrink: 0 }}
      >
        <Group gap="sm" wrap="nowrap">
          <SegmentedControl
            size="xs"
            value={view}
            onChange={(v) => setView(v as 'table' | 'chart')}
            data={[
              { value: 'table', label: t('table') },
              { value: 'chart', label: t('chart') },
            ]}
          />
          <Text size="xs" c="dimmed">
            {t('linesShown')}: {shown.length}
            {shown.length !== lines.length && ` / ${lines.length}`}
          </Text>
        </Group>
        {view === 'chart' && (
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
          <Table striped highlightOnHover stickyHeader verticalSpacing={6}>
            <Table.Thead ref={theadRef}>
              <Table.Tr>
                <Table.Th style={{ textAlign: 'center' }}>{t('date')}</Table.Th>
                {shown.map((l) => (
                  <Table.Th
                    key={l.id}
                    style={{ textAlign: 'center', whiteSpace: 'normal' }}
                    title={l.name}
                  >
                    {l.name}
                  </Table.Th>
                ))}
                <Table.Th style={{ textAlign: 'center' }}>{t('summaryRow')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {pageRows.map((r) => (
                <Table.Tr key={r.period}>
                  <Table.Td ta="center" style={{ ...numericStyle, whiteSpace: 'nowrap' }}>
                    {formatGroupPeriod(r.period, type)}
                  </Table.Td>
                  {shown.map((l) => (
                    <Table.Td key={l.id} ta="center" style={numericStyle}>
                      {fmt(r.byLine[l.id])}
                    </Table.Td>
                  ))}
                  <Table.Td
                    ta="center"
                    style={numericStyle}
                    fw={600}
                    /* A row where not every line reported is a short sum, and
                       saying so beats a number that quietly means less. */
                    c={r.present < shown.length ? 'orange' : undefined}
                    title={
                      r.present < shown.length
                        ? `${t('linesReported')}: ${r.present} / ${shown.length}`
                        : undefined
                    }
                  >
                    {fmt(r.total)}
                  </Table.Td>
                </Table.Tr>
              ))}
              {/* Stretches the table to the pane so the totals row sits at the
                  bottom instead of right under the last row — the same filler
                  the archive tables use (see .hlv-table-filler in global.css). */}
              <Table.Tr className="hlv-table-filler" aria-hidden>
                <td colSpan={shown.length + 2} />
              </Table.Tr>
            </Table.Tbody>
            <Table.Tfoot ref={tfootRef}>
              <Table.Tr>
                <FootCell first>{t('summaryRow')}</FootCell>
                {shown.map((l) => (
                  <FootCell key={l.id}>
                    <AggregateCell
                      value={fmt(fold(collect(rows, l.id), aggOf('line')))}
                      how={aggOf('line')}
                      onPick={(how) => setAgg({ ...agg, line: how })}
                      t={t}
                    />
                  </FootCell>
                ))}
                <FootCell>
                  <AggregateCell
                    value={fmt(fold(rows.map((r) => r.total), aggOf('total')))}
                    how={aggOf('total')}
                    onPick={(how) => setAgg({ ...agg, total: how })}
                    t={t}
                  />
                </FootCell>
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
                    format={(v) => axisLabel(String(v), type)}
                    fill={axis}
                  />
                }
                height={timeAxisHeight(type === 'hourly')}
              />
              <YAxis tick={{ fontSize: 11, fill: axis }} width={72} tickFormatter={fmt} />
              <RechartsTooltip
                contentStyle={{
                  background: 'var(--hlv-surface)',
                  border: '1px solid var(--hlv-border)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(label) => formatGroupPeriod(String(label), type)}
                formatter={(v) => fmt(Number(v))}
              />
              {shown.map((l, i) =>
                hidden[l.id] ? null : (
                  <Line
                    key={l.id}
                    type="monotone"
                    dataKey={`line_${l.id}`}
                    name={l.name}
                    stroke={trendColor(i, shown.length)}
                    dot={false}
                    strokeWidth={1.6}
                    connectNulls
                    isAnimationActive={false}
                  />
                ),
              )}
              {/* The sum is the point of the screen, so it is drawn heaviest. */}
              <Line
                type="monotone"
                dataKey="total"
                name={t('summaryRow')}
                stroke={dark ? '#fff' : '#000'}
                strokeWidth={2.4}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      )}

      {view === 'table' && (
        <>
          <Divider />
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={rows.length}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            shownLabel={`${t('records')}: ${rows.length.toLocaleString('uk-UA')}`}
            pageSizes={pageSizes}
          />
        </>
      )}
    </>
  )
}

function collect(rows: { byLine: Record<number, number> }[], lineId: number): number[] {
  const out: number[] = []
  for (const r of rows) {
    const v = r.byLine[lineId]
    if (v !== undefined) out.push(v)
  }
  return out
}

function axisLabel(period: string, type: 'daily' | 'hourly'): [string, string] {
  const [datePart, timePart = ''] = period.replace(' ', 'T').split('T')
  const [, m, d] = datePart.split('-')
  return type === 'daily' ? [`${d}.${m}`, ''] : [`${d}.${m}`, timePart.slice(0, 5)]
}

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
