import { useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  useMantineColorScheme,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useLocalStorage, useViewportSize } from '@mantine/hooks'
import {
  IconAlertTriangle,
  IconCalendar,
  IconInfoCircle,
  IconPlayerPlay,
} from '@tabler/icons-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { archiveDataApi, archiveDataVirtualApi, dpdLineApi } from '@/api/entities'
import { grsModelApi, type GrsModelStatus } from '@/api/grsModel'
import { LoadingState } from '@/components/LoadingState'
import { buildEnterpriseByLinePeriod, getEnterpriseFetchFn } from '@/domain/enterpriseVolumes'
import {
  lineDeviation,
  lineKey,
  trendExpectation,
  weekly,
  type LineRef,
  type StationDeviation,
} from '@/domain/grsLineDeviation'
import { TimeAxisTick, timeAxisHeight } from '@/features/archive/TimeAxisTick'
import { ChartLinePicker } from '@/features/reports/ChartLinePicker'
import { pollPhaseLabel } from '@/features/reports/pollPhase'
import { useLanguage } from '@/locales/LanguageContext'
import { fmtDay, fmtNumber, fmtSigned, isoDay, shiftDay } from './format'

const MONO = "'JetBrains Mono Variable', monospace"
/** A week off by more than this is marked. */
const WEEK_LIMIT = 15
/** Line data fetched before the 1С figures end, to set each station's scale. */
const CALIBRATION_BACK = 70
/** Days fetched before the period, so its first week already has a mean. */
const WEEK_RUN_UP = 7
/** Height of everything above the chart, px: the chart takes the rest of the screen. */
const CHROME = 330
const PALETTE = [
  '#1c7ed6',
  '#e8590c',
  '#2f9e44',
  '#ae3ec9',
  '#f08c00',
  '#0ca678',
  '#d6336c',
  '#5c7cfa',
  '#868e96',
  '#74b816',
  '#fa5252',
  '#15aabf',
  '#7950f2',
]

type Mode = 'model' | 'trends' | 'volume'
type View = 'chart' | 'table'

interface Row extends StationDeviation {
  /** What the trends report expects of the station, m³. */
  trend: (number | null)[]
  /** The model in line m³ (the 1С scale undone). */
  modelNet: (number | null)[]
  /** Weekly deviation of the lines from the trends expectation, %. */
  trendWeek: (number | null)[]
}

interface Result {
  days: string[]
  stations: Row[]
  common: (number | null)[]
}

/**
 * Аналітика → «За лініями»: every GRS tied to its trend lines, day by day up
 * to today, against two predictions — the consumption model, and what the
 * trends report expects (the station moving with the rest of the branch).
 * See domain/grsLineDeviation.
 */
export function LinesTab({ branchId, status }: { branchId: number; status: GrsModelStatus }) {
  const { t, getLocale } = useLanguage()
  const locale = getLocale()
  const dark = useMantineColorScheme().colorScheme === 'dark'
  const { height: viewport } = useViewportSize()
  const today = isoDay(new Date())
  const [from, setFrom] = useState(shiftDay(today, -60))
  const [to, setTo] = useState(today)
  const [withIndustry, setWithIndustry] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [hidden, setHidden] = useState<Record<number, boolean>>({})
  const [mode, setMode] = useLocalStorage<Mode>({
    key: 'hlv-grs-lines-mode',
    defaultValue: 'model',
  })
  const [view, setView] = useLocalStorage<View>({
    key: 'hlv-grs-lines-view',
    defaultValue: 'chart',
  })

  const mapped = status.stations.filter((s) => s.enabled && s.lines?.length)

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      // Reach back into the 1С days for the scale, and a week before the
      // period for its first weekly mean.
      const lastOneC = status.inflow?.last ?? from
      const fetchFrom = [
        shiftDay(from, -WEEK_RUN_UP),
        shiftDay(lastOneC, -CALIBRATION_BACK),
      ].sort()[0]
      const lines: LineRef[] = mapped.flatMap((s) => s.lines as LineRef[])
      const ids = (kind: LineRef['kind']) => [
        ...new Set(lines.filter((l) => l.kind === kind).map((l) => l.id)),
      ]

      setProgress(t('phaseArchives'))
      const [phys, virt, dpd, analysis] = await Promise.all([
        ids('physical').length ? archiveDataApi.getDailyData(ids('physical'), fetchFrom, to) : [],
        ids('virtual').length
          ? archiveDataVirtualApi.getDailyData(ids('virtual'), fetchFrom, to)
          : [],
        ids('dpd').length ? dpdLineApi.getDailyData(ids('dpd'), fetchFrom, to) : [],
        grsModelApi.analysis(branchId, fetchFrom, to),
      ])
      const archive: Record<string, Record<string, number>> = {}
      const put = (
        kind: LineRef['kind'],
        rows: { line_id?: number; period?: unknown; volume?: number | null }[],
      ) => {
        for (const r of rows) {
          if (r.line_id == null || r.volume == null) continue
          const day = String(r.period).slice(0, 10)
          const key = lineKey({ kind, id: r.line_id })
          ;(archive[key] ??= {})[day] = (archive[key][day] ?? 0) + r.volume
        }
      }
      put('physical', phys)
      put('virtual', virt)
      put('dpd', dpd)

      let industry: Record<number, Record<string, number>> | null = null
      if (withIndustry) {
        setProgress(t('phaseEnterprise'))
        // The same call the trends report makes, so the two agree.
        const records = await getEnterpriseFetchFn(true)(
          [...new Set(lines.map((l) => l.id))],
          fetchFrom,
          to,
          'daily',
          (p) => setProgress(pollPhaseLabel(p, t)),
        ).catch(() => [])
        industry = buildEnterpriseByLinePeriod(records, 'daily')
      }

      setProgress(t('phaseCalculating'))
      const out = lineDeviation({
        days: analysis.days,
        stations: analysis.stations.map((s) => ({ name: s.name, y: s.y, model: s.model })),
        mapped: mapped.map((s) => ({ name: s.name, lines: s.lines as LineRef[] })),
        archive,
        industry,
      })
      // The trends expectation is taken over the period shown plus the week
      // before it — as the trends report would, over its own range.
      const window = analysis.days.map((d) => d >= shiftDay(from, -WEEK_RUN_UP) && d <= to)
      const expected = trendExpectation(
        out.stations.map((s) => s.net.map((v, i) => (window[i] ? v : null))),
      )
      const keep = analysis.days.map((d) => d >= from && d <= to)
      const cut = <T,>(xs: T[]) => xs.filter((_, i) => keep[i])
      const stations: Row[] = out.stations.map((s, k) => {
        const trendLog = s.net.map((v, i) => {
          const e = expected[k][i]
          return v != null && v > 0 && e != null && e > 0 ? Math.log(v / e) : null
        })
        return {
          ...s,
          estimate: cut(s.estimate),
          model: cut(s.model),
          deviation: cut(s.deviation),
          week: cut(s.week),
          net: cut(s.net),
          modelNet: cut(
            s.model.map((m) => (m == null || s.scale == null ? null : (m * 1000) / s.scale)),
          ),
          trend: cut(expected[k]),
          trendWeek: cut(weekly(trendLog)),
        }
      })
      setResult({ days: cut(analysis.days), stations, common: cut(out.common) })
      // The five furthest from their model shown at first.
      const worst = new Set(
        stations
          .map((s, k) => ({ k, off: Math.abs(lastOf(s.week) ?? 0) }))
          .sort((a, b) => b.off - a.off)
          .slice(0, 5)
          .map((x) => x.k),
      )
      setHidden(Object.fromEntries(stations.map((_, k) => [k, !worst.has(k)])))
    } catch (e) {
      setError((e as Error).message)
      setResult(null)
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  const picked = useMemo(
    () => (result ? result.stations.filter((_, k) => !hidden[k]) : []),
    [result, hidden],
  )
  const chart = useMemo(() => {
    if (!result) return []
    return result.days.map((day, i) => {
      const row: Record<string, string | number | null> = { period: day }
      if (mode === 'volume') {
        const sum = (pick: (s: Row) => number | null) => {
          const values = picked.map(pick)
          return !values.length || values.some((v) => v == null)
            ? null
            : Math.round(values.reduce<number>((a, v) => a + v!, 0))
        }
        row.fact = sum((s) => s.net[i])
        row.model = sum((s) => s.modelNet[i])
        row.trend = sum((s) => s.trend[i])
      } else {
        result.stations.forEach((s) => {
          const v = mode === 'model' ? s.week[i] : s.trendWeek[i]
          row[s.name] = v == null ? null : Math.round(v * 10) / 10
        })
      }
      return row
    })
  }, [result, mode, picked])

  if (!mapped.length) {
    return (
      <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
        {t('gmLinesNone')}
      </Alert>
    )
  }

  const c = {
    grid: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
    axis: dark ? '#9aa7ad' : '#5a6b75',
    fact: dark ? '#4dabf7' : '#1c7ed6',
    model: dark ? '#ced4da' : '#495057',
    trend: dark ? '#ffa94d' : '#e8590c',
  }
  const colorOf = (k: number) => PALETTE[k % PALETTE.length]
  const fmtX = (value: string): [string, string] => [
    new Date(`${value}T00:00:00`).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }),
    '',
  ]
  const chartHeight = Math.max(360, viewport - CHROME)

  return (
    <Stack gap="md">
      <Paper withBorder radius="md" p="sm">
        <Group gap="sm" align="flex-end" wrap="wrap">
          <DatePickerInput
            size="xs"
            w={140}
            label={t('gmFrom')}
            leftSection={<IconCalendar size={15} />}
            valueFormat="DD.MM.YYYY"
            value={from}
            maxDate={to}
            onChange={(v) => v && setFrom(v)}
            popoverProps={{ zIndex: 500, withinPortal: true }}
          />
          <DatePickerInput
            size="xs"
            w={140}
            label={t('gmTo')}
            leftSection={<IconCalendar size={15} />}
            valueFormat="DD.MM.YYYY"
            value={to}
            minDate={from}
            onChange={(v) => v && setTo(v)}
            popoverProps={{ zIndex: 500, withinPortal: true }}
          />
          <Checkbox
            size="xs"
            pb={6}
            label={t('gmLinesIndustry')}
            checked={withIndustry}
            onChange={(e) => setWithIndustry(e.currentTarget.checked)}
          />
          <Button
            size="xs"
            leftSection={<IconPlayerPlay size={15} />}
            onClick={run}
            disabled={running}
          >
            {t('loadAccidentsData')}
          </Button>
          {result && (
            <>
              <SegmentedControl
                size="xs"
                value={view}
                onChange={(v) => setView(v as View)}
                data={[
                  { value: 'chart', label: t('weatherViewChart') },
                  { value: 'table', label: t('weatherViewTable') },
                ]}
              />
              <ChartLinePicker
                lines={result.stations.map((s, k) => ({ id: k, name: s.name, color: colorOf(k) }))}
                hidden={hidden}
                onChange={setHidden}
              />
            </>
          )}
          <Text size="xs" c="dimmed" pb={6} ml="auto">
            {t('gmLinesMapped')}: {mapped.length}
          </Text>
        </Group>
      </Paper>

      {error && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          {error}
        </Alert>
      )}
      {running && <LoadingState py={80} label={progress ?? t('appLoading')} />}

      {result && !running && view === 'chart' && (
        <Paper withBorder radius="md" p="md">
          <Group justify="space-between" mb="xs" wrap="wrap" gap="sm">
            <SegmentedControl
              size="xs"
              value={mode}
              onChange={(v) => setMode(v as Mode)}
              data={[
                { value: 'model', label: t('gmLinesModeModel') },
                { value: 'trends', label: t('gmLinesModeTrends') },
                { value: 'volume', label: t('gmLinesModeVolume') },
              ]}
            />
            {mode === 'volume' && (
              <Group gap="md">
                <Legend color={c.fact} label={t('gmLinesFact')} />
                <Legend color={c.model} label={t('gmLinesByModel')} dashed />
                <Legend color={c.trend} label={t('gmLinesByTrends')} dashed />
              </Group>
            )}
          </Group>
          {picked.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              {t('gmLinesPickSome')}
            </Text>
          ) : (
            <ResponsiveContainer width="100%" height={chartHeight}>
              <LineChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
                <XAxis
                  dataKey="period"
                  interval={Math.max(0, Math.ceil(chart.length / 24) - 1)}
                  tick={<TimeAxisTick format={fmtX} fill={c.axis} />}
                  height={timeAxisHeight(false)}
                />
                <YAxis
                  width={64}
                  tick={{ fontSize: 11, fill: c.axis }}
                  tickFormatter={(v) =>
                    mode === 'volume'
                      ? fmtNumber(Number(v), 0, locale)
                      : `${Math.round(Number(v))}%`
                  }
                />
                <Tooltip
                  formatter={(v, name) => [
                    mode === 'volume' ? `${fmtNumber(Number(v), 0, locale)} м³` : `${v ?? '—'} %`,
                    String(name),
                  ]}
                  labelFormatter={(l) => fmtDay(String(l), locale)}
                />
                {mode !== 'volume' && <ReferenceLine y={0} stroke={c.axis} strokeDasharray="4 4" />}
                {mode !== 'volume' && (
                  <ReferenceLine y={WEEK_LIMIT} stroke="#fa5252" strokeDasharray="2 4" />
                )}
                {mode !== 'volume' && (
                  <ReferenceLine y={-WEEK_LIMIT} stroke="#fa5252" strokeDasharray="2 4" />
                )}
                {mode === 'volume' && (
                  <Line
                    name={t('gmLinesFact')}
                    dataKey="fact"
                    stroke={c.fact}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                {mode === 'volume' && (
                  <Line
                    name={t('gmLinesByModel')}
                    dataKey="model"
                    stroke={c.model}
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                {mode === 'volume' && (
                  <Line
                    name={t('gmLinesByTrends')}
                    dataKey="trend"
                    stroke={c.trend}
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                {mode !== 'volume' &&
                  result.stations.map((s, k) =>
                    hidden[k] ? null : (
                      <Line
                        key={s.name}
                        dataKey={s.name}
                        stroke={colorOf(k)}
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    ),
                  )}
              </LineChart>
            </ResponsiveContainer>
          )}
          <Text size="xs" c="dimmed" mt="xs">
            {t(
              mode === 'model'
                ? 'gmLinesChartNote'
                : mode === 'trends'
                  ? 'gmLinesTrendsNote'
                  : 'gmLinesVolumeNote',
            )
              .replace('{n}', String(WEEK_LIMIT))
              .replace('{k}', String(picked.length))}
          </Text>
        </Paper>
      )}

      {result && !running && view === 'table' && (
        <Paper withBorder radius="md" p="md">
          <ScrollArea>
            <Table striped highlightOnHover verticalSpacing={6} fz="xs" miw={1040}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('gmStation')}</Table.Th>
                  <Table.Th ta="right">{t('gmLinesScale')}</Table.Th>
                  <Table.Th ta="right">{t('gmLinesFact')}, м³</Table.Th>
                  <Table.Th ta="right">{t('gmLinesByModel')}, м³</Table.Th>
                  <Table.Th ta="right">{t('gmLinesByTrends')}, м³</Table.Th>
                  <Table.Th ta="right">{t('gmLinesDevModel')}</Table.Th>
                  <Table.Th ta="right">{t('gmLinesDevTrends')}</Table.Th>
                  <Table.Th ta="right">{t('gmDeviationWeek')}</Table.Th>
                  <Table.Th>{t('gmState')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.stations.map((s, k) => {
                  const known = s.net
                    .map((v, i) =>
                      v != null && s.modelNet[i] != null && s.trend[i] != null ? i : -1,
                    )
                    .filter((i) => i >= 0)
                  const total = (xs: (number | null)[]) => known.reduce((a, i) => a + xs[i]!, 0)
                  const fact = total(s.net)
                  const byModel = total(s.modelNet)
                  const byTrend = total(s.trend)
                  const week = lastOf(s.week)
                  const off = week != null && Math.abs(week) > WEEK_LIMIT
                  return (
                    <Table.Tr key={s.name}>
                      <Table.Td fw={500}>
                        <Group gap={6} wrap="nowrap">
                          <span
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 2,
                              background: colorOf(k),
                            }}
                          />
                          {s.name}
                        </Group>
                      </Table.Td>
                      <Table.Td ta="right" ff={MONO}>
                        {s.scale == null
                          ? '—'
                          : `${fmtNumber(s.scale, 3, locale)} (${s.calibrationDays} ${t('gmDaysShort')})`}
                      </Table.Td>
                      <Num>{known.length ? fmtNumber(fact, 0, locale) : '—'}</Num>
                      <Num>{known.length ? fmtNumber(byModel, 0, locale) : '—'}</Num>
                      <Num>{known.length ? fmtNumber(byTrend, 0, locale) : '—'}</Num>
                      <Num>{fmtSigned(byModel ? (fact / byModel - 1) * 100 : null, 1, locale)}</Num>
                      <Num>{fmtSigned(byTrend ? (fact / byTrend - 1) * 100 : null, 1, locale)}</Num>
                      <Table.Td
                        ta="right"
                        ff={MONO}
                        fw={off ? 700 : undefined}
                        c={off ? 'red' : undefined}
                      >
                        {fmtSigned(week, 1, locale)}
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          size="xs"
                          variant="light"
                          color={s.scale == null ? 'gray' : off ? 'red' : 'teal'}
                        >
                          {t(
                            s.scale == null ? 'gmLinesNoScale' : off ? 'gmStateAlarm' : 'gmStateOk',
                          )}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          <Text size="xs" c="dimmed" mt="sm">
            {t('gmLinesNote')}
          </Text>
        </Paper>
      )}
    </Stack>
  )
}

function lastOf(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return values[i]
  return null
}

function Num({ children }: { children: React.ReactNode }) {
  return (
    <Table.Td ta="right" ff={MONO}>
      {children}
    </Table.Td>
  )
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <Group gap={6} wrap="nowrap">
      <span
        style={{ width: 18, height: 0, borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }}
      />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  )
}
