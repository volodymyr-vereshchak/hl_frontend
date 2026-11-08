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
  calculateTrendPercentages,
  isOutside,
  shareKey,
  trendColor,
  trendLineStats,
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

type TrendView = 'flagged' | 'all'
type EnterpriseRows = Awaited<ReturnType<ReturnType<typeof getEnterpriseFetchFn>>>

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
  // Fetched input of the last run: a corridor change recomputes from it
  // without going back to the server.
  const [raw, setRaw] = useState<{ rows: ArchiveRow[]; enterprise: EnterpriseRows; type: PeriodType } | null>(
    null,
  )
  const [usedLines, setUsedLines] = useState<ReportLine[]>([])
  // Which series the user switched off — remembered, like the archive chart.
  const [hidden, setHidden] = useLocalStorage<Record<number, boolean>>({
    key: 'hlv-trends-hidden-lines',
    defaultValue: {},
  })
  const [view, setView] = useLocalStorage<TrendView>({
    key: 'hlv-trends-view',
    defaultValue: 'all',
  })
  const [bandSetting, setBandSetting] = useLocalStorage<string>({
    key: 'hlv-trends-band',
    defaultValue: 'auto',
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
      setRaw({ rows, enterprise, type: periodType })
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
  const data = useMemo(
    () => (raw ? calculateTrendPercentages(raw.rows, raw.enterprise, raw.type, band) : null),
    [raw, band],
  )
  const dataType = raw?.type ?? periodType

  const stats = useMemo(
    () => (data ? trendLineStats(data, usedLines.map((l) => l.id)) : new Map()),
    [data, usedLines],
  )
  /** Lines that left the branch corridor at least once, most often first. */
  const flaggedLines = useMemo(
    () =>
      usedLines
        .filter((l) => (stats.get(l.id)?.outside ?? 0) > 0)
        .sort((a, b) => stats.get(b.id)!.outside - stats.get(a.id)!.outside),
    [usedLines, stats],
  )
  const flaggedIds = useMemo(() => new Set(flaggedLines.map((l) => l.id)), [flaggedLines])
  const chartLines = view === 'flagged' ? flaggedLines : usedLines
  // Colour goes to the lines that need a look; the rest stay grey context, so
  // a hundred curves no longer compete for attention.
  const colorOf = useMemo(() => {
    const m = new Map<number, string>()
    flaggedLines.forEach((l, i) => m.set(l.id, trendColor(i, flaggedLines.length)))
    return m
  }, [flaggedLines])
  const grey = dark ? 'rgba(200,210,215,0.35)' : 'rgba(60,75,85,0.30)'
  const colorFor = (id: number) => colorOf.get(id) ?? grey
  const visibleLines = useMemo(
    () => chartLines.filter((l) => !hidden[l.id]),
    [chartLines, hidden],
  )
  const yMax = useMemo(
    () => (data ? trendYCeiling(data, visibleLines.map((l) => l.id)) : 1),
    [data, visibleLines],
  )

  const exportExcel = () => {
    if (!data) return
    const num = (v: unknown) => (typeof v === 'number' ? Number(v.toFixed(4)) : '')
    const header = [
      'Період',
      'Медіана філії, %',
      'Коридор від, %',
      'Коридор до, %',
      ...usedLines.map((l) => `${l.name}, %`),
    ]
    const body = data.map((p) => [
      String(p.period),
      num(p.median),
      num(p.band?.[0]),
      num(p.band?.[1]),
      ...usedLines.map((l) => num(p[shareKey(l.id)])),
    ])
    void writeSheet(`grs_trends_${from}_${to}`, 'Тренди', [header, ...body])
  }

  /** Date on the first line, hour on the second — see TimeAxisTick. Daily gets
   *  the full date: the report spans months, and '01.07' alone was ambiguous. */
  const fmtX = (value: string): [string, string] => {
    const d = new Date(value.length === 13 ? `${value}:00:00` : value)
    if (isNaN(d.getTime())) return [value, '']
    const locale = getLocale()
    if (dataType === 'daily') return [d.toLocaleDateString(locale), '']
    return [
      d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }),
      `${pad(d.getHours())}:00`,
    ]
  }
  const fmtXLabel = (value: string) => fmtX(value).filter(Boolean).join(' ')

  const pickerLines = useMemo(
    () => chartLines.map((l) => ({ id: l.id, name: l.name, color: colorOf.get(l.id) ?? grey })),
    [chartLines, colorOf, grey],
  )

  const gridColor = dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)'
  const axis = dark ? '#9aa7ad' : '#5a6b75'
  const bandColor = dark ? 'rgba(14,143,143,0.28)' : 'rgba(14,143,143,0.15)'
  const medianColor = dark ? '#e6edf0' : '#22313a'
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
                {t('trendOutsideCorridor')}: {flaggedLines.length} / {usedLines.length}
              </Text>
            </Group>
            <Group gap="sm" wrap="wrap">
              <SegmentedControl
                size="xs"
                value={view}
                onChange={(v) => setView(v as TrendView)}
                data={[
                  { value: 'all', label: t('trendShowAll') },
                  { value: 'flagged', label: t('trendShowFlagged') },
                ]}
              />
              <Group gap={6} wrap="nowrap">
                <Text size="xs" c="dimmed">
                  {t('trendCorridor')}
                </Text>
                <MTooltip label={t('trendBandAutoHint')} withArrow openDelay={400} multiline w={280}>
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
          {view === 'flagged' && flaggedLines.length === 0 && (
            <Text size="sm" c="dimmed" mb="xs">
              {t('trendAllInside')}
            </Text>
          )}

          <ResponsiveContainer width="100%" height={560}>
            <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
              <XAxis
                dataKey="period"
                interval={tickInterval}
                tick={<TimeAxisTick format={fmtX} fill={axis} />}
                height={timeAxisHeight(dataType === 'hourly')}
              />
              <YAxis
                tick={{ fontSize: 11, fill: axis }}
                width={56}
                // Capped so a lone outlier does not flatten every other curve;
                // it runs off the top, the tooltip still has its value.
                domain={[0, yMax]}
                allowDataOverflow
                tickCount={12}
                tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
              />
              <Tooltip
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as TrendPoint | undefined
                  if (!active || !p) return null
                  return (
                    <TrendTooltip
                      point={p}
                      lines={visibleLines}
                      colorFor={colorFor}
                      medianColor={medianColor}
                      label={fmtXLabel(String(p.period))}
                    />
                  )
                }}
              />
              <Area
                dataKey="band"
                name={t('trendCorridor')}
                stroke="none"
                fill={bandColor}
                fillOpacity={1}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
              />
              {/* Grey context first, so the coloured lines are drawn on top. */}
              {[...visibleLines]
                .sort((a, b) => Number(flaggedIds.has(a.id)) - Number(flaggedIds.has(b.id)))
                .map((l) => {
                  const flagged = flaggedIds.has(l.id)
                  return (
                    <Line
                      key={l.id}
                      type="monotone"
                      dataKey={shareKey(l.id)}
                      name={l.name}
                      stroke={colorFor(l.id)}
                      strokeWidth={flagged ? 2 : 1}
                      dot={
                        flagged
                          ? (props: { cx?: number; cy?: number; payload?: TrendPoint; index?: number }) => (
                              <OutsideDot
                                key={`${l.id}-${props.index}`}
                                {...props}
                                lid={l.id}
                                color={colorFor(l.id)}
                              />
                            )
                          : false
                      }
                      activeDot={flagged ? undefined : false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )
                })}
              <Line
                type="monotone"
                dataKey="median"
                name={t('trendMedian')}
                stroke={medianColor}
                strokeWidth={2}
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

/** A dot only where the line is outside the corridor — the eye goes straight there. */
function OutsideDot({
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
  color: string
}) {
  if (cx == null || cy == null || !payload || !isOutside(payload, lid)) return <g />
  return <circle cx={cx} cy={cy} r={3.5} fill={color} stroke="var(--hlv-surface)" strokeWidth={1} />
}

/** Tooltip rows beyond this collapse into "+ N more". */
const TOOLTIP_MAX_ROWS = 8

/**
 * The branch median and corridor, then only the lines outside it at this
 * period, the furthest out first. Listing every line made the tooltip
 * unreadable once a branch had a hundred of them.
 */
function TrendTooltip({
  point,
  lines,
  colorFor,
  medianColor,
  label,
}: {
  point: TrendPoint
  lines: ReportLine[]
  colorFor: (id: number) => string
  medianColor: string
  label: string
}) {
  const { t } = useLanguage()
  const fmt = (v: unknown) => (typeof v === 'number' ? `${v.toFixed(2)}%` : '—')
  const med = typeof point.median === 'number' ? point.median : null
  const out = lines
    .filter((l) => isOutside(point, l.id))
    .sort((a, b) => {
      const d = (id: number) => Math.abs((point[shareKey(id)] as number) - (med ?? 0))
      return d(b.id) - d(a.id)
    })

  return (
    <Box
      style={{
        background: 'var(--hlv-surface)',
        border: '1px solid var(--hlv-border)',
        borderRadius: 8,
        padding: '8px 10px',
        minWidth: 240,
        maxWidth: 400,
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
      {point.band && (
        <Group gap="md" wrap="nowrap" justify="space-between">
          <Text size="xs" c="dimmed">
            {t('trendCorridor')}
          </Text>
          <Text size="xs" ff="monospace" c="dimmed">
            {fmt(point.band[0])} … {fmt(point.band[1])}
          </Text>
        </Group>
      )}
      <Box mt={6} pt={6} style={{ borderTop: '1px solid var(--hlv-border)' }}>
        {out.length === 0 ? (
          <Text size="xs" c="dimmed">
            {t('trendAllInside')}
          </Text>
        ) : (
          out.slice(0, TOOLTIP_MAX_ROWS).map((l) => {
            const k = shareKey(l.id)
            const volume = point[`${k}_volume`]
            return (
              <Box key={l.id}>
                <Group gap="md" wrap="nowrap" justify="space-between">
                  <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                    <Box
                      style={{ width: 8, height: 8, borderRadius: 2, background: colorFor(l.id), flexShrink: 0 }}
                    />
                    <Text size="xs" lineClamp={1}>
                      {l.name}
                    </Text>
                  </Group>
                  <Text size="xs" ff="monospace" style={{ whiteSpace: 'nowrap' }}>
                    {fmt(point[k])}
                    {typeof volume === 'number' && (
                      <Text span size="xs" c="dimmed" ff="monospace">
                        {' '}
                        ({Math.round(volume).toLocaleString()} м³)
                      </Text>
                    )}
                  </Text>
                </Group>
                {point[`${k}_outlier`] === 1 && (
                  <Text size="xs" c="orange" ta="right">
                    {t('trendOutlierNote')}
                  </Text>
                )}
              </Box>
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
