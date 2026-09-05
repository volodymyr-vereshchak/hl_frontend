import { useMemo, useState } from 'react'
import { useLocalStorage } from '@mantine/hooks'
import {
  Paper,
  Table,
  Text,
  Group,
  SegmentedControl,
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
import { archiveDataApi, type HourlyCompact } from '@/api/entities'
import type { EnterpriseRecord } from '@/api/enterprise'
import { addDays } from '@/domain/commercialDay'
import { getEnterpriseFetchFn } from '@/domain/enterpriseVolumes'
import { trendColor } from '@/domain/grsTrends'
import {
  buildNetByDayLineHour,
  nightHourlyRange,
  nightRowsFromMap,
  buildHourlySheets,
  MIN_HOURS,
  SHEET_HOURS,
  type DayMode,
  type NightMode,
} from '@/domain/nightConsumption'
import { writeSheets } from '@/lib/xlsx'
import { useLanguage } from '@/locales/LanguageContext'
import { useSelectionStore } from '@/store/selectionStore'
import { numericStyle } from '@/theme/theme'
import { PeriodPicker } from '@/features/archive/PeriodPicker'
import { TimeAxisTick, timeAxisHeight } from '@/features/archive/TimeAxisTick'
import { ChartLinePicker } from './ChartLinePicker'
import { pollPhaseLabel } from './pollPhase'
import { ReportShell } from './ReportShell'
import { useBranchLines, type ReportLine } from './useBranchLines'

const pad = (n: number) => String(n).padStart(2, '0')

/** Reports open on the current month: 1st → today. */
function defaultRange() {
  const now = new Date()
  const y = now.getFullYear()
  const m = pad(now.getMonth() + 1)
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${pad(now.getDate())}` }
}

const fmt = (v: unknown) =>
  v == null ? '—' : Number(v).toLocaleString('uk-UA', { maximumFractionDigits: 2 })

/** The only hours the report ever looks at — the summary's and the export's. */
const NIGHT_HOURS = [...new Set([...MIN_HOURS, ...SHEET_HOURS])].sort((a, b) => a - b)

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
  // Which day the night is filed under. Remembered, unlike the min/avg variant:
  // it is how the branch reads its nights, not something switched per report.
  const [dayMode, setDayMode] = useLocalStorage<DayMode>({
    key: 'hlv-night-day-mode',
    defaultValue: 'commercial',
  })
  // The fetched night, with the range it was fetched for. Both day modes are
  // served out of it, so switching between them costs no request.
  const [raw, setRaw] = useState<{
    hourly: HourlyCompact
    enterprise: EnterpriseRecord[]
    from: string
    to: string
  } | null>(null)
  const [usedLines, setUsedLines] = useState<ReportLine[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Which series the user switched off — remembered, like the archive chart.
  const [hidden, setHidden] = useLocalStorage<Record<number, boolean>>({
    key: 'hlv-night-hidden-lines',
    defaultValue: {},
  })
  const [view, setView] = useState<'table' | 'chart'>('table')

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
    setProgress(t('phaseArchives'))
    try {
      // One window for both day modes: the evening before the range and the
      // morning after it (see nightHourlyRange).
      const win = nightHourlyRange(from, to)
      const ids = reportLines.map((l) => l.id)

      // Both halves at once. Industry does not depend on the archive, and on a
      // long range each is seconds of server work — running them one after the
      // other simply added the two waits together.
      //
      // Night consumption is by definition the населення share, i.e. what is
      // left after industry — so industry is always subtracted, never optional.
      // Bare commercial days for it, NOT `win`: the enterprise endpoint applies
      // the hourly 07:00→06:00 expansion itself. One day back, so that days
      // `from−1`..`to` expand to exactly the window asked of the archive.
      const [hourly, enterprise] = await Promise.all([
        archiveDataApi.getHourlyCompact(ids, win.from, win.to, NIGHT_HOURS),
        getEnterpriseFetchFn(true, { hours: NIGHT_HOURS })(
          ids,
          addDays(from, -1),
          to,
          'hourly',
          (pr) => setProgress(pollPhaseLabel(pr, t)),
        ).catch(() => []),
      ])

      setProgress(t('phaseCalculating'))
      setRaw({ hourly, enterprise, from, to })
      setUsedLines(reportLines)
    } catch (e) {
      setError((e as Error).message)
      setRaw(null)
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  // The day mode decides which day every hour lands on, so it is applied while
  // the NET map is built — from the data already in hand, not a new request.
  //
  // Clamped to the days the run asked for: the window fetched is a day wider
  // than the report on each side (it has to serve both day modes), and without
  // this the gas day would open with a row for the evening before the period.
  // The range comes from the run, not from the pickers — moving the period
  // without pressing "Сформувати" must not empty the table that is on screen.
  const netMap = useMemo(
    () =>
      raw
        ? buildNetByDayLineHour(raw.hourly, raw.enterprise, {
            dayMode,
            from: raw.from,
            to: raw.to,
          })
        : null,
    [raw, dayMode],
  )

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

  /** Full date, not day/month: the report spans months and '01.07' alone was
   *  ambiguous. Upright and on one line, so nothing gets clipped. */
  const fmtX = (value: string): [string, string] => {
    const d = new Date(value)
    return [isNaN(d.getTime()) ? value : d.toLocaleDateString(getLocale()), '']
  }
  const fmtXLabel = (value: string) => fmtX(value)[0]

  const grid = dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)'
  const axis = dark ? '#9aa7ad' : '#5a6b75'
  // Cap the number of X labels so a long range stays readable.
  const tickInterval = Math.max(0, Math.ceil(rows.length / 24) - 1)

  const exportExcel = () => {
    if (!netMap || !raw) return
    const summary = [
      ['Доба', ...usedLines.map((l) => l.name)],
      ...rows.map((r) => [r.date, ...usedLines.map((l) => r[`line_${l.id}`] ?? '')]),
    ]

    // One sheet per line with the hourly NET flow across the night. Sheet-name
    // length, forbidden characters and collisions are writeSheets' problem.
    const sheets = buildHourlySheets(netMap, rows.map((r) => r.date), usedLines.map((l) => l.id))
    const perLine = usedLines.map((line) => ({
      name: line.name || `line_${line.id}`,
      aoa: [
        ['Доба', ...SHEET_HOURS.map((x) => `${pad(x)}:00`)],
        ...(sheets[line.id] ?? []).map((row) => [
          String(row.date), ...SHEET_HOURS.map((x) => String(row[x] ?? '')),
        ]),
      ],
    }))

    // The day mode is in the name: two files for the same period mean different
    // nights, and nothing inside the workbook says which is which.
    const kind = dayMode === 'calendar' ? 'calendar' : 'gas'
    void writeSheets(`night_consumption_${kind}_${raw.from}_${raw.to}`, [
      { name: 'Зведення', aoa: summary },
      ...perLine,
    ])
  }

  const description = `${
    mode === 'avg23' ? t('nightConsumptionAvgDescription') : t('nightConsumptionNetDescription')
  } · ${dayMode === 'calendar' ? t('nightDayCalendar') : t('nightDayCommercial')}`

  return (
    <ReportShell
      title={t('nightConsumption')}
      description={description}
      onRun={run}
      running={running}
      progress={progress}
      onExport={exportExcel}
      canExport={rows.length > 0}
      error={error}
      controls={
        <>
          {/* Locked while the poll runs. The variant and the period decide what
              is being built, and the header already says "формується" — letting
              either change mid-run would describe a report nobody asked for. */}
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(v) => setMode(v as NightMode)}
            disabled={running}
            data={[
              { value: 'min', label: t('nightReportMin') },
              { value: 'avg23', label: t('nightReportAvg') },
            ]}
          />
          <SegmentedControl
            size="xs"
            value={dayMode}
            onChange={(v) => setDayMode(v as DayMode)}
            disabled={running}
            data={[
              { value: 'commercial', label: t('nightDayCommercialShort') },
              { value: 'calendar', label: t('nightDayCalendarShort') },
            ]}
          />
          <PeriodPicker
            withTime={false}
            disabled={running}
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
      {rows.length > 0 && (
        /*
         * Table and chart are alternatives, not a stack: both want the full
         * width and the full height, and scrolling past a long table to reach
         * the chart was the awkward part. One switch, no scrolling.
         */
        <Paper
          withBorder
          radius="md"
          style={{
            height: 'calc(100dvh - 210px)',
            minHeight: 380,
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
              value={view}
              onChange={(v) => setView(v as 'table' | 'chart')}
              data={[
                { value: 'table', label: t('table') },
                { value: 'chart', label: t('chart') },
              ]}
            />
            {view === 'chart' && (
              <ChartLinePicker lines={pickerLines} hidden={hidden} onChange={setHidden} />
            )}
          </Group>

          {view === 'table' ? (
            <ScrollArea className="hlv-table-scroll" style={{ flex: 1 }} type="auto">
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
                      <Table.Td ta="center" style={{ ...numericStyle, whiteSpace: 'nowrap' }}>
                        {new Date(r.date).toLocaleDateString('uk-UA')}
                      </Table.Td>
                      {usedLines.map((l) => (
                        <Table.Td
                          key={l.id}
                          ta="center"
                          style={{ ...numericStyle, whiteSpace: 'nowrap' }}
                        >
                          {fmt(r[`line_${l.id}`])}
                        </Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          ) : (
            <Box p="md" style={{ flex: 1, minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    interval={tickInterval}
                    tick={<TimeAxisTick format={fmtX} fill={axis} />}
                    height={timeAxisHeight(false)}
                  />
                  <YAxis tick={{ fontSize: 11, fill: axis }} width={72} tickFormatter={(v) => fmt(v)} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--hlv-surface)',
                      border: '1px solid var(--hlv-border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v) => `${fmt(v)} ${t('volumeUnit')}`}
                    labelFormatter={(label) => fmtXLabel(String(label))}
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
            </Box>
          )}
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
