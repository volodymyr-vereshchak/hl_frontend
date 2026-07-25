import { useMemo, useState } from 'react'
import {
  Paper,
  Text,
  Group,
  SegmentedControl,
  Switch,
  Button,
  Loader,
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
import * as XLSX from 'xlsx'
import {
  archiveDataApi,
  archiveDataVirtualApi,
  dpdLineApi,
  type ArchiveRow,
} from '@/api/entities'
import { commercialHourlyRange } from '@/domain/commercialDay'
import { getEnterpriseFetchFn, type PeriodType } from '@/domain/enterpriseVolumes'
import { calculateTrendPercentages, trendColor, type TrendPoint } from '@/domain/grsTrends'
import { useLanguage } from '@/locales/LanguageContext'
import { useSelectionStore } from '@/store/selectionStore'
import { PeriodPicker } from '@/features/archive/PeriodPicker'
import { ReportShell } from './ReportShell'
import { useBranchLines, type ReportLine } from './useBranchLines'

const pad = (n: number) => String(n).padStart(2, '0')

function defaultRange() {
  const now = new Date()
  const to = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const prev = new Date(now.getTime() - 7 * 864e5)
  return { from: `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(prev.getDate())}`, to }
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
  const [hidden, setHidden] = useState<Record<number, boolean>>({})
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

      const [p, v, d] = await Promise.all([
        fetchFor(phys, 'physical').catch(() => []),
        fetchFor(virt, 'virtual').catch(() => []),
        fetchFor(dpd, 'dpd').catch(() => []),
      ])
      const rows = [...p, ...v, ...d]

      let enterprise: Awaited<ReturnType<ReturnType<typeof getEnterpriseFetchFn>>> = []
      if (withEnterprise) {
        setProgress(t('loadingEnterpriseData'))
        enterprise = await getEnterpriseFetchFn(true)(
          trendLines.map((l) => l.id),
          win.from,
          win.to,
          periodType,
          (pr) => setProgress(pr.total ? `${pr.done ?? 0}/${pr.total}` : (pr.phase ?? null)),
        ).catch(() => [])
      }

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

  const exportExcel = () => {
    if (!data) return
    const header = ['Період', ...usedLines.map((l) => `${l.name}, %`)]
    const body = data.map((p) => [
      String(p.period),
      ...usedLines.map((l) => Number(p[`line_${l.id}`] ?? 0)),
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...body]), 'Тренди')
    XLSX.writeFile(wb, `grs_trends_${from}_${to}.xlsx`)
  }

  const fmtX = (value: string) => {
    const d = new Date(value.length === 13 ? `${value}:00:00` : value)
    if (isNaN(d.getTime())) return value
    const locale = getLocale()
    return periodType === 'daily'
      ? d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })
      : `${d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })} ${pad(d.getHours())}`
  }

  const grid = dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)'
  const axis = dark ? '#9aa7ad' : '#5a6b75'
  const tickInterval = data ? Math.max(0, Math.ceil(data.length / 24) - 1) : 0

  return (
    <ReportShell
      title={t('grsConsumptionTrends')}
      description={t('grsTracksDescription')}
      onRun={run}
      running={running}
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
          <Switch
            size="sm"
            color="grape"
            checked={withEnterprise}
            onChange={(e) => setWithEnterprise(e.currentTarget.checked)}
            label={t('enterpriseOverlay')}
            styles={{ label: { whiteSpace: 'nowrap' } }}
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
      {data && data.length > 0 && (
        <Paper withBorder radius="md" p="md">
          <Group justify="space-between" mb="sm" wrap="wrap">
            <Text fw={600} ff="'Space Grotesk Variable', sans-serif">
              {t('grsConsumptionTrends')}
            </Text>
            <Group gap={4}>
              <Button size="compact-xs" variant="default" onClick={() => setHidden({})}>
                {t('allLines')}
              </Button>
              {usedLines.map((l, i) => {
                const color = trendColor(i, usedLines.length)
                const on = !hidden[l.id]
                return (
                  <Button
                    key={l.id}
                    size="compact-xs"
                    variant={on ? 'filled' : 'outline'}
                    onClick={() => setHidden({ ...hidden, [l.id]: on })}
                    styles={{
                      root: {
                        backgroundColor: on ? color : 'transparent',
                        borderColor: color,
                        color: on ? '#fff' : color,
                      },
                    }}
                  >
                    {l.name}
                  </Button>
                )
              })}
            </Group>
          </Group>

          <ResponsiveContainer width="100%" height={560}>
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid stroke={grid} strokeDasharray="3 3" />
              <XAxis
                dataKey="period"
                tickFormatter={fmtX}
                tick={{ fontSize: 11, fill: axis }}
                interval={tickInterval}
                angle={-45}
                textAnchor="end"
                height={periodType === 'hourly' ? 78 : 62}
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

      {data && data.length === 0 && (
        <Box ta="center" py="xl">
          <Text c="dimmed">{t('noDataForPeriod')}</Text>
        </Box>
      )}
    </ReportShell>
  )
}
