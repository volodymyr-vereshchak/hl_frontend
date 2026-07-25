import { useMemo } from 'react'
import { Paper, Text, Group, Button, useMantineColorScheme, Box } from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useLanguage } from '@/locales/LanguageContext'
import type { ArchiveType } from '@/types'
import type { LineMeta } from '@/store/selectionStore'
import type { ArchiveRow } from '@/api/entities'

interface Props {
  rows: ArchiveRow[]
  type: ArchiveType
  meta: LineMeta
  /** Enterprise overlay active → add Net / Total-enterprise series. */
  overlay?: boolean
}

interface Series {
  key: string
  label: string
  color: string
  axis: 'left' | 'right'
}

interface TooltipEntry {
  dataKey?: string | number
  name?: string
  value?: number | string
  color?: string
}
interface TooltipContentProps {
  active?: boolean
  label?: string | number
  payload?: TooltipEntry[]
}

// Series definitions ported from InteractiveChart.getChartColumns (colors kept).
function getSeries(type: ArchiveType, meta: LineMeta, t: (k: string) => string): Series[] {
  const pUnit = meta.pressure_unit || 'кгс/см²'
  const dpUnit = meta.dp_unit || 'кгс/м²'
  const wLabel = meta.meter
    ? `${t('workingVolume')}, ${t('volumeUnit')}`
    : `${t('differentialPressure')}, ${dpUnit}`

  if (type === 'daily' || type === 'hourly') {
    if (meta.kind === 'virtual') {
      return [{ key: 'volume', label: t('volumeLabel'), color: '#7b6cf0', axis: 'left' }]
    }
    if (meta.kind === 'dpd') {
      return [
        { key: 'volume', label: t('volumeLabel'), color: '#7b6cf0', axis: 'left' },
        { key: 'pressure', label: `${t('pressureLabel')}, ${pUnit}`, color: '#f0b429', axis: 'right' },
        { key: 'temperature', label: t('temperatureLabel'), color: '#f97316', axis: 'right' },
      ]
    }
    const showOutput = !meta.is_high_pressure && !meta.meter
    return [
      { key: 'volume', label: t('volumeLabel'), color: '#7b6cf0', axis: 'left' },
      { key: 'w_volume_dp', label: wLabel, color: '#2fb37f', axis: 'left' },
      { key: 'pressure', label: `${t('pressureLabel')}, ${pUnit}`, color: '#f0b429', axis: 'right' },
      ...(showOutput
        ? [{ key: 'output_pressure', label: `${t('outputPressure')}, ${pUnit}`, color: '#e6407a', axis: 'right' as const }]
        : []),
      { key: 'temperature', label: t('temperatureLabel'), color: '#f97316', axis: 'right' },
    ]
  }
  if (type === 'param') {
    return [
      { key: 'density', label: t('densityLabel'), color: '#7b6cf0', axis: 'left' },
      { key: 'co2', label: t('co2Label'), color: '#2fb37f', axis: 'left' },
      { key: 'n2', label: t('n2Label'), color: '#f0b429', axis: 'left' },
      { key: 'max_p', label: t('maxPressureLabel'), color: '#f97316', axis: 'left' },
      { key: 'min_p', label: t('minPressureLabel'), color: '#22c55e', axis: 'left' },
      { key: 'max_t', label: t('maxTemperatureLabel'), color: '#ef4444', axis: 'left' },
      { key: 'min_t', label: t('minTemperatureLabel'), color: '#3b82f6', axis: 'left' },
    ]
  }
  if (type === 'sys') return [{ key: 'volume', label: t('value'), color: '#7b6cf0', axis: 'left' }]
  if (type === 'edit') {
    return [
      { key: 'old_value', label: t('oldValueLabel'), color: '#7b6cf0', axis: 'left' },
      { key: 'new_value', label: t('newValueLabel'), color: '#2fb37f', axis: 'left' },
    ]
  }
  return []
}

export function ArchiveChart({ rows, type, meta, overlay }: Props) {
  const { t, getLocale } = useLanguage()
  const { colorScheme } = useMantineColorScheme()
  const dark = colorScheme === 'dark'
  const locale = getLocale()

  const series = useMemo(() => {
    const base = getSeries(type, meta, t)
    if (!overlay) return base
    return [
      ...base,
      { key: 'netVolume', label: t('netVolume'), color: '#22c55e', axis: 'left' as const },
      { key: 'totalEnterprise', label: t('totalEnterpriseVolume'), color: '#a855f7', axis: 'left' as const },
    ]
  }, [type, meta, t, overlay])

  // Per-archive-type curve visibility; a key missing from storage defaults to visible.
  const [hidden, setHidden] = useLocalStorage<Record<string, boolean>>({
    key: `hlv-chart-hidden-${type}`,
    defaultValue: {},
  })
  const isVisible = (key: string) => hidden[key] !== true
  const toggle = (key: string) => setHidden({ ...hidden, [key]: isVisible(key) })

  const hasRight = series.some((s) => s.axis === 'right' && isVisible(s.key))

  const data = useMemo(() => {
    return [...rows]
      .filter((r) => r.period)
      .sort((a, b) => new Date(a.period).getTime() - new Date(b.period).getTime())
      .map((r) => {
        const row: Record<string, number | string | null> = { period: r.period }
        for (const s of series) {
          const v = r[s.key]
          row[s.key] = v == null || v === '' ? null : Number(v)
        }
        return row
      })
  }, [rows, series])

  const fmtX = (value: string) => {
    const d = new Date(value)
    if (isNaN(d.getTime())) return String(value)
    if (type === 'daily') return d.toLocaleDateString(locale)
    return (
      d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }) +
      ' ' +
      d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    )
  }

  const CustomTooltip = ({ active, payload, label }: TooltipContentProps) => {
    if (!active || !payload?.length) return null
    const d = new Date(String(label))
    const head = isNaN(d.getTime())
      ? String(label)
      : type === 'daily'
        ? d.toLocaleDateString(locale)
        : `${d.toLocaleDateString(locale)} ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`
    return (
      <Paper p="xs" withBorder shadow="md" radius="sm" style={{ fontSize: 12 }}>
        <Text size="xs" fw={600} mb={4}>
          {head}
        </Text>
        {payload.map((e) => (
          <Text key={String(e.dataKey)} size="xs" style={{ color: e.color }}>
            {e.name}: {typeof e.value === 'number' ? e.value.toFixed(2) : e.value}
          </Text>
        ))}
      </Paper>
    )
  }

  if (data.length === 0) return null
  // Aim for ~24 evenly spaced labels regardless of range length.
  const tickInterval = Math.max(0, Math.ceil(data.length / 24) - 1)
  const grid = dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)'
  const gridStrong = dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)'
  const axis = dark ? '#9aa7ad' : '#5a6b75'

  return (
    <Paper p="md" radius="md" withBorder>
      <Group justify="space-between" mb="sm" wrap="wrap">
        <Text fw={600} ff="'Space Grotesk Variable', sans-serif">
          {t('chartTitle')}
        </Text>
        <Group gap={6}>
          {series.map((s) => {
            const on = isVisible(s.key)
            return (
              <Button
                key={s.key}
                size="compact-xs"
                variant={on ? 'filled' : 'outline'}
                onClick={() => toggle(s.key)}
                styles={{
                  root: {
                    backgroundColor: on ? s.color : 'transparent',
                    borderColor: s.color,
                    color: on ? '#fff' : s.color,
                  },
                }}
              >
                {s.label}
              </Button>
            )
          })}
        </Group>
      </Group>

      <ResponsiveContainer width="100%" height={620}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          {/* Dense grid: minor lines everywhere, both axes get many ticks. */}
          <CartesianGrid stroke={grid} strokeDasharray="3 3" horizontal vertical />
          {/* Angled labels at a fixed interval: even spacing beats recharts'
              auto-thinning, which clumps ticks in the middle of the range. */}
          <XAxis
            dataKey="period"
            tickFormatter={fmtX}
            tick={{ fontSize: 11, fill: axis }}
            interval={tickInterval}
            angle={-45}
            textAnchor="end"
            height={type === 'hourly' ? 78 : 62}
            stroke={gridStrong}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11, fill: axis }}
            width={70}
            tickCount={12}
            stroke={gridStrong}
            tickFormatter={(v) => Number(v).toLocaleString('uk-UA')}
          />
          {hasRight && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11, fill: axis }}
              width={52}
              tickCount={12}
              stroke={gridStrong}
            />
          )}
          <Tooltip content={<CustomTooltip />} />
          {series
            .filter((s) => isVisible(s.key))
            .map((s) => (
              <Line
                key={s.key}
                yAxisId={hasRight ? s.axis : 'left'}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
        </LineChart>
      </ResponsiveContainer>

      {series.every((s) => !isVisible(s.key)) && (
        <Box ta="center" py="md">
          <Text c="dimmed" size="sm">
            {t('noChartData')}
          </Text>
        </Box>
      )}
    </Paper>
  )
}
