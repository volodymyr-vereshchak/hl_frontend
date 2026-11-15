import { useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  MultiSelect,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
  useMantineColorScheme,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
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
  type LineRef,
  type StationDeviation,
} from '@/domain/grsLineDeviation'
import { TimeAxisTick, timeAxisHeight } from '@/features/archive/TimeAxisTick'
import { pollPhaseLabel } from '@/features/reports/pollPhase'
import { useLanguage } from '@/locales/LanguageContext'
import { fmtDay, fmtNumber, fmtSigned, isoDay, shiftDay } from './format'

const MONO = "'JetBrains Mono Variable', monospace"
/** A week off by more than this is marked. */
const WEEK_LIMIT = 15
/** Line data fetched before the 1С figures end, to set each station's scale. */
const CALIBRATION_BACK = 70
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

interface Result {
  days: string[]
  stations: StationDeviation[]
  common: (number | null)[]
  from: string
  to: string
}

/**
 * Аналітика → «За лініями»: every GRS tied to its trend lines, compared
 * with its model day by day up to today — the trends report's view, against
 * the model instead of the branch. See domain/grsLineDeviation.
 */
export function LinesTab({ branchId, status }: { branchId: number; status: GrsModelStatus }) {
  const { t, getLocale } = useLanguage()
  const locale = getLocale()
  const dark = useMantineColorScheme().colorScheme === 'dark'
  const today = isoDay(new Date())
  const [from, setFrom] = useState(shiftDay(today, -60))
  const [to, setTo] = useState(today)
  const [withIndustry, setWithIndustry] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [shown, setShown] = useState<string[]>([])

  const mapped = status.stations.filter((s) => s.enabled && s.lines?.length)

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      // Reach back into the 1С days for the scale, whatever the period shown.
      const lastOneC = status.inflow?.last ?? from
      const fetchFrom = [from, shiftDay(lastOneC, -CALIBRATION_BACK)].sort()[0]
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
      // Show the period asked for; the earlier days were only for the scale.
      const keep = analysis.days.map((d) => d >= from && d <= to)
      const cut = <T,>(xs: T[]) => xs.filter((_, i) => keep[i])
      const stations = out.stations.map((s) => ({
        ...s,
        estimate: cut(s.estimate),
        model: cut(s.model),
        deviation: cut(s.deviation),
        week: cut(s.week),
      }))
      setResult({ days: cut(analysis.days), stations, common: cut(out.common), from, to })
      const worst = [...stations]
        .sort((a, b) => Math.abs(lastOf(b.week) ?? 0) - Math.abs(lastOf(a.week) ?? 0))
        .slice(0, 5)
        .map((s) => s.name)
      setShown(worst)
    } catch (e) {
      setError((e as Error).message)
      setResult(null)
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  const chart = useMemo(() => {
    if (!result) return []
    return result.days.map((day, i) => {
      const row: Record<string, string | number | null> = { period: day }
      for (const s of result.stations)
        row[s.name] = s.week[i] == null ? null : Math.round(s.week[i]! * 10) / 10
      return row
    })
  }, [result])

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
  }
  const fmtX = (value: string): [string, string] => [
    new Date(`${value}T00:00:00`).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }),
    '',
  ]
  const colorOf = (name: string) =>
    PALETTE[(result?.stations.findIndex((s) => s.name === name) ?? 0) % PALETTE.length]

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
          <Text size="xs" c="dimmed" pb={6}>
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

      {result && !running && (
        <>
          <Paper withBorder radius="md" p="md">
            <Group justify="space-between" mb="xs" wrap="wrap" gap="sm">
              <Text fw={600}>{t('gmLinesChart')}, %</Text>
              <MultiSelect
                size="xs"
                w={420}
                aria-label={t('gmStation')}
                data={result.stations.map((s) => s.name)}
                value={shown}
                onChange={setShown}
                clearable
                searchable
              />
            </Group>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
                <XAxis
                  dataKey="period"
                  interval={Math.max(0, Math.ceil(chart.length / 20) - 1)}
                  tick={<TimeAxisTick format={fmtX} fill={c.axis} />}
                  height={timeAxisHeight(false)}
                />
                <YAxis
                  width={56}
                  tick={{ fontSize: 11, fill: c.axis }}
                  tickFormatter={(v) => `${Math.round(Number(v))}%`}
                />
                <Tooltip
                  formatter={(v, name) => [`${v ?? '—'} %`, String(name)]}
                  labelFormatter={(l) => fmtDay(String(l), locale)}
                />
                <ReferenceLine y={0} stroke={c.axis} strokeDasharray="4 4" />
                <ReferenceLine y={WEEK_LIMIT} stroke="#fa5252" strokeDasharray="2 4" />
                <ReferenceLine y={-WEEK_LIMIT} stroke="#fa5252" strokeDasharray="2 4" />
                {shown.map((name) => (
                  <Line
                    key={name}
                    dataKey={name}
                    stroke={colorOf(name)}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            <Text size="xs" c="dimmed" mt="xs">
              {t('gmLinesChartNote').replace('{n}', String(WEEK_LIMIT))}
            </Text>
          </Paper>

          <Paper withBorder radius="md" p="md">
            <ScrollArea>
              <Table striped highlightOnHover verticalSpacing={6} fz="xs" miw={860}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('gmStation')}</Table.Th>
                    <Table.Th ta="right">{t('gmLinesScale')}</Table.Th>
                    <Table.Th ta="right">
                      {t('gmLinesEstimate')}, {t('gmUnit')}
                    </Table.Th>
                    <Table.Th ta="right">
                      {t('gmExpected')}, {t('gmUnit')}
                    </Table.Th>
                    <Table.Th ta="right">{t('gmDeviationPeriod')}</Table.Th>
                    <Table.Th ta="right">{t('gmDeviationWeek')}</Table.Th>
                    <Table.Th>{t('gmState')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {result.stations.map((s) => {
                    const both = s.estimate
                      .map((e, i) => (e != null && s.model[i] != null ? i : -1))
                      .filter((i) => i >= 0)
                    const est = both.reduce((a, i) => a + s.estimate[i]!, 0)
                    const commonFactor = (i: number) => 1 + (result.common[i] ?? 0) / 100
                    const mod = both.reduce((a, i) => a + s.model[i]! * commonFactor(i), 0)
                    const week = lastOf(s.week)
                    const off = week != null && Math.abs(week) > WEEK_LIMIT
                    return (
                      <Table.Tr
                        key={s.name}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setShown((v) => (v.includes(s.name) ? v : [...v, s.name]))}
                      >
                        <Table.Td fw={500}>
                          <Group gap={6} wrap="nowrap">
                            <span
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: 2,
                                background: colorOf(s.name),
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
                        <Table.Td ta="right" ff={MONO}>
                          {fmtNumber(both.length ? est : null, 1, locale)}
                        </Table.Td>
                        <Table.Td ta="right" ff={MONO}>
                          {fmtNumber(both.length ? mod : null, 1, locale)}
                        </Table.Td>
                        <Table.Td ta="right" ff={MONO}>
                          {fmtSigned(mod ? (est / mod - 1) * 100 : null, 1, locale)}
                        </Table.Td>
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
                              s.scale == null
                                ? 'gmLinesNoScale'
                                : off
                                  ? 'gmStateAlarm'
                                  : 'gmStateOk',
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
        </>
      )}
    </Stack>
  )
}

function lastOf(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return values[i]
  return null
}
