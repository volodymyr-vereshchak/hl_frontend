import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocalStorage } from '@mantine/hooks'
import {
  Paper,
  Text,
  Group,
  SegmentedControl,
  Switch,
  Box,
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
import {
  archiveDataApi,
  archiveDataVirtualApi,
  dpdLineApi,
  type ArchiveRow,
} from '@/api/entities'
import { commercialHourlyRange } from '@/domain/commercialDay'
import { getEnterpriseFetchFn, type PeriodType } from '@/domain/enterpriseVolumes'
import { calculateTrendPercentages, trendColor, type TrendPoint } from '@/domain/grsTrends'
import { writeSheet } from '@/lib/xlsx'
import { useLanguage } from '@/locales/LanguageContext'
import { useSelectionStore } from '@/store/selectionStore'
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

export function GrsTrendsPage() {
  const { t, getLocale } = useLanguage()
  const { colorScheme } = useMantineColorScheme()
  const dark = colorScheme === 'dark'
  const { branchId } = useSelectionStore()
  const { data: lines } = useBranchLines(branchId)

  const initial = defaultRange()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [periodType, setPeriodType] = useState<PeriodType>('daily')
  const [withEnterprise, setWithEnterprise] = useState(false)
  const [data, setData] = useState<TrendPoint[] | null>(null)
  const [usedLines, setUsedLines] = useState<ReportLine[]>([])
  // Which series the user switched off — remembered, like the archive chart.
  const [hidden, setHidden] = useLocalStorage<Record<number, boolean>>({
    key: 'hlv-trends-hidden-lines',
    defaultValue: {},
  })
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Trends only cover lines explicitly flagged for them.
  const trendLines = useMemo(
    () => (lines ?? []).filter((l) => l.include_in_trends),
    [lines],
  )

  const run = async () => {
    if (trendLines.length === 0) {
      setError('Немає ліній з позначкою «у тренди» для цієї філії')
      return
    }
    setRunning(true)
    setError(null)
    setProgress(t('phaseArchives'))
    try {
      const win =
        periodType === 'hourly' ? commercialHourlyRange(from, to) : { from, to }
      const phys = trendLines.filter((l) => l.kind === 'physical').map((l) => l.id)
      const virt = trendLines.filter((l) => l.kind === 'virtual').map((l) => l.id)
      const dpd = trendLines.filter((l) => l.kind === 'dpd').map((l) => l.id)

      const fetchFor = (ids: number[], kind: ReportLine['kind']): Promise<ArchiveRow[]> => {
        if (ids.length === 0) return Promise.resolve([])
        if (kind === 'virtual') {
          return periodType === 'daily'
            ? archiveDataVirtualApi.getDailyData(ids, win.from, win.to)
            : archiveDataVirtualApi.getHourlyData(ids, win.from, win.to)
        }
        if (kind === 'dpd') {
          return periodType === 'daily'
            ? dpdLineApi.getDailyData(ids, win.from, win.to)
            : dpdLineApi.getHourlyData(ids, win.from, win.to)
        }
        return periodType === 'daily'
          ? archiveDataApi.getDailyData(ids, win.from, win.to)
          : archiveDataApi.getHourlyData(ids, win.from, win.to)
      }

      // Collect failures instead of swallowing them, so an empty result can
      // report its cause (e.g. the backend rejecting an over-long range).
      const settled = await Promise.allSettled([
        fetchFor(phys, 'physical'),
        fetchFor(virt, 'virtual'),
        fetchFor(dpd, 'dpd'),
      ])
      const rows = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      const failure = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
      if (rows.length === 0 && failure) throw failure.reason

      let enterprise: Awaited<ReturnType<ReturnType<typeof getEnterpriseFetchFn>>> = []
      if (withEnterprise) {
        setProgress(t('phaseEnterprise'))
        // Bare commercial days here, NOT `win`: the enterprise endpoint does
        // the hourly 07:00→06:00 expansion itself, so an already-expanded
        // window made it expand twice and miss the requested range.
        enterprise = await getEnterpriseFetchFn(true)(
          trendLines.map((l) => l.id),
          from,
          to,
          periodType,
          (pr) => setProgress(pollPhaseLabel(pr, t)),
        ).catch(() => [])
      }

      setProgress(t('phaseCalculating'))
      setData(calculateTrendPercentages(rows, enterprise, periodType))
      setUsedLines(trendLines)
    } catch (e) {
      setError((e as Error).message)
      setData(null)
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  // Flipping the industry switch after a run must show its effect right away —
  // otherwise the toggle looks dead until the button is pressed again.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (data) void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withEnterprise])

  const exportExcel = () => {
    if (!data) return
    const header = ['Період', ...usedLines.map((l) => `${l.name}, %`)]
    const body = data.map((p) => [
      String(p.period),
      ...usedLines.map((l) => Number(p[`line_${l.id}`] ?? 0)),
    ])
    void writeSheet(`grs_trends_${from}_${to}`, 'Тренди', [header, ...body])
  }

  /** Date on the first line, hour on the second — see TimeAxisTick. Daily gets
   *  the full date: the report spans months, and '01.07' alone was ambiguous. */
  const fmtX = (value: string): [string, string] => {
    const d = new Date(value.length === 13 ? `${value}:00:00` : value)
    if (isNaN(d.getTime())) return [value, '']
    const locale = getLocale()
    if (periodType === 'daily') return [d.toLocaleDateString(locale), '']
    return [
      d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }),
      `${pad(d.getHours())}:00`,
    ]
  }
  const fmtXLabel = (value: string) => fmtX(value).filter(Boolean).join(' ')

  const pickerLines = useMemo(
    () => usedLines.map((l, i) => ({ id: l.id, name: l.name, color: trendColor(i, usedLines.length) })),
    [usedLines],
  )

  const grid = dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)'
  const axis = dark ? '#9aa7ad' : '#5a6b75'
  const tickInterval = data ? Math.max(0, Math.ceil(data.length / 24) - 1) : 0

  return (
    <ReportShell
      title={t('grsConsumptionTrends')}
      description={t('grsTracksDescription')}
      onRun={run}
      running={running}
      progress={progress}
      onExport={exportExcel}
      canExport={!!data?.length}
      error={error}
      controls={
        <>
          <SegmentedControl
            size="xs"
            value={periodType}
            onChange={(v) => setPeriodType(v as PeriodType)}
            data={[
              { value: 'daily', label: t('daily') },
              { value: 'hourly', label: t('hourly') },
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
          {/* Flips immediately; the run it triggers reports itself through the
              central spinner. Locked meanwhile so a second flip cannot race it. */}
          <Switch
            size="sm"
            color="grape"
            checked={withEnterprise}
            onChange={(e) => setWithEnterprise(e.currentTarget.checked)}
            disabled={running}
            label={t('enterpriseOverlay')}
            styles={{ label: { whiteSpace: 'nowrap' } }}
          />
        </>
      }
    >
      {data && data.length > 0 && (
        <Paper withBorder radius="md" p="md">
          <Group justify="space-between" mb="sm" wrap="wrap">
            <Text fw={600} ff="'Space Grotesk Variable', sans-serif">
              {t('grsConsumptionTrends')}
            </Text>
            <ChartLinePicker lines={pickerLines} hidden={hidden} onChange={setHidden} />
          </Group>

          <ResponsiveContainer width="100%" height={560}>
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid stroke={grid} strokeDasharray="3 3" />
              <XAxis
                dataKey="period"
                interval={tickInterval}
                tick={<TimeAxisTick format={fmtX} fill={axis} />}
                height={timeAxisHeight(periodType === 'hourly')}
              />
              <YAxis
                tick={{ fontSize: 11, fill: axis }}
                width={56}
                tickCount={12}
                tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--hlv-surface)',
                  border: '1px solid var(--hlv-border)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v) => `${Number(v).toFixed(2)}%`}
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
        </Paper>
      )}

      {data && data.length === 0 && (
        <Box ta="center" py="xl">
          <Text c="dimmed">{t('noDataForPeriod')}</Text>
        </Box>
      )}
    </ReportShell>
  )
}
