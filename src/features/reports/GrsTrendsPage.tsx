import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocalStorage } from '@mantine/hooks'
import {
  Paper,
  Text,
  Group,
  SegmentedControl,
  Switch,
  Box,
  Tooltip as MTooltip,
  useMantineColorScheme,
} from '@mantine/core'
import {
  ComposedChart,
  Area,
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
import {
  calculateTrends,
  indexKey,
  isOutside,
  trendColor,
  trendYCeiling,
  type BandMode,
  type TrendPoint,
} from '@/domain/grsTrends'
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

type EnterpriseRows = Awaited<ReturnType<ReturnType<typeof getEnterpriseFetchFn>>>
type TrendView = 'outliers' | 'all'

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
  // Fetched input of the last run: band and view changes recompute from it
  // without going back to the server.
  const [raw, setRaw] = useState<{
    rows: ArchiveRow[]
    enterprise: EnterpriseRows
    periodType: PeriodType
  } | null>(null)
  const [usedLines, setUsedLines] = useState<ReportLine[]>([])
  // Which series the user switched off — remembered, like the archive chart.
  const [hidden, setHidden] = useLocalStorage<Record<number, boolean>>({
    key: 'hlv-trends-hidden-lines',
    defaultValue: {},
  })
  const [bandSetting, setBandSetting] = useLocalStorage<string>({
    key: 'hlv-trends-band',
    defaultValue: 'auto',
  })
  const [view, setView] = useLocalStorage<TrendView>({
    key: 'hlv-trends-view',
    defaultValue: 'outliers',
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

      let enterprise: EnterpriseRows = []
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
      setRaw({ rows, enterprise, periodType })
      setUsedLines(trendLines)
    } catch (e) {
      setError((e as Error).message)
      setRaw(null)
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
    if (raw) void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withEnterprise])

  const band: BandMode = bandSetting === 'auto' ? 'auto' : Number(bandSetting)
  const result = useMemo(
    () => (raw ? calculateTrends(raw.rows, raw.enterprise, raw.periodType, band) : null),
    [raw, band],
  )
  const data = result?.points ?? null
  const shownType = raw?.periodType ?? periodType

  /** Lines that got an index; in the deviations view only those that left the
   *  band, worst first — they are what the report is for. */
  const indexed = useMemo(
    () => usedLines.filter((l) => result?.stats.has(l.id)),
    [usedLines, result],
  )
  const outlierLines = useMemo(() => {
    if (!result) return []
    const dev = (l: ReportLine) => Math.abs(result.stats.get(l.id)!.maxDeviation)
    return indexed
      .filter((l) => result.stats.get(l.id)!.outliers > 0)
      .sort((a, b) => dev(b) - dev(a))
  }, [indexed, result])
  const chartLines = view === 'outliers' ? outlierLines : indexed
  // Hues spread over the lines actually drawn: ten curves get ten clearly
  // different colours instead of ten neighbours out of a hundred.
  const colorOf = useMemo(() => {
    const m = new Map<number, string>()
    chartLines.forEach((l, i) => m.set(l.id, trendColor(i, chartLines.length)))
    return m
  }, [chartLines])
  const visibleLines = useMemo(
    () => chartLines.filter((l) => !hidden[l.id]),
    [chartLines, hidden],
  )
  const yMax = useMemo(
    () => (data ? trendYCeiling(data, visibleLines.map((l) => l.id)) : 120),
    [data, visibleLines],
  )

  const exportExcel = () => {
    if (!data) return
    const num = (v: unknown) => (typeof v === 'number' ? Number(v.toFixed(2)) : '')
    const header = [
      'Період',
      `${t('trendMedian')}, %`,
      'Нижня межа, %',
      'Верхня межа, %',
      ...indexed.map((l) => `${l.name}, %`),
    ]
    const body = data.map((p) => [
      String(p.period),
      num(p.median),
      Array.isArray(p.band) ? num(p.band[0]) : '',
      Array.isArray(p.band) ? num(p.band[1]) : '',
      ...indexed.map((l) => num(p[indexKey(l.id)])),
    ])
    void writeSheet(`grs_trends_${from}_${to}`, 'Тренди', [header, ...body])
  }

  /** Date on the first line, hour on the second — see TimeAxisTick. Daily gets
   *  the full date: the report spans months, and '01.07' alone was ambiguous. */
  const fmtX = (value: string): [string, string] => {
    const d = new Date(value.length === 13 ? `${value}:00:00` : value)
    if (isNaN(d.getTime())) return [value, '']
    const locale = getLocale()
    if (shownType === 'daily') return [d.toLocaleDateString(locale), '']
    return [
      d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }),
      `${pad(d.getHours())}:00`,
    ]
  }
  const fmtXLabel = (value: string) => fmtX(value).filter(Boolean).join(' ')

  const pickerLines = useMemo(
    () => chartLines.map((l) => ({ id: l.id, name: l.name, color: colorOf.get(l.id)! })),
    [chartLines, colorOf],
  )

  const grid = dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)'
  const axis = dark ? '#9aa7ad' : '#5a6b75'
  const medianColor = dark ? '#e6edf0' : '#22313a'
  const bandColor = dark ? 'rgba(14,143,143,0.30)' : 'rgba(14,143,143,0.16)'
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
          <Group justify="space-between" mb="sm" wrap="wrap" gap="sm">
            <Group gap="sm" wrap="wrap">
              <Text fw={600} ff="'Space Grotesk Variable', sans-serif">
                {t('grsConsumptionTrends')}
              </Text>
              <Text size="xs" c="dimmed">
                {t('trendOutsideBand')}: {outlierLines.length} / {indexed.length}
                {result && result.excluded.length > 0 &&
                  ` · ${result.excluded.length} ${t('trendExcluded')}`}
              </Text>
            </Group>
            <Group gap="sm" wrap="wrap">
              <SegmentedControl
                size="xs"
                value={view}
                onChange={(v) => setView(v as TrendView)}
                data={[
                  { value: 'outliers', label: t('trendShowOutliers') },
                  { value: 'all', label: t('trendShowAll') },
                ]}
              />
              <Group gap={6} wrap="nowrap">
                <Text size="xs" c="dimmed">
                  {t('trendBand')}
                </Text>
                <MTooltip label={t('trendBandAutoHint')} withArrow openDelay={400} multiline w={260}>
                  <div>
                    <SegmentedControl
                      size="xs"
                      value={bandSetting}
                      onChange={setBandSetting}
                      data={[
                        { value: 'auto', label: t('trendBandAuto') },
                        { value: '10', label: '±10%' },
                        { value: '20', label: '±20%' },
                        { value: '30', label: '±30%' },
                      ]}
                    />
                  </div>
                </MTooltip>
              </Group>
              <ChartLinePicker lines={pickerLines} hidden={hidden} onChange={setHidden} />
            </Group>
          </Group>
          {view === 'outliers' && outlierLines.length === 0 && (
            <Text size="sm" c="dimmed" mb="xs">
              {t('trendNoOutliers')}
            </Text>
          )}

          <ResponsiveContainer width="100%" height={560}>
            <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid stroke={grid} strokeDasharray="3 3" />
              <XAxis
                dataKey="period"
                interval={tickInterval}
                tick={<TimeAxisTick format={fmtX} fill={axis} />}
                height={timeAxisHeight(shownType === 'hourly')}
              />
              <YAxis
                tick={{ fontSize: 11, fill: axis }}
                width={56}
                // Capped so one huge spike does not flatten the band; such
                // values run off the top, the tooltip still shows them.
                domain={[0, yMax]}
                allowDataOverflow
                tickCount={12}
                tickFormatter={(v) => `${Math.round(Number(v))}%`}
              />
              <Tooltip
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as TrendPoint | undefined
                  if (!active || !p) return null
                  return (
                    <TrendTooltip
                      point={p}
                      lines={visibleLines}
                      colorOf={colorOf}
                      label={fmtXLabel(String(p.period))}
                      medianColor={medianColor}
                    />
                  )
                }}
              />
              <Area
                dataKey="band"
                name={t('trendBand')}
                stroke="none"
                fill={bandColor}
                fillOpacity={1}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
              />
              {visibleLines.map((l) => (
                <Line
                  key={l.id}
                  type="monotone"
                  dataKey={indexKey(l.id)}
                  name={l.name}
                  stroke={colorOf.get(l.id)}
                  strokeWidth={1.5}
                  strokeOpacity={0.85}
                  dot={(props: { cx?: number; cy?: number; payload?: TrendPoint; index?: number }) => (
                    <OutlierDot key={`${l.id}-${props.index}`} {...props} lid={l.id} color={colorOf.get(l.id)} />
                  )}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
              <Line
                type="monotone"
                dataKey="median"
                name={t('trendMedian')}
                stroke={medianColor}
                strokeWidth={2.5}
                strokeDasharray="6 4"
                dot={false}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
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

/** A dot only where the line is out of the band — the eye goes straight there. */
function OutlierDot({
  cx,
  cy,
  payload,
  lid,
  color,
}: {
  cx?: number
  cy?: number
  payload?: TrendPoint
  lid: number
  color?: string
}) {
  if (cx == null || cy == null || !payload || !isOutside(payload, lid)) return <g />
  return <circle cx={cx} cy={cy} r={3.5} fill={color} stroke="var(--hlv-surface)" strokeWidth={1} />
}

/** Tooltip rows beyond this collapse into "+ N more". */
const TOOLTIP_MAX_ROWS = 8

/**
 * Median, band and only the GRS out of the band at this period, the largest
 * deviation first. Listing all ~100 lines made the old tooltip unreadable.
 */
function TrendTooltip({
  point,
  lines,
  colorOf,
  label,
  medianColor,
}: {
  point: TrendPoint
  lines: ReportLine[]
  colorOf: Map<number, string>
  label: string
  medianColor: string
}) {
  const { t } = useLanguage()
  const med = typeof point.median === 'number' ? point.median : null
  const band = Array.isArray(point.band) ? point.band : null
  const ref = med ?? 100
  const out = lines
    .filter((l) => isOutside(point, l.id))
    .map((l) => ({ line: l, value: point[indexKey(l.id)] as number }))
    .sort((a, b) => Math.abs(b.value - ref) - Math.abs(a.value - ref))
  const fmt = (v: number) => `${v.toFixed(1)}%`

  return (
    <Box
      style={{
        background: 'var(--hlv-surface)',
        border: '1px solid var(--hlv-border)',
        borderRadius: 8,
        padding: '8px 10px',
        minWidth: 220,
        maxWidth: 380,
      }}
    >
      <Text size="xs" fw={600} mb={4}>
        {label}
      </Text>
      {med != null && (
        <Group gap="md" wrap="nowrap" justify="space-between">
          <Text size="xs" fw={600} style={{ color: medianColor }}>
            {t('trendMedian')}
          </Text>
          <Text size="xs" ff="monospace">
            {fmt(med)}
          </Text>
        </Group>
      )}
      {band && (
        <Group gap="md" wrap="nowrap" justify="space-between">
          <Text size="xs" c="dimmed">
            {t('trendBand')}
          </Text>
          <Text size="xs" ff="monospace" c="dimmed">
            {fmt(band[0])} … {fmt(band[1])}
          </Text>
        </Group>
      )}
      <Box mt={6} pt={6} style={{ borderTop: '1px solid var(--hlv-border)' }}>
        {out.length === 0 ? (
          <Text size="xs" c="dimmed">
            {t('trendAllWithin')}
          </Text>
        ) : (
          out.slice(0, TOOLTIP_MAX_ROWS).map(({ line, value }) => {
            const volume = point[`${indexKey(line.id)}_volume`]
            return (
              <Group key={line.id} gap="md" wrap="nowrap" justify="space-between">
                <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                  <Box
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: colorOf.get(line.id),
                      flexShrink: 0,
                    }}
                  />
                  <Text size="xs" lineClamp={1}>
                    {line.name}
                  </Text>
                </Group>
                <Text size="xs" ff="monospace" style={{ whiteSpace: 'nowrap' }}>
                  {fmt(value)}
                  {typeof volume === 'number' && (
                    <Text span size="xs" c="dimmed" ff="monospace">
                      {' '}
                      ({Math.round(volume).toLocaleString()} м³)
                    </Text>
                  )}
                </Text>
              </Group>
            )
          })
        )}
        {out.length > TOOLTIP_MAX_ROWS && (
          <Text size="xs" c="dimmed" mt={2}>
            + {t('trendMore')} {out.length - TOOLTIP_MAX_ROWS}
          </Text>
        )}
      </Box>
    </Box>
  )
}
