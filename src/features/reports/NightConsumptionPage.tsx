import { useMemo, useState } from 'react'
import {
  Paper,
  Table,
  Text,
  Group,
  SegmentedControl,
  Loader,
  Box,
  ScrollArea,
  useMantineColorScheme,
} from '@mantine/core'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import * as XLSX from 'xlsx'
import {
  archiveDataApi,
  archiveDataVirtualApi,
  dpdLineApi,
  type ArchiveRow,
} from '@/api/entities'
import { commercialHourlyRange } from '@/domain/commercialDay'
import { getEnterpriseFetchFn } from '@/domain/enterpriseVolumes'
import { trendColor } from '@/domain/grsTrends'
import {
  buildNetByDayLineHour,
  nightRowsFromMap,
  buildHourlySheets,
  SHEET_HOURS,
  type NetMap,
  type NightMode,
} from '@/domain/nightConsumption'
import { useLanguage } from '@/locales/LanguageContext'
import { useSelectionStore } from '@/store/selectionStore'
import { numericStyle } from '@/theme/theme'
import { PeriodPicker } from '@/features/archive/PeriodPicker'
import { ChartLinePicker } from './ChartLinePicker'
import { ReportShell } from './ReportShell'
import { useBranchLines, type ReportLine } from './useBranchLines'

const pad = (n: number) => String(n).padStart(2, '0')

function defaultRange() {
  const now = new Date()
  const to = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const prev = new Date(now.getTime() - 7 * 864e5)
  return { from: `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(prev.getDate())}`, to }
}

const fmt = (v: unknown) =>
  v == null ? '—' : Number(v).toLocaleString('uk-UA', { maximumFractionDigits: 2 })

export function NightConsumptionPage() {
  const { t, getLocale } = useLanguage()
  const { colorScheme } = useMantineColorScheme()
  const dark = colorScheme === 'dark'
  const { branchId } = useSelectionStore()
  const { data: lines } = useBranchLines(branchId)

  const initial = defaultRange()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [mode, setMode] = useState<NightMode>('min')
  const [netMap, setNetMap] = useState<NetMap | null>(null)
  const [usedLines, setUsedLines] = useState<ReportLine[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Record<number, boolean>>({})

  // Report lines: physical ones flagged for the report plus virtual/DPD lines.
  const reportLines = useMemo(
    () => (lines ?? []).filter((l) => (l.kind === 'physical' ? l.include_in_report : true)),
    [lines],
  )

  const run = async () => {
    if (reportLines.length === 0) {
      setError('Немає ліній для звіту в цій філії')
      return
    }
    setRunning(true)
    setError(null)
    try {
      // Night hours belong to commercial days, so the hourly window runs
      // 07:00 → next-day 06:00 across the selected range.
      const win = commercialHourlyRange(from, to)
      const phys = reportLines.filter((l) => l.kind === 'physical').map((l) => l.id)
      const virt = reportLines.filter((l) => l.kind === 'virtual').map((l) => l.id)
      const dpd = reportLines.filter((l) => l.kind === 'dpd').map((l) => l.id)

      // Failures are collected rather than swallowed: if nothing comes back the
      // user must see WHY (e.g. the backend rejecting an over-long range).
      const settled = await Promise.allSettled<ArchiveRow[]>([
        phys.length
          ? archiveDataApi.getHourlyData(phys, win.from, win.to)
          : Promise.resolve<ArchiveRow[]>([]),
        virt.length
          ? archiveDataVirtualApi.getHourlyData(virt, win.from, win.to)
          : Promise.resolve<ArchiveRow[]>([]),
        dpd.length
          ? dpdLineApi.getHourlyData(dpd, win.from, win.to)
          : Promise.resolve<ArchiveRow[]>([]),
      ])
      const hourly = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      const failure = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
      if (hourly.length === 0) {
        if (failure) throw failure.reason
        setNetMap({})
        setUsedLines(reportLines)
        return
      }

      // Night consumption is by definition the населення share, i.e. what is
      // left after industry — so industry is always subtracted, never optional.
      // Bare commercial days, NOT `win`: the enterprise endpoint applies the
      // hourly 07:00→06:00 expansion itself.
      setProgress(t('loadingEnterpriseData'))
      const enterprise = await getEnterpriseFetchFn(true)(
        reportLines.map((l) => l.id),
        from,
        to,
        'hourly',
        (pr) => setProgress(pr.total ? `${pr.done ?? 0}/${pr.total}` : (pr.phase ?? null)),
      ).catch(() => [])

      setNetMap(buildNetByDayLineHour(hourly, enterprise))
      setUsedLines(reportLines)
    } catch (e) {
      setError((e as Error).message)
      setNetMap(null)
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  // Switching the variant recomputes from the same NET map — no refetch.
  const rows = useMemo(
    () => (netMap ? nightRowsFromMap(netMap, usedLines.map((l) => l.id), mode) : []),
    [netMap, usedLines, mode],
  )

  const pickerLines = useMemo(
    () =>
      usedLines.map((l, i) => ({ id: l.id, name: l.name, color: trendColor(i, usedLines.length) })),
    [usedLines],
  )

  const fmtX = (value: string) => {
    const d = new Date(value)
    return isNaN(d.getTime())
      ? value
      : d.toLocaleDateString(getLocale(), { day: '2-digit', month: '2-digit' })
  }

  const grid = dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)'
  const axis = dark ? '#9aa7ad' : '#5a6b75'
  // Cap the number of X labels so a long range stays readable.
  const tickInterval = Math.max(0, Math.ceil(rows.length / 24) - 1)

  const exportExcel = () => {
    if (!netMap) return
    const wb = XLSX.utils.book_new()
    const header = ['Доба', ...usedLines.map((l) => l.name)]
    const body = rows.map((r) => [r.date, ...usedLines.map((l) => r[`line_${l.id}`] ?? '')])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...body]), 'Зведення')

    // One sheet per line with the hourly NET flow across the night.
    const sheets = buildHourlySheets(netMap, rows.map((r) => r.date), usedLines.map((l) => l.id))
    for (const line of usedLines) {
      const h = [['Доба', ...SHEET_HOURS.map((x) => `${pad(x)}:00`)]]
      for (const row of sheets[line.id] ?? []) {
        h.push([String(row.date), ...SHEET_HOURS.map((x) => String(row[x] ?? ''))])
      }
      // Sheet names are capped at 31 chars and may not contain []:*?/\
      const safe = line.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31)
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(h), safe || `line_${line.id}`)
    }
    XLSX.writeFile(wb, `night_consumption_${from}_${to}.xlsx`)
  }

  const description =
    mode === 'avg23' ? t('nightConsumptionAvgDescription') : t('nightConsumptionNetDescription')

  return (
    <ReportShell
      title={t('nightConsumption')}
      description={description}
      onRun={run}
      running={running}
      onExport={exportExcel}
      canExport={rows.length > 0}
      error={error}
      controls={
        <>
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(v) => setMode(v as NightMode)}
            data={[
              { value: 'min', label: t('nightReportMin') },
              { value: 'avg23', label: t('nightReportAvg') },
            ]}
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
          {progress && (
            <Group gap={4} wrap="nowrap">
              <Loader size={14} color="grape" />
              <Text size="xs" c="dimmed">
                {progress}
              </Text>
            </Group>
          )}
        </>
      }
    >
      {rows.length > 0 && (
        <Paper withBorder radius="md">
          {/* Bounded, so the chart underneath stays reachable on a long range;
              past that height the table scrolls and then hands the wheel back
              to the page. */}
          <ScrollArea.Autosize className="hlv-table-scroll" mah="60dvh" type="auto">
            <Table striped highlightOnHover stickyHeader verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ textAlign: 'center' }}>{t('date')}</Table.Th>
                  {usedLines.map((l) => (
                    <Table.Th key={l.id} style={{ textAlign: 'center', whiteSpace: 'normal' }}>
                      {l.name}
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.date}>
                    <Table.Td ta="center" style={numericStyle}>
                      {new Date(r.date).toLocaleDateString('uk-UA')}
                    </Table.Td>
                    {usedLines.map((l) => (
                      <Table.Td key={l.id} ta="center" style={numericStyle}>
                        {fmt(r[`line_${l.id}`])}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        </Paper>
      )}

      {rows.length > 0 && (
        <Paper withBorder radius="md" p="md">
          <Group justify="space-between" mb="sm" wrap="wrap">
            <Text fw={600} ff="'Space Grotesk Variable', sans-serif">
              {t('nightConsumption')}
            </Text>
            <ChartLinePicker lines={pickerLines} hidden={hidden} onChange={setHidden} />
          </Group>
          <ResponsiveContainer width="100%" height={460}>
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid stroke={grid} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={fmtX}
                tick={{ fontSize: 11, fill: axis }}
                interval={tickInterval}
                angle={-45}
                textAnchor="end"
                height={62}
              />
              <YAxis
                tick={{ fontSize: 11, fill: axis }}
                width={72}
                tickFormatter={(v) => fmt(v)}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--hlv-surface)',
                  border: '1px solid var(--hlv-border)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v) => `${fmt(v)} ${t('volumeUnit')}`}
                labelFormatter={(label) => fmtX(String(label))}
              />
              {usedLines.map((l, i) =>
                hidden[l.id] ? null : (
                  <Line
                    key={l.id}
                    type="monotone"
                    dataKey={`line_${l.id}`}
                    name={l.name}
                    stroke={trendColor(i, usedLines.length)}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ),
              )}
            </LineChart>
          </ResponsiveContainer>
        </Paper>
      )}

      {netMap && rows.length === 0 && (
        <Box ta="center" py="xl">
          <Text c="dimmed">{t('noDataForPeriod')}</Text>
        </Box>
      )}
    </ReportShell>
  )
}
