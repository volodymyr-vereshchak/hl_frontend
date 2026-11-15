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
  Select,
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

type Mode = 'model' | 'compare'
/** «Модель і тренди» for all stations together. */
const ALL = '__all__'
type View = 'chart' | 'table'

interface Row extends StationDeviation {
  /** The model in line m³ (the 1С scale undone). */
  modelNet: (number | null)[]
}

interface Result {
  days: string[]
  stations: Row[]
  common: (number | null)[]
}

/**
 * Аналітика → «За лініями»: every GRS tied to its trend lines, day by day up
 * to today: the lines' volume less industry against the consumption model.
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
  const [focus, setFocus] = useState<string>(ALL)
  const [mode, setMode] = useLocalStorage<Mode>({
    key: 'hlv-grs-lines-mode2',
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
      const keep = analysis.days.map((d) => d >= from && d <= to)
      const cut = <T,>(xs: T[]) => xs.filter((_, i) => keep[i])
      const stations: Row[] = out.stations.map((s) => {
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
  /** «Модель і тренди»: all stations summed, or the one picked. */
  const compared = useMemo(() => {
    if (!result) return []
    const chosen = focus === ALL ? result.stations : result.stations.filter((s) => s.name === focus)
    return chosen.filter((s) => s.scale != null)
  }, [result, focus])
  const chart = useMemo(() => {
    if (!result) return []
    if (mode === 'model') {
      return result.days.map((day, i) => {
        const row: Record<string, string | number | null> = { period: day }
        result.stations.forEach((s) => {
          row[s.name] = s.week[i] == null ? null : Math.round(s.week[i]! * 10) / 10
        })
        return row
      })
    }
    const sum = (pick: (s: Row) => number | null) => {
      const values = compared.map(pick)
      return !values.length || values.some((v) => v == null)
        ? null
        : values.reduce<number>((a, v) => a + v!, 0)
    }
    const fact = result.days.map((_, i) => sum((s) => s.net[i]))
    const model = result.days.map((_, i) => sum((s) => s.modelNet[i]))
    const ratio = (a: (number | null)[], b: (number | null)[]) =>
      a.map((v, i) =>
        v != null && v > 0 && b[i] != null && b[i]! > 0 ? Math.log(v / b[i]!) : null,
      )
    const daily = ratio(fact, model)
    const vsModel = weekly(daily)
    const round = (v: number | null, d = 0) =>
      v == null ? null : Math.round(v * 10 ** d) / 10 ** d
    return result.days.map((day, i) => ({
      period: day,
      fact: round(fact[i]),
      model: round(model[i]),
      // The day alone, and the 7 days up to it: one day of a village GRS
      // swings by 10 % on its own, the week is what the limit judges.
      vsModelDay: daily[i] == null ? null : round((Math.exp(daily[i]!) - 1) * 100, 1),
      vsModel: round(vsModel[i], 1),
    }))
  }, [result, mode, compared])

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
    model: dark ? '#69db7c' : '#2b8a3e',
    day: dark ? '#91a7ff' : '#748ffc',
    week: dark ? '#ff8787' : '#e03131',
  }
  const colorOf = (k: number) => PALETTE[k % PALETTE.length]
  const fmtX = (value: string): [string, string] => [
    new Date(`${value}T00:00:00`).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }),
    '',
  ]
  const chartHeight = Math.max(420, viewport - CHROME)
  const percent = (v: number) => `${Math.round(Number(v))}%`
  const xAxis = (
    <XAxis
      dataKey="period"
      interval={Math.max(0, Math.ceil(chart.length / 24) - 1)}
      tick={<TimeAxisTick format={fmtX} fill={c.axis} />}
      height={timeAxisHeight(false)}
    />
  )

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
            <Group gap="sm" wrap="wrap">
              <SegmentedControl
                size="xs"
                value={mode}
                onChange={(v) => setMode(v as Mode)}
                data={[
                  { value: 'model', label: t('gmLinesModeModel') },
                  { value: 'compare', label: t('gmLinesModeCompare') },
                ]}
              />
              {mode === 'model' ? (
                <ChartLinePicker
                  lines={result.stations.map((s, k) => ({
                    id: k,
                    name: s.name,
                    color: colorOf(k),
                  }))}
                  hidden={hidden}
                  onChange={setHidden}
                />
              ) : (
                <Select
                  size="xs"
                  w={300}
                  aria-label={t('gmStation')}
                  data={[
                    { value: ALL, label: t('gmAllStations') },
                    ...result.stations.map((s) => ({ value: s.name, label: s.name })),
                  ]}
                  value={focus}
                  onChange={(v) => setFocus(v ?? ALL)}
                  allowDeselect={false}
                  searchable
                />
              )}
            </Group>
            {mode === 'compare' && (
              <Group gap="md">
                <Legend color={c.fact} label={t('gmLinesFact')} />
                <Legend color={c.model} label={t('gmLinesByModel')} dashed />
              </Group>
            )}
          </Group>

          {mode === 'model' && picked.length === 0 && (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              {t('gmLinesPickSome')}
            </Text>
          )}
          {mode === 'model' && picked.length > 0 && (
            <ResponsiveContainer width="100%" height={chartHeight}>
              <LineChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
                {xAxis}
                <YAxis width={64} tick={{ fontSize: 11, fill: c.axis }} tickFormatter={percent} />
                <Tooltip
                  content={({ active, payload, label }) =>
                    active && payload?.length ? (
                      <ChartTip
                        title={fmtDay(String(label), locale)}
                        rows={[...payload]
                          .filter((p) => p.value != null)
                          .sort((a, b) => Math.abs(Number(b.value)) - Math.abs(Number(a.value)))
                          .map((p) => ({
                            color: String(p.stroke ?? p.color),
                            label: String(p.name),
                            value: fmtSigned(Number(p.value), 1, locale),
                          }))}
                      />
                    ) : null
                  }
                />
                <ReferenceLine y={0} stroke={c.axis} strokeDasharray="4 4" />
                <ReferenceLine y={WEEK_LIMIT} stroke="#fa5252" strokeDasharray="2 4" />
                <ReferenceLine y={-WEEK_LIMIT} stroke="#fa5252" strokeDasharray="2 4" />
                {result.stations.map((s, k) =>
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

          {mode === 'compare' && compared.length === 0 && (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              {t('gmLinesNoScale')}
            </Text>
          )}
          {mode === 'compare' && compared.length > 0 && (
            <>
              <ResponsiveContainer width="100%" height={Math.round(chartHeight * 0.6)}>
                <LineChart
                  data={chart}
                  syncId="lines-compare"
                  margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
                  {xAxis}
                  <YAxis
                    width={64}
                    tick={{ fontSize: 11, fill: c.axis }}
                    tickFormatter={(v) => fmtNumber(Number(v), 0, locale)}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      const r = payload?.[0]?.payload as
                        | {
                            fact: number | null
                            model: number | null
                            vsModelDay: number | null
                            vsModel: number | null
                          }
                        | undefined
                      if (!active || !r) return null
                      return (
                        <ChartTip
                          title={fmtDay(String(label), locale)}
                          rows={[
                            {
                              color: c.fact,
                              label: t('gmLinesFact'),
                              value: r.fact == null ? '—' : `${fmtNumber(r.fact, 0, locale)} м³`,
                            },
                            {
                              color: c.model,
                              label: t('gmLinesByModel'),
                              value: r.model == null ? '—' : `${fmtNumber(r.model, 0, locale)} м³`,
                            },
                            {
                              color: c.day,
                              label: t('gmLinesDevDay'),
                              value: fmtSigned(r.vsModelDay, 1, locale),
                            },
                            {
                              color: c.week,
                              label: t('gmLinesDevWeek'),
                              value: fmtSigned(r.vsModel, 1, locale),
                            },
                          ]}
                        />
                      )
                    }}
                  />
                  <Line
                    name={t('gmLinesFact')}
                    dataKey="fact"
                    stroke={c.fact}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    name={t('gmLinesByModel')}
                    dataKey="model"
                    stroke={c.model}
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
              <Group gap="md" mt="sm" mb={4}>
                <Text size="xs" fw={600}>
                  {t('gmLinesCompareDeviation')}, %
                </Text>
                <Legend color={c.day} label={t('gmLinesDevDay')} />
                <Legend color={c.week} label={t('gmLinesDevWeek')} />
              </Group>
              <ResponsiveContainer width="100%" height={Math.round(chartHeight * 0.4)}>
                <LineChart
                  data={chart}
                  syncId="lines-compare"
                  margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
                  {xAxis}
                  <YAxis width={64} tick={{ fontSize: 11, fill: c.axis }} tickFormatter={percent} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      const r = payload?.[0]?.payload as
                        | {
                            fact: number | null
                            model: number | null
                            vsModelDay: number | null
                            vsModel: number | null
                          }
                        | undefined
                      if (!active || !r) return null
                      return (
                        <ChartTip
                          title={fmtDay(String(label), locale)}
                          rows={[
                            {
                              color: c.fact,
                              label: t('gmLinesFact'),
                              value: r.fact == null ? '—' : `${fmtNumber(r.fact, 0, locale)} м³`,
                            },
                            {
                              color: c.model,
                              label: t('gmLinesByModel'),
                              value: r.model == null ? '—' : `${fmtNumber(r.model, 0, locale)} м³`,
                            },
                            {
                              color: c.day,
                              label: t('gmLinesDevDay'),
                              value: fmtSigned(r.vsModelDay, 1, locale),
                            },
                            {
                              color: c.week,
                              label: t('gmLinesDevWeek'),
                              value: fmtSigned(r.vsModel, 1, locale),
                            },
                          ]}
                        />
                      )
                    }}
                  />
                  <ReferenceLine y={0} stroke={c.axis} strokeDasharray="4 4" />
                  <ReferenceLine y={WEEK_LIMIT} stroke="#fa5252" strokeDasharray="2 4" />
                  <ReferenceLine y={-WEEK_LIMIT} stroke="#fa5252" strokeDasharray="2 4" />
                  <Line
                    name={t('gmLinesDevDay')}
                    dataKey="vsModelDay"
                    stroke={c.day}
                    strokeWidth={1}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    name={t('gmLinesDevWeek')}
                    dataKey="vsModel"
                    stroke={c.week}
                    strokeWidth={2.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
          <Text size="xs" c="dimmed" mt="xs">
            {t(mode === 'model' ? 'gmLinesChartNote' : 'gmLinesCompareNote').replace(
              '{n}',
              String(WEEK_LIMIT),
            )}
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
                  <Table.Th ta="right">{t('gmLinesDevModel')}</Table.Th>
                  <Table.Th ta="right">{t('gmDeviationWeek')}</Table.Th>
                  <Table.Th>{t('gmState')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.stations.map((s, k) => {
                  const known = s.net
                    .map((v, i) => (v != null && s.modelNet[i] != null ? i : -1))
                    .filter((i) => i >= 0)
                  const total = (xs: (number | null)[]) => known.reduce((a, i) => a + xs[i]!, 0)
                  const fact = total(s.net)
                  const byModel = total(s.modelNet)
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
                      <Num>{fmtSigned(byModel ? (fact / byModel - 1) * 100 : null, 1, locale)}</Num>
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

/** A tooltip that reads in both themes: the page's surface and text colour,
 *  the series colour only as a swatch. */
function ChartTip({
  title,
  rows,
}: {
  title: string
  rows: { color: string; label: string; value: string }[]
}) {
  return (
    <div
      style={{
        background: 'var(--hlv-surface)',
        border: '1px solid var(--hlv-border)',
        borderRadius: 8,
        padding: '8px 10px',
        minWidth: 220,
        boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
        maxHeight: 360,
        overflow: 'hidden',
      }}
    >
      <Text size="xs" fw={700} mb={4}>
        {title}
      </Text>
      {rows.map((r) => (
        <Group key={r.label} gap="xs" justify="space-between" wrap="nowrap">
          <Group gap={6} wrap="nowrap">
            <span
              style={{ width: 10, height: 10, borderRadius: 2, background: r.color, flex: 'none' }}
            />
            <Text size="xs">{r.label}</Text>
          </Group>
          <Text size="xs" ff={MONO} fw={600}>
            {r.value}
          </Text>
        </Group>
      ))}
    </div>
  )
}
