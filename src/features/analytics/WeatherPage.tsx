import { useEffect, useMemo, useState } from 'react'
import { useLocalStorage } from '@mantine/hooks'
import {
  Badge,
  Box,
  Group,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Table,
  Text,
  useMantineColorScheme,
} from '@mantine/core'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { weatherApi, type WeatherPoint } from '@/api/weather'
import { FORECAST_DAYS } from '@/domain/weather/openMeteo'
import type { PeriodType } from '@/domain/enterpriseVolumes'
import { TablePagination } from '@/components/TablePagination'
import { PeriodPicker } from '@/features/archive/PeriodPicker'
import { TimeAxisTick, timeAxisHeight } from '@/features/archive/TimeAxisTick'
import { ReportShell } from '@/features/reports/ReportShell'
import { writeSheet } from '@/lib/xlsx'
import { useLanguage } from '@/locales/LanguageContext'
import type { TranslationKey } from '@/locales'
import { useSelectionStore } from '@/store/selectionStore'
import { useWeatherPoints } from './WeatherPointsPage'

const pad = (n: number) => String(n).padStart(2, '0')

type WeatherView = 'chart' | 'table'
type WeatherChart = 'temp' | 'humid' | 'precip' | 'sun'
/** Heating degree-days base, °C — the usual one for gas. */
const HDD_BASE = 18

const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Two months back and the forecast horizon ahead, so the forecast shows at once. */
function defaultRange() {
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - 60)
  const to = new Date(now)
  to.setDate(to.getDate() + FORECAST_DAYS - 1)
  return { from: isoDay(from), to: isoDay(to) }
}

/** Series the charts draw, each split into a history and a forecast half. */
const SERIES = ['t_mean', 'temperature', 'tBand', 'humidity', 'cloud_cover', 'precipitation', 'wind_max', 'wind_speed', 'radiation']

/**
 * Chart rows: every value also lands under `<key>_h` (history) or `<key>_fc`
 * (forecast), so the forecast can be drawn dashed. The last history row
 * repeats into the forecast half — otherwise the dashed line would start a
 * step after the solid one ends and leave a hole between them. The plain keys
 * stay for the tooltip.
 */
function splitBySource(rows: Row[]): Row[] {
  const out = rows.map((r) => {
    const fc = r.source === 'forecast'
    const x: Row = { ...r }
    for (const k of SERIES) {
      if (r[k] === undefined || r[k] === null) continue
      x[`${k}_${fc ? 'fc' : 'h'}`] = r[k]
    }
    return x
  })
  const firstFc = out.findIndex((r) => r.source === 'forecast')
  if (firstFc > 0) {
    const bridge = out[firstFc - 1]
    for (const k of SERIES) if (bridge[`${k}_h`] !== undefined) bridge[`${k}_fc`] = bridge[`${k}_h`]
  }
  return out
}

interface Row {
  period: string
  [key: string]: string | number | [number, number] | null | undefined
}

interface Column {
  key: string
  label: TranslationKey
  unit: string
  digits: number
}

const DAILY_COLUMNS: Column[] = [
  { key: 't_mean', label: 'weatherTMean', unit: '°C', digits: 1 },
  { key: 't_min', label: 'weatherTMin', unit: '°C', digits: 1 },
  { key: 't_max', label: 'weatherTMax', unit: '°C', digits: 1 },
  { key: 'precipitation', label: 'weatherPrecipitation', unit: 'мм', digits: 1 },
  { key: 'wind_max', label: 'weatherWind', unit: 'м/с', digits: 1 },
  { key: 'radiation', label: 'weatherRadiation', unit: 'МДж/м²', digits: 2 },
]
const HOURLY_COLUMNS: Column[] = [
  { key: 'temperature', label: 'weatherTemperature', unit: '°C', digits: 1 },
  { key: 'humidity', label: 'weatherHumidity', unit: '%', digits: 0 },
  { key: 'cloud_cover', label: 'weatherCloud', unit: '%', digits: 0 },
  { key: 'wind_speed', label: 'weatherWind', unit: 'м/с', digits: 1 },
  { key: 'precipitation', label: 'weatherPrecipitation', unit: 'мм', digits: 1 },
  { key: 'radiation', label: 'weatherRadiation', unit: 'Вт/м²', digits: 0 },
]
export function WeatherPage() {
  const { t, getLocale } = useLanguage()
  const { colorScheme } = useMantineColorScheme()
  const dark = colorScheme === 'dark'
  const { branchId } = useSelectionStore()
  const { data: points } = useWeatherPoints(branchId)

  const initial = defaultRange()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [periodType, setPeriodType] = useState<PeriodType>('daily')
  const [pointId, setPointId] = useState<number | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [shown, setShown] = useState<{ type: PeriodType; point: WeatherPoint } | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [view, setView] = useLocalStorage<WeatherView>({ key: 'hlv-weather-view', defaultValue: 'chart' })
  const [chart, setChart] = useLocalStorage<WeatherChart>({ key: 'hlv-weather-chart', defaultValue: 'temp' })

  // Keep a valid point selected as the branch changes.
  useEffect(() => {
    if (!points) return
    if (!points.some((p) => p.id === pointId)) setPointId(points[0]?.id ?? null)
  }, [points, pointId])
  const point = points?.find((p) => p.id === pointId) ?? null

  const run = async () => {
    if (!point) {
      setError(t('weatherSelectPoint'))
      return
    }
    setRunning(true)
    setError(null)
    try {
      const out: Row[] = []
      if (periodType === 'daily') {
        const w = await weatherApi.daily([point.id], from, to)
        for (const r of w) {
          out.push({
            ...r,
            period: r.day,
            tBand: r.t_min != null && r.t_max != null ? [r.t_min, r.t_max] : null,
          })
        }
      } else {
        const w = await weatherApi.hourly([point.id], from, to)
        for (const r of w) out.push({ ...r, period: r.stamp.slice(0, 13) })
      }
      setRows(out)
      setShown({ type: periodType, point })
      setPage(1)
    } catch (e) {
      setError((e as Error).message)
      setRows(null)
    } finally {
      setRunning(false)
    }
  }

  const type = shown?.type ?? periodType
  const columns = type === 'daily' ? DAILY_COLUMNS : HOURLY_COLUMNS
  const tempKey = type === 'daily' ? 't_mean' : 'temperature'
  const hasWeather = !!rows?.some((r) => typeof r[tempKey] === 'number')

  const chartRows = useMemo(() => (rows ? splitBySource(rows) : []), [rows])
  const summary = useMemo(() => {
    if (!rows) return null
    // What happened only: a forecast in the means would pass for fact.
    const hist = rows.filter((r) => r.source !== 'forecast')
    const fcTemps = rows
      .filter((r) => r.source === 'forecast')
      .map((r) => r[tempKey])
      .filter((v): v is number => typeof v === 'number')
    const temps = hist.map((r) => r[tempKey]).filter((v): v is number => typeof v === 'number')
    const mins = hist.map((r) => r[type === 'daily' ? 't_min' : 'temperature']).filter((v): v is number => typeof v === 'number')
    const maxs = hist.map((r) => r[type === 'daily' ? 't_max' : 'temperature']).filter((v): v is number => typeof v === 'number')
    const precip = hist.reduce((s, r) => s + (typeof r.precipitation === 'number' ? r.precipitation : 0), 0)
    // Degree-days from daily means; hourly ones from the hours, /24.
    const degreeDays = (vs: number[]) =>
      vs.reduce((s, v) => s + Math.max(HDD_BASE - v, 0), 0) / (type === 'daily' ? 1 : 24)
    const hdd = degreeDays(temps)
    return {
      mean: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
      min: mins.length ? Math.min(...mins) : null,
      max: maxs.length ? Math.max(...maxs) : null,
      precip,
      hdd,
      hddForecast: fcTemps.length ? degreeDays(fcTemps) : null,
      days: type === 'daily' ? temps.length : temps.length / 24,
    }
  }, [rows, tempKey, type])

  const fmtX = (value: string): [string, string] => {
    const d = new Date(value.length === 13 ? `${value}:00:00` : value)
    if (isNaN(d.getTime())) return [value, '']
    const locale = getLocale()
    if (type === 'daily') return [d.toLocaleDateString(locale), '']
    return [d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }), `${pad(d.getHours())}:00`]
  }
  const fmtLabel = (v: string) => fmtX(v).filter(Boolean).join(' ')

  const exportExcel = () => {
    if (!rows || !shown) return
    const header = [t('weatherRange'), t('weatherSource'), ...columns.map((c) => `${t(c.label)}, ${c.unit}`)]
    const body = rows.map((r) => [
      fmtLabel(r.period),
      t(r.source === 'forecast' ? 'weatherSourceForecast' : 'weatherSourceArchive'),
      ...columns.map((c) => (typeof r[c.key] === 'number' ? Number((r[c.key] as number).toFixed(c.digits)) : '')),
    ])
    void writeSheet(`weather_${shown.point.name}_${from}_${to}`, 'Погода', [header, ...body])
  }

  const c = {
    grid: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
    axis: dark ? '#9aa7ad' : '#5a6b75',
    temp: dark ? '#ff922b' : '#e8590c',
    band: dark ? 'rgba(255,146,43,0.22)' : 'rgba(232,89,12,0.14)',
    rain: dark ? '#74c0fc' : '#1c7ed6',
    wind: dark ? '#adb5bd' : '#5c6b75',
    sun: dark ? '#ffd43b' : '#f2b705',
    humid: dark ? '#63e6be' : '#12b886',
    cloud: dark ? '#868e96' : '#868e96',
    today: dark ? '#e6edf0' : '#22313a',
  }
  // The "today" mark: the day, or the current hour, if the period holds it.
  const now = new Date()
  const todayKey = type === 'daily' ? isoDay(now) : `${isoDay(now)}T${pad(now.getHours())}`
  const showToday = !!rows?.some((r) => r.period === todayKey)
  const FC_DASH = '5 4'

  const tickInterval = rows ? Math.max(0, Math.ceil(rows.length / 20) - 1) : 0
  const xAxis = (withTicks: boolean) => (
    <XAxis
      dataKey="period"
      interval={tickInterval}
      tick={withTicks ? <TimeAxisTick format={fmtX} fill={c.axis} /> : false}
      height={withTicks ? timeAxisHeight(type === 'hourly') : 4}
    />
  )
  // Humidity and cloud cover exist only in the hourly series.
  const activeChart: WeatherChart = chart === 'humid' && type === 'daily' ? 'temp' : chart
  /** The tooltip lists what the chart on screen draws, nothing else. */
  const chartColumns = columns.filter((col) => {
    switch (activeChart) {
      case 'temp':
        return ['t_mean', 't_min', 't_max', 'temperature'].includes(col.key)
      case 'humid':
        return col.key === 'humidity' || col.key === 'cloud_cover'
      case 'precip':
        return ['precipitation', 'wind_max', 'wind_speed'].includes(col.key)
      case 'sun':
        return col.key === 'radiation'
    }
  })
  const tooltip = (
    <Tooltip
      content={({ active, payload }) => {
        const r = payload?.[0]?.payload as Row | undefined
        if (!active || !r) return null
        return <WeatherTooltip row={r} columns={chartColumns} label={fmtLabel(r.period)} />
      }}
    />
  )
  const yAxis = (id: string, unit: string, orientation: 'left' | 'right' = 'left', domain?: [number, number]) => (
    <YAxis
      yAxisId={id}
      orientation={orientation}
      width={56}
      domain={domain}
      tick={{ fontSize: 11, fill: c.axis }}
      tickFormatter={(v) => `${Math.round(Number(v) * 10) / 10}${unit}`}
    />
  )
  const chartOptions = [
    { value: 'temp', label: t('weatherTemperature') },
    ...(type === 'hourly' ? [{ value: 'humid', label: `${t('weatherHumidity')} · ${t('weatherCloud')}` }] : []),
    { value: 'precip', label: `${t('weatherPrecipitation')} · ${t('weatherWind')}` },
    { value: 'sun', label: t('weatherRadiation') },
  ]
  const chartMargin = { top: 6, right: 8, bottom: 0, left: 0 }

  const pageRows = rows?.slice((page - 1) * pageSize, page * pageSize) ?? []

  return (
    <ReportShell
      title={t('weatherTitle')}
      description={t('weatherDescription')}
      onRun={run}
      running={running}
      onExport={exportExcel}
      canExport={!!rows?.length}
      error={error}
      controls={
        <>
          <Select
            size="xs"
            w={240}
            placeholder={t('weatherSelectPoint')}
            data={(points ?? []).map((p) => ({ value: String(p.id), label: p.name }))}
            value={pointId != null ? String(pointId) : null}
            onChange={(v) => setPointId(v ? Number(v) : null)}
            searchable
            allowDeselect={false}
          />
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
            disabled={running}
          />
        </>
      }
    >
      {rows && !hasWeather && (
        <Box ta="center" py="md">
          <Text c="dimmed">{t('weatherNoWeather')}</Text>
        </Box>
      )}

      {rows && rows.length > 0 && summary && (
        <>
          <SimpleGrid cols={{ base: 2, sm: 3, md: summary.hddForecast != null ? 6 : 5 }} spacing="sm">
            <Stat label={t('weatherTMean')} value={summary.mean} unit="°C" digits={1} color={c.temp} />
            <Stat label={t('weatherTMin')} value={summary.min} unit="°C" digits={1} />
            <Stat label={t('weatherTMax')} value={summary.max} unit="°C" digits={1} />
            <Stat label={t('weatherHdd')} value={summary.hdd} unit="" digits={0} />
            <Stat label={t('weatherPrecipitation')} value={summary.precip} unit=" мм" digits={1} color={c.rain} />
            {summary.hddForecast != null && (
              <Stat label={t('weatherHddForecast')} value={summary.hddForecast} unit="" digits={0} />
            )}
          </SimpleGrid>

          <Paper withBorder radius="md" p="md">
            <Group justify="space-between" mb="sm" wrap="wrap" gap="sm">
              <Group gap="sm" wrap="wrap">
                <SegmentedControl
                  size="xs"
                  value={view}
                  onChange={(v) => setView(v as WeatherView)}
                  data={[
                    { value: 'chart', label: t('weatherViewChart') },
                    { value: 'table', label: t('weatherViewTable') },
                  ]}
                />
                {view === 'chart' && (
                  <SegmentedControl
                    size="xs"
                    value={activeChart}
                    onChange={(v) => setChart(v as WeatherChart)}
                    data={chartOptions}
                  />
                )}
              </Group>
            </Group>

            {view === 'chart' ? (
              <ResponsiveContainer width="100%" height={480}>
                <ComposedChart data={chartRows} margin={chartMargin}>
                  <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
                  {xAxis(true)}
                  {tooltip}
                  {activeChart === 'temp' && yAxis('t', '°')}
                  {activeChart === 'temp' && (
                    <ReferenceLine yAxisId="t" y={0} stroke={c.axis} strokeDasharray="4 4" />
                  )}
                  {showToday && (
                    <ReferenceLine
                      yAxisId={{ temp: 't', humid: 'p', precip: 'mm', sun: 'r' }[activeChart]}
                      x={todayKey}
                      stroke={c.today}
                      strokeWidth={1.5}
                      label={{ value: t('weatherToday'), position: 'insideTopLeft', fill: c.today, fontSize: 11 }}
                    />
                  )}
                  {activeChart === 'temp' && type === 'daily' && (
                    <Area
                      yAxisId="t"
                      dataKey="tBand_h"
                      stroke="none"
                      fill={c.band}
                      fillOpacity={1}
                      activeDot={false}
                      isAnimationActive={false}
                    />
                  )}
                  {activeChart === 'temp' && type === 'daily' && (
                    <Area
                      yAxisId="t"
                      dataKey="tBand_fc"
                      stroke="none"
                      fill={c.band}
                      fillOpacity={0.5}
                      activeDot={false}
                      isAnimationActive={false}
                    />
                  )}
                  {activeChart === 'temp' && (
                    <Line
                      yAxisId="t"
                      dataKey={`${tempKey}_h`}
                      stroke={c.temp}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                  {activeChart === 'temp' && (
                    <Line
                      yAxisId="t"
                      dataKey={`${tempKey}_fc`}
                      stroke={c.temp}
                      strokeWidth={2}
                      strokeDasharray={FC_DASH}
                      strokeOpacity={0.8}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}

                  {activeChart === 'humid' && yAxis('p', '%', 'left', [0, 100])}
                  {activeChart === 'humid' && (
                    <Area
                      yAxisId="p"
                      dataKey="cloud_cover_h"
                      stroke="none"
                      fill={c.cloud}
                      fillOpacity={0.25}
                      isAnimationActive={false}
                    />
                  )}
                  {activeChart === 'humid' && (
                    <Area
                      yAxisId="p"
                      dataKey="cloud_cover_fc"
                      stroke="none"
                      fill={c.cloud}
                      fillOpacity={0.12}
                      isAnimationActive={false}
                    />
                  )}
                  {activeChart === 'humid' && (
                    <Line
                      yAxisId="p"
                      dataKey="humidity_h"
                      stroke={c.humid}
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                  {activeChart === 'humid' && (
                    <Line
                      yAxisId="p"
                      dataKey="humidity_fc"
                      stroke={c.humid}
                      strokeWidth={1.5}
                      strokeDasharray={FC_DASH}
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}

                  {activeChart === 'precip' && yAxis('mm', '')}
                  {activeChart === 'precip' && yAxis('ms', '', 'right')}
                  {activeChart === 'precip' && (
                    <Bar yAxisId="mm" dataKey="precipitation_h" fill={c.rain} isAnimationActive={false} />
                  )}
                  {activeChart === 'precip' && (
                    <Bar
                      yAxisId="mm"
                      dataKey="precipitation_fc"
                      fill={c.rain}
                      fillOpacity={0.4}
                      isAnimationActive={false}
                    />
                  )}
                  {activeChart === 'precip' && (
                    <Line
                      yAxisId="ms"
                      dataKey={type === 'daily' ? 'wind_max_h' : 'wind_speed_h'}
                      stroke={c.wind}
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                  {activeChart === 'precip' && (
                    <Line
                      yAxisId="ms"
                      dataKey={type === 'daily' ? 'wind_max_fc' : 'wind_speed_fc'}
                      stroke={c.wind}
                      strokeWidth={1.5}
                      strokeDasharray={FC_DASH}
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}

                  {activeChart === 'sun' && yAxis('r', '')}
                  {activeChart === 'sun' && (
                    <Area
                      yAxisId="r"
                      dataKey="radiation_h"
                      stroke={c.sun}
                      fill={c.sun}
                      fillOpacity={0.3}
                      isAnimationActive={false}
                    />
                  )}
                  {activeChart === 'sun' && (
                    <Area
                      yAxisId="r"
                      dataKey="radiation_fc"
                      stroke={c.sun}
                      strokeDasharray={FC_DASH}
                      fill={c.sun}
                      fillOpacity={0.12}
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <>
                <Table.ScrollContainer minWidth={720}>
                  <Table striped highlightOnHover verticalSpacing={4} stickyHeader>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{t('weatherRange')}</Table.Th>
                        <Table.Th>{t('weatherSource')}</Table.Th>
                        {columns.map((col) => (
                          <Table.Th key={col.key} ta="right">
                            {t(col.label)}, {col.unit}
                          </Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {pageRows.map((r) => (
                        <Table.Tr
                          key={r.period}
                          // A forecast row reads as provisional at a glance.
                          style={r.source === 'forecast' ? { opacity: 0.7, fontStyle: 'italic' } : undefined}
                        >
                          <Table.Td>
                            <Text size="xs" ff="monospace">
                              {fmtLabel(r.period)}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            {r.source === 'forecast' ? (
                              <Badge size="xs" color="grape" variant="light">
                                {t('weatherSourceForecast')}
                              </Badge>
                            ) : (
                              <Text size="xs" c="dimmed">
                                {t('weatherSourceArchive')}
                              </Text>
                            )}
                          </Table.Td>
                          {columns.map((col) => (
                            <Table.Td key={col.key} ta="right">
                              <Text size="xs" ff="monospace">
                                {typeof r[col.key] === 'number'
                                  ? (r[col.key] as number).toLocaleString(getLocale(), {
                                      minimumFractionDigits: col.digits,
                                      maximumFractionDigits: col.digits,
                                    })
                                  : '—'}
                              </Text>
                            </Table.Td>
                          ))}
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
                <TablePagination
                  page={page}
                  pageSize={pageSize}
                  total={rows.length}
                  onPageChange={setPage}
                  onPageSizeChange={(s) => {
                    setPageSize(s)
                    setPage(1)
                  }}
                />
              </>
            )}
          </Paper>
        </>
      )}
    </ReportShell>
  )
}

function Stat({
  label,
  value,
  unit,
  digits,
  color,
}: {
  label: string
  value: number | null
  unit: string
  digits: number
  color?: string
}) {
  const { getLocale } = useLanguage()
  return (
    <Paper withBorder radius="md" p="sm">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} size="lg" ff="'JetBrains Mono Variable', monospace" style={{ color }}>
        {value == null
          ? '—'
          : `${value.toLocaleString(getLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits })}${unit}`}
      </Text>
    </Paper>
  )
}

function WeatherTooltip({ row, columns, label }: { row: Row; columns: Column[]; label: string }) {
  const { t } = useLanguage()
  return (
    <Box
      style={{
        background: 'var(--hlv-surface)',
        border: '1px solid var(--hlv-border)',
        borderRadius: 8,
        padding: '8px 10px',
        minWidth: 200,
      }}
    >
      <Group gap="xs" mb={4} justify="space-between" wrap="nowrap">
        <Text size="xs" fw={600}>
          {label}
        </Text>
        {row.source === 'forecast' && (
          <Badge size="xs" color="grape" variant="light">
            {t('weatherSourceForecast')}
          </Badge>
        )}
      </Group>
      {columns.map((col) =>
        typeof row[col.key] === 'number' ? (
          <Group key={col.key} gap="md" justify="space-between" wrap="nowrap">
            <Text size="xs" c="dimmed">
              {t(col.label)}
            </Text>
            <Text size="xs" ff="monospace">
              {(row[col.key] as number).toFixed(col.digits)} {col.unit}
            </Text>
          </Group>
        ) : null,
      )}
    </Box>
  )
}
