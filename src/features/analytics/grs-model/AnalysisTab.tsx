import { useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  useMantineColorScheme,
} from '@mantine/core'
import { IconAlertTriangle, IconCalendar, IconFileSpreadsheet } from '@tabler/icons-react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { grsModelApi, type GrsAnalysis, type GrsModelStatus } from '@/api/grsModel'
import { LoadingState } from '@/components/LoadingState'
import { DatePickerInput } from '@mantine/dates'
import { TimeAxisTick, timeAxisHeight } from '@/features/archive/TimeAxisTick'
import { writeSheets } from '@/lib/xlsx'
import { useLanguage } from '@/locales/LanguageContext'
import { fmtDay, fmtNumber, fmtSigned, isoDay, shiftDay } from './format'
import { Tile } from './ModelTab'

const MONO = "'JetBrains Mono Variable', monospace"
/** The row and the chart of all stations together. */
const TOTAL = '__total__'
/** Days of history shown by default, and of forecast after the last fact. */
const DEFAULT_AHEAD = 16
/** Quick periods, in days back from the last day of the GRS figures. */
const PRESETS = { recent: 120, year: 365 } as const
type Preset = keyof typeof PRESETS | 'all'

interface StationRow {
  name: string
  hasModel: boolean
  fact: number | null
  expected: number | null
  deviation: number | null
  week: number | null
  weekLimit: number | null
  level: number | null
  trend: number | null
  alarm: boolean
  excludedDays: number
}

interface ChartRow {
  period: string
  y: number | null
  expected: number | null
  /** The model where there is no fact yet — drawn dashed. */
  ahead: number | null
  week: number | null
  band: [number, number] | null
  level: number | null
  trend: number | null
  excluded: string | null
  forecast: boolean
}

const sum = (values: (number | null)[]) => values.reduce<number>((a, v) => a + (v ?? 0), 0)
const lastOf = (values: (number | null)[]) => {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return i
  return -1
}

function stationRows(data: GrsAnalysis): StationRow[] {
  return data.stations.map((s) => {
    let fact = 0
    let expected = 0
    let days = 0
    for (let i = 0; i < s.y.length; i++) {
      const y = s.y[i]
      const e = s.expected[i]
      if (y == null || e == null) continue
      fact += y
      expected += e
      days++
    }
    const w = lastOf(s.week)
    const l = lastOf(s.level)
    const tr = lastOf(s.trend ?? [])
    return {
      name: s.name,
      hasModel: s.has_model,
      fact: days ? fact : null,
      expected: days ? expected : null,
      deviation: days && expected ? (fact / expected - 1) * 100 : null,
      week: w >= 0 ? s.week[w] : null,
      weekLimit: w >= 0 ? s.week_limit[w] : null,
      level: l >= 0 ? s.level[l] : null,
      trend: tr >= 0 ? s.trend[tr] : null,
      alarm: w >= 0 && s.week_alarm[w],
      excludedDays: s.excluded.filter(Boolean).length,
    }
  })
}

function chartRows(data: GrsAnalysis, selected: string): ChartRow[] {
  const station = data.stations.find((s) => s.name === selected)
  const lastFact = data.last_fact_day
  const rows = data.days.map((day, i): ChartRow => {
    const after = lastFact != null && day > lastFact
    if (!station) {
      return {
        period: day,
        y: data.total.y[i],
        expected: data.total.expected[i],
        ahead: after ? data.total.ahead[i] : null,
        // For the branch as a whole the line is the error all stations share.
        week: data.common[i],
        band: null,
        level: null,
        trend: null,
        excluded: null,
        forecast: data.forecast[i],
      }
    }
    const limit = station.week_limit[i]
    return {
      period: day,
      y: station.y[i],
      expected: station.expected[i],
      ahead: after ? station.model[i] : null,
      week: station.week[i],
      band: limit != null ? [-limit, limit] : null,
      level: station.level[i],
      trend: station.trend?.[i] ?? null,
      excluded: station.excluded[i],
      forecast: data.forecast[i],
    }
  })
  // Start the dashed line where the solid one ends, not a step later.
  const first = rows.findIndex((r) => r.ahead != null)
  if (first > 0 && rows[first - 1].expected != null)
    rows[first - 1].ahead = rows[first - 1].expected
  return rows
}

/**
 * Every station against its model over a period: who departs from it, by how
 * much, since when — and what the model expects for the days the weather
 * forecast reaches.
 */
export function AnalysisTab({ branchId, status }: { branchId: number; status: GrsModelStatus }) {
  const { t, getLocale } = useLanguage()
  const locale = getLocale()
  const dark = useMantineColorScheme().colorScheme === 'dark'
  const anchor = status.inflow?.last ?? isoDay(new Date())
  const start = status.inflow?.first ?? shiftDay(anchor, -PRESETS.year)
  const end = shiftDay(anchor, DEFAULT_AHEAD)
  const presetFrom = (p: Preset) => {
    if (p === 'all') return start
    const d = shiftDay(anchor, -PRESETS[p])
    return d < start ? start : d
  }
  // A year by default: last winter is there to compare with.
  const [from, setFrom] = useState(() => presetFrom('year'))
  const [to, setTo] = useState(end)
  const preset =
    (['recent', 'year', 'all'] as Preset[]).find((p) => from === presetFrom(p) && to === end) ??
    null
  const [selected, setSelected] = useState<string>(TOTAL)

  const query = useQuery({
    queryKey: ['grs-model', 'analysis', branchId, status.fit?.id, from, to],
    queryFn: () => grsModelApi.analysis(branchId, from, to),
    placeholderData: keepPreviousData,
  })
  const data = query.data

  const rows = useMemo(() => {
    if (!data) return []
    const ratio = (r: StationRow) =>
      r.week != null && r.weekLimit ? Math.abs(r.week) / r.weekLimit : 0
    return stationRows(data).sort(
      (a, b) =>
        Number(b.alarm) - Number(a.alarm) ||
        ratio(b) - ratio(a) ||
        a.name.localeCompare(b.name, 'uk'),
    )
  }, [data])
  const active = data?.stations.some((s) => s.name === selected) ? selected : TOTAL
  const chart = useMemo(() => (data ? chartRows(data, active) : []), [data, active])
  const episodes = useMemo(
    () =>
      [...(data?.episodes ?? [])].sort(
        (a, b) => b.end.localeCompare(a.end) || a.grs.localeCompare(b.grs, 'uk'),
      ),
    [data],
  )

  if (query.error) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
        {(query.error as Error).message}
      </Alert>
    )
  }
  if (!data) return <LoadingState py={100} label={t('gmAnalysing')} />

  const totalFact = sum(data.total.y)
  const totalExpected = sum(data.total.expected)
  const after = (i: number) => data.last_fact_day != null && data.days[i] > data.last_fact_day
  const picked = data.stations.find((s) => s.name === active)
  const pickedRow = rows.find((r) => r.name === active)
  const tileFact = picked ? (pickedRow?.fact ?? null) : totalFact
  const tileExpected = picked ? (pickedRow?.expected ?? null) : totalExpected
  const aheadValues = (picked ? picked.model : data.total.ahead).filter(
    (v, i): v is number => v != null && after(i),
  )
  const tileEpisodes = picked ? episodes.filter((e) => e.grs === active) : episodes
  const openEpisodes = tileEpisodes.filter((e) => e.open).length
  const months = data.months.map((m) => m.month)
  const limitOf = new Map(data.stations.map((s) => [s.name, s.month_limit]))

  const c = {
    grid: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
    axis: dark ? '#9aa7ad' : '#5a6b75',
    fact: dark ? '#4dabf7' : '#1c7ed6',
    expected: dark ? '#ced4da' : '#495057',
    ahead: dark ? '#da77f2' : '#9c36b5',
    week: dark ? '#ffa94d' : '#e8590c',
    level: dark ? '#63e6be' : '#0ca678',
    band: dark ? 'rgba(173,181,189,0.18)' : 'rgba(134,142,150,0.18)',
    alarm: dark ? 'rgba(255,107,107,0.20)' : 'rgba(250,82,82,0.14)',
    over: dark ? 'rgba(255,107,107,0.28)' : 'rgba(250,82,82,0.18)',
    under: dark ? 'rgba(77,171,247,0.28)' : 'rgba(28,126,214,0.18)',
    today: dark ? '#e6edf0' : '#22313a',
  }
  const fmtX = (value: string): [string, string] => [
    new Date(`${value}T00:00:00`).toLocaleDateString(locale, {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    }),
    '',
  ]
  const tickInterval = Math.max(0, Math.ceil(chart.length / 20) - 1)
  const xAxis = (
    <XAxis
      dataKey="period"
      interval={tickInterval}
      tick={<TimeAxisTick format={fmtX} fill={c.axis} />}
      height={timeAxisHeight(false)}
    />
  )
  const margin = { top: 6, right: 8, bottom: 0, left: 0 }
  const inRange = (day: string) =>
    day < data.days[0]
      ? data.days[0]
      : day > data.days[data.days.length - 1]
        ? data.days[data.days.length - 1]
        : day
  const marks = active === TOTAL ? [] : episodes.filter((e) => e.grs === active)
  const lastFactShown =
    data.last_fact_day != null &&
    data.days.includes(data.last_fact_day) &&
    data.last_fact_day !== data.days[data.days.length - 1]
  const title = active === TOTAL ? t('gmAllStations') : active

  const tooltip = (
    <Tooltip
      content={({ active: shown, payload }) => {
        const r = payload?.[0]?.payload as ChartRow | undefined
        if (!shown || !r) return null
        const deviation = r.y != null && r.expected ? (r.y / r.expected - 1) * 100 : null
        return (
          <Box
            style={{
              background: 'var(--hlv-surface)',
              border: '1px solid var(--hlv-border)',
              borderRadius: 8,
              padding: '8px 10px',
              minWidth: 220,
            }}
          >
            <Group gap="xs" mb={4} justify="space-between" wrap="nowrap">
              <Text size="xs" fw={600}>
                {fmtDay(r.period, locale)}
              </Text>
              {r.forecast && (
                <Badge size="xs" color="grape" variant="light">
                  {t('gmForecast')}
                </Badge>
              )}
              {r.excluded && (
                <Badge size="xs" color="gray" variant="light">
                  {t(
                    r.excluded === 'missing'
                      ? 'gmExcludedMissing'
                      : r.excluded === 'level'
                        ? 'gmExcludedLevel'
                        : 'gmExcludedShape',
                  )}
                </Badge>
              )}
            </Group>
            <TipRow label={t('gmFact')} value={r.y != null ? fmtNumber(r.y, 1, locale) : null} />
            <TipRow
              label={t('gmExpected')}
              value={r.expected != null ? fmtNumber(r.expected, 1, locale) : null}
            />
            <TipRow
              label={t('gmForecast')}
              value={r.ahead != null && r.y == null ? fmtNumber(r.ahead, 1, locale) : null}
            />
            <TipRow
              label={t('gmDeviationDay')}
              value={deviation != null ? fmtSigned(deviation, 1, locale) : null}
            />
            <TipRow
              label={t(active === TOTAL ? 'gmCommon' : 'gmDeviationWeek')}
              value={r.week != null ? fmtSigned(r.week, 1, locale) : null}
            />
            <TipRow
              label={t('gmWeekLimit')}
              value={r.band ? `± ${fmtNumber(r.band[1], 1, locale)} %` : null}
            />
          </Box>
        )
      }}
    />
  )

  const exportExcel = () => {
    void writeSheets(`grs_model_${from}_${to}`, [
      {
        name: 'ГРС',
        aoa: [
          [
            t('gmStation'),
            `${t('gmFact')}, ${t('gmUnit')}`,
            `${t('gmExpected')}, ${t('gmUnit')}`,
            `${t('gmDeviationPeriod')}, %`,
            `${t('gmDeviationWeek')}, %`,
            `${t('gmWeekLimit')}, %`,
            `${t('gmTrend')}, %`,
            t('gmState'),
          ],
          ...rows.map((r) => [
            r.name,
            round(r.fact),
            round(r.expected),
            round(r.deviation),
            round(r.week),
            round(r.weekLimit),
            round(r.trend),
            t(stateKey(r)),
          ]),
        ],
        cols: [36, 16, 18, 16, 16, 12, 12, 16],
      },
      {
        name: t('gmEpisodes'),
        aoa: [
          [
            t('gmStation'),
            t('gmFrom'),
            t('gmTo'),
            t('gmDays'),
            `${t('gmDeviation')}, %`,
            `${t('gmVolume')}, ${t('gmUnit')}`,
            `${t('gmCommon')}, %`,
            t('gmState'),
          ],
          ...episodes.map((e) => [
            e.grs,
            fmtDay(e.start, locale),
            fmtDay(e.end, locale),
            e.days,
            round(e.deviation),
            round(e.volume),
            round(e.common),
            t(e.open ? 'gmEpisodeOpen' : 'gmEpisodeClosed'),
          ]),
        ],
        cols: [36, 12, 12, 8, 14, 16, 14, 14],
      },
      {
        name: t('gmMonths'),
        aoa: [
          [t('gmStation'), ...months],
          ...data.stations
            .filter((s) => s.has_model)
            .map((s) => [s.name, ...data.months.map((m) => m.values[s.name] ?? null)]),
        ],
      },
    ])
  }

  return (
    <Stack gap="md">
      <Paper withBorder radius="md" p="sm">
        <Group gap="sm" align="flex-end" wrap="wrap">
          <Select
            size="xs"
            w={300}
            label={t('gmStation')}
            data={[
              { value: TOTAL, label: t('gmAllStations') },
              ...[...data.stations]
                .sort((a, b) => a.name.localeCompare(b.name, 'uk'))
                .map((s) => ({ value: s.name, label: s.name })),
            ]}
            value={active}
            onChange={(v) => setSelected(v ?? TOTAL)}
            allowDeselect={false}
            searchable
          />
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
          <SegmentedControl
            size="xs"
            value={preset ?? ''}
            onChange={(v) => {
              setFrom(presetFrom(v as Preset))
              setTo(end)
            }}
            data={[
              { value: 'recent', label: t('gmPresetRecent') },
              { value: 'year', label: t('gmPresetYear') },
              { value: 'all', label: t('gmPresetAll') },
            ]}
          />
          <Text size="xs" c="dimmed" pb={6}>
            {t('gmLastFact')}: {fmtDay(data.last_fact_day, locale)}
            {query.isFetching ? ` · ${t('appLoading')}` : ''}
          </Text>
          <Button
            size="xs"
            variant="light"
            color="teal"
            leftSection={<IconFileSpreadsheet size={15} />}
            onClick={exportExcel}
            ml="auto"
          >
            {t('excel')}
          </Button>
        </Group>
      </Paper>

      <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="sm">
        <Tile label={`${t('gmFact')}, ${t('gmUnit')}`} value={fmtNumber(tileFact, 0, locale)} />
        <Tile
          label={`${t('gmExpected')}, ${t('gmUnit')}`}
          value={fmtNumber(tileExpected, 0, locale)}
        />
        <Tile
          label={t('gmDeviationPeriod')}
          value={
            tileFact != null && tileExpected
              ? fmtSigned((tileFact / tileExpected - 1) * 100, 1, locale)
              : '—'
          }
        />
        <Tile
          label={t('gmEpisodes')}
          value={String(tileEpisodes.length)}
          color={openEpisodes ? 'red' : undefined}
          hint={`${t('gmEpisodeOpen')}: ${openEpisodes}`}
        />
        <Tile
          label={`${t('gmForecast')}, ${t('gmUnit')}`}
          value={aheadValues.length ? fmtNumber(sum(aheadValues), 0, locale) : '—'}
          color={c.ahead}
          hint={
            aheadValues.length ? `${aheadValues.length} ${t('gmDaysShort')}` : t('gmNoForecast')
          }
        />
      </SimpleGrid>

      <Paper withBorder radius="md" p="md">
        <ScrollArea>
          <Table highlightOnHover verticalSpacing={6} fz="xs" miw={900}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('gmStation')}</Table.Th>
                <Table.Th ta="right">
                  {t('gmFact')}, {t('gmUnit')}
                </Table.Th>
                <Table.Th ta="right">
                  {t('gmExpected')}, {t('gmUnit')}
                </Table.Th>
                <Table.Th ta="right">{t('gmDeviationPeriod')}</Table.Th>
                <Table.Th ta="right">{t('gmDeviationWeek')}</Table.Th>
                <Table.Th ta="right">{t('gmWeekLimit')}</Table.Th>
                <Table.Th ta="right">{t('gmTrend')}</Table.Th>
                <Table.Th>{t('gmState')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              <Table.Tr
                onClick={() => setSelected(TOTAL)}
                style={{
                  cursor: 'pointer',
                  background: active === TOTAL ? 'var(--hlv-surface-2)' : undefined,
                }}
              >
                <Table.Td fw={700}>{t('gmAllStations')}</Table.Td>
                <Num>{fmtNumber(totalFact, 1, locale)}</Num>
                <Num>{fmtNumber(totalExpected, 1, locale)}</Num>
                <Num>
                  {totalExpected
                    ? fmtSigned((totalFact / totalExpected - 1) * 100, 1, locale)
                    : '—'}
                </Num>
                <Table.Td colSpan={4} />
              </Table.Tr>
              {rows.map((r) => (
                <Table.Tr
                  key={r.name}
                  onClick={() => setSelected(r.name)}
                  style={{
                    cursor: 'pointer',
                    background: active === r.name ? 'var(--hlv-surface-2)' : undefined,
                  }}
                >
                  <Table.Td fw={500}>{r.name}</Table.Td>
                  <Num>{fmtNumber(r.fact, 1, locale)}</Num>
                  <Num>{fmtNumber(r.expected, 1, locale)}</Num>
                  <Num>{fmtSigned(r.deviation, 1, locale)}</Num>
                  <Table.Td
                    ta="right"
                    ff={MONO}
                    fw={r.alarm ? 700 : undefined}
                    c={r.alarm ? 'red' : undefined}
                  >
                    {fmtSigned(r.week, 1, locale)}
                  </Table.Td>
                  <Num>
                    {r.weekLimit != null ? `± ${fmtNumber(r.weekLimit, 1, locale)} %` : '—'}
                  </Num>
                  <Num>{fmtSigned(r.trend, 1, locale)}</Num>
                  <Table.Td>
                    <Badge
                      size="xs"
                      variant="light"
                      color={r.alarm ? 'red' : !r.hasModel || r.fact == null ? 'gray' : 'teal'}
                    >
                      {t(stateKey(r))}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        <Text size="xs" c="dimmed" mt="sm">
          {t('gmTableNote')}
        </Text>
      </Paper>

      <Paper withBorder radius="md" p="md">
        <Group justify="space-between" mb="xs" wrap="wrap" gap="xs">
          <Text fw={600}>
            {title} — {t('gmChartVolume')}, {t('gmUnit')}
          </Text>
          <Group gap="md">
            <Legend color={c.fact} label={t('gmFact')} />
            <Legend color={c.expected} label={t('gmExpected')} />
            <Legend color={c.ahead} label={t('gmForecast')} dashed />
            {marks.length > 0 && <Legend color={c.alarm} label={t('gmEpisodes')} block />}
          </Group>
        </Group>
        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart data={chart} margin={margin}>
            <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
            {xAxis}
            <YAxis yAxisId="v" width={56} tick={{ fontSize: 11, fill: c.axis }} />
            {tooltip}
            {marks.map((e) => (
              <ReferenceArea
                key={`${e.start}${e.end}`}
                yAxisId="v"
                x1={inRange(e.start)}
                x2={inRange(e.end)}
                fill={c.alarm}
                stroke="none"
                ifOverflow="visible"
              />
            ))}
            {lastFactShown && (
              <ReferenceLine
                yAxisId="v"
                x={data.last_fact_day!}
                stroke={c.today}
                strokeWidth={1.5}
                label={{
                  value: t('gmLastFact'),
                  position: 'insideTopRight',
                  fill: c.today,
                  fontSize: 11,
                }}
              />
            )}
            <Line
              yAxisId="v"
              dataKey="expected"
              stroke={c.expected}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              yAxisId="v"
              dataKey="ahead"
              stroke={c.ahead}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              yAxisId="v"
              dataKey="y"
              stroke={c.fact}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>

        <Group justify="space-between" mt="md" mb="xs" wrap="wrap" gap="xs">
          <Text fw={600}>{t(active === TOTAL ? 'gmChartCommon' : 'gmChartDeviation')}, %</Text>
          {active !== TOTAL && (
            <Group gap="md">
              <Legend color={c.week} label={t('gmDeviationWeek')} />
              <Legend color={c.band} label={t('gmWeekLimit')} block />
              <Legend color={c.level} label={t('gmTrend')} dashed />
            </Group>
          )}
        </Group>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={chart} margin={margin}>
            <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
            {xAxis}
            <YAxis
              yAxisId="d"
              width={56}
              tick={{ fontSize: 11, fill: c.axis }}
              tickFormatter={(v) => `${Math.round(Number(v))}%`}
            />
            {tooltip}
            <Area
              yAxisId="d"
              dataKey="band"
              stroke="none"
              fill={c.band}
              fillOpacity={1}
              activeDot={false}
              isAnimationActive={false}
            />
            <ReferenceLine yAxisId="d" y={0} stroke={c.axis} strokeDasharray="4 4" />
            <Line
              yAxisId="d"
              dataKey="trend"
              stroke={c.level}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              yAxisId="d"
              dataKey="week"
              stroke={c.week}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
        <Text size="xs" c="dimmed" mt="xs">
          {t(active === TOTAL ? 'gmChartCommonNote' : 'gmChartDeviationNote')}
        </Text>
      </Paper>

      <Paper withBorder radius="md" p="md">
        <Text fw={600} mb="xs">
          {t('gmEpisodes')}
        </Text>
        {episodes.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t('gmNoEpisodes')}
          </Text>
        ) : (
          <ScrollArea>
            <Table highlightOnHover verticalSpacing={6} fz="xs" miw={820}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('gmStation')}</Table.Th>
                  <Table.Th>{t('gmFrom')}</Table.Th>
                  <Table.Th>{t('gmTo')}</Table.Th>
                  <Table.Th ta="right">{t('gmDays')}</Table.Th>
                  <Table.Th ta="right">{t('gmDeviation')}</Table.Th>
                  <Table.Th ta="right">
                    {t('gmVolume')}, {t('gmUnit')}
                  </Table.Th>
                  <Table.Th ta="right">{t('gmCommon')}</Table.Th>
                  <Table.Th>{t('gmState')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {episodes.map((e) => (
                  <Table.Tr
                    key={`${e.grs}${e.start}`}
                    onClick={() => setSelected(e.grs)}
                    style={{ cursor: 'pointer' }}
                  >
                    <Table.Td fw={500}>{e.grs}</Table.Td>
                    <Table.Td ff={MONO}>{fmtDay(e.start, locale)}</Table.Td>
                    <Table.Td ff={MONO}>{fmtDay(e.end, locale)}</Table.Td>
                    <Num>{e.days}</Num>
                    <Table.Td
                      ta="right"
                      ff={MONO}
                      fw={600}
                      c={(e.deviation ?? 0) > 0 ? 'red' : 'blue'}
                    >
                      {fmtSigned(e.deviation, 1, locale)}
                    </Table.Td>
                    <Num>{fmtSigned(e.volume, 1, locale).replace(' %', '')}</Num>
                    <Num>{fmtSigned(e.common, 1, locale)}</Num>
                    <Table.Td>
                      <Badge size="xs" variant="light" color={e.open ? 'red' : 'gray'}>
                        {t(e.open ? 'gmEpisodeOpen' : 'gmEpisodeClosed')}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
        <Text size="xs" c="dimmed" mt="sm">
          {t('gmEpisodesNote')}
        </Text>
      </Paper>

      {months.length > 0 && (
        <Paper withBorder radius="md" p="md">
          <Text fw={600} mb="xs">
            {t('gmMonths')}, %
          </Text>
          <ScrollArea>
            <Table verticalSpacing={5} fz="xs" withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th miw={220}>{t('gmStation')}</Table.Th>
                  {months.map((m) => (
                    <Table.Th key={m} ta="right" miw={70}>
                      {m.slice(5)}.{m.slice(0, 4)}
                    </Table.Th>
                  ))}
                  <Table.Th ta="right" miw={70}>
                    {t('gmMonthLimit')}
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.stations
                  .filter((s) => s.has_model)
                  .map((s) => {
                    const limit = limitOf.get(s.name) ?? null
                    return (
                      <Table.Tr
                        key={s.name}
                        onClick={() => setSelected(s.name)}
                        style={{ cursor: 'pointer' }}
                      >
                        <Table.Td fw={500}>{s.name}</Table.Td>
                        {data.months.map((m) => {
                          const v = m.values[s.name]
                          const out = v != null && limit != null && Math.abs(v) > limit
                          return (
                            <Table.Td
                              key={m.month}
                              ta="right"
                              ff={MONO}
                              fw={out ? 700 : undefined}
                              style={{ background: out ? (v > 0 ? c.over : c.under) : undefined }}
                            >
                              {v != null ? fmtSigned(v, 1, locale).replace(' %', '') : '—'}
                            </Table.Td>
                          )
                        })}
                        <Num>{limit != null ? `± ${fmtNumber(limit, 1, locale)}` : '—'}</Num>
                      </Table.Tr>
                    )
                  })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          <Text size="xs" c="dimmed" mt="sm">
            {t('gmMonthsNote')}
          </Text>
        </Paper>
      )}
    </Stack>
  )
}

const round = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10)

function stateKey(r: StationRow) {
  if (!r.hasModel) return 'gmStateNoModel' as const
  if (r.fact == null) return 'gmStateNoData' as const
  return r.alarm ? ('gmStateAlarm' as const) : ('gmStateOk' as const)
}

function Num({ children }: { children: React.ReactNode }) {
  return (
    <Table.Td ta="right" ff={MONO}>
      {children}
    </Table.Td>
  )
}

function TipRow({ label, value }: { label: string; value: string | null }) {
  if (value == null) return null
  return (
    <Group gap="md" justify="space-between" wrap="nowrap">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="xs" ff="monospace">
        {value}
      </Text>
    </Group>
  )
}

function Legend({
  color,
  label,
  dashed,
  block,
}: {
  color: string
  label: string
  dashed?: boolean
  block?: boolean
}) {
  return (
    <Group gap={6} wrap="nowrap">
      <Box
        style={
          block
            ? { width: 14, height: 10, background: color, borderRadius: 2 }
            : { width: 18, height: 0, borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }
        }
      />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  )
}
