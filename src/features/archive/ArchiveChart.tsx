import { useMemo } from 'react'
import { Paper, Text, useMantineColorScheme } from '@mantine/core'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
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
}

export function ArchiveChart({ rows, type, meta }: Props) {
  const { t } = useLanguage()
  const { colorScheme } = useMantineColorScheme()
  const dark = colorScheme === 'dark'

  const data = useMemo(() => {
    return [...rows]
      .filter((r) => r.period)
      .sort((a, b) => new Date(a.period).getTime() - new Date(b.period).getTime())
      .map((r) => {
        const d = new Date(r.period)
        const label =
          type === 'hourly'
            ? `${d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })} ${String(d.getHours()).padStart(2, '0')}`
            : d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })
        return {
          label,
          volume: Number(r.volume) || 0,
          pressure: r.pressure != null ? Number(r.pressure) : null,
          temperature: r.temperature != null ? Number(r.temperature) : null,
        }
      })
  }, [rows, type])

  if (data.length === 0) return null

  const grid = dark ? '#232c34' : '#eceff1'
  const axis = dark ? '#84959f' : '#7b8e99'
  const showPressure = meta.kind !== 'virtual'

  return (
    <Paper p="md" radius="md" withBorder>
      <Text fw={600} mb="sm" ff="'Space Grotesk Variable', sans-serif">
        {t('chartTitle')}
      </Text>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: axis }} minTickGap={24} />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11, fill: axis }}
            width={64}
            tickFormatter={(v) => Number(v).toLocaleString('uk-UA')}
          />
          {showPressure && (
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: axis }} width={48} />
          )}
          <Tooltip
            contentStyle={{
              background: dark ? '#1a2027' : '#fff',
              border: `1px solid ${grid}`,
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            yAxisId="left"
            dataKey="volume"
            name={t('volumeLabel')}
            fill="var(--mantine-color-petrol-5)"
            radius={[2, 2, 0, 0]}
            maxBarSize={28}
          />
          {showPressure && (
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="pressure"
              name={t('pressureLabel')}
              stroke="var(--mantine-color-amber-5)"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </Paper>
  )
}
