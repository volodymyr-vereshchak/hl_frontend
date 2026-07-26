import { Card, Text, Group, Box, Stack } from '@mantine/core'
import { IconArrowUpRight, IconArrowDownRight, IconMinus } from '@tabler/icons-react'
import { numericStyle } from '@/theme/theme'
import { useLanguage } from '@/locales/LanguageContext'
import type {
  PressureReading,
  FlowComparison,
  LineVolumeComparison,
} from '@/domain/overviewCalculator'

interface LineCardProps {
  lineName: string
  pressure: PressureReading
  flow?: FlowComparison
  volume?: LineVolumeComparison
  referenceTime?: Date
}

const fmt = (n: number | null | undefined, d = 2) =>
  n == null || isNaN(n) ? '—' : Number(n).toFixed(d)
const fmtVol = (n: number | null | undefined) =>
  n == null || isNaN(n) ? '—' : Number(n).toLocaleString('uk-UA', { maximumFractionDigits: 1 })

function fmtTime(ts: Date | string | undefined): string {
  if (!ts) return '--:--'
  const d = new Date(ts)
  const day = String(d.getDate()).padStart(2, '0')
  const mon = String(d.getMonth() + 1).padStart(2, '0')
  const time = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
  return `${day}.${mon}.${d.getFullYear()} ${time}`
}

/**
 * Delta vs the previous period. The unit is deliberately omitted — it is already
 * on the value directly above, and repeating it pushed the row onto two lines at
 * the card's width.
 */
function ChangeRow({
  change,
  changePercent,
  isIncrease,
  isDecrease,
}: {
  change: number
  changePercent: number
  isIncrease: boolean
  isDecrease: boolean
}) {
  const color = isIncrease ? 'var(--mantine-color-teal-5)' : isDecrease ? 'var(--mantine-color-red-5)' : 'var(--mantine-color-dimmed)'
  const Icon = isIncrease ? IconArrowUpRight : isDecrease ? IconArrowDownRight : IconMinus
  return (
    <Group gap={3} justify="center" wrap="nowrap" style={{ color }}>
      <Icon size={12} style={{ flexShrink: 0 }} />
      <Text size="10px" fw={600} style={{ color, ...numericStyle }}>
        {fmtVol(Math.abs(change))} ({changePercent > 0 ? '+' : ''}
        {fmtVol(changePercent)}%)
      </Text>
    </Group>
  )
}

/** A compact metering-line data section (label + value + optional change). */
function DataSection({ children }: { children: React.ReactNode }) {
  return (
    <Box
      style={{
        width: '100%',
        background: 'var(--hlv-surface-2)',
        borderRadius: 6,
        padding: '5px 8px',
      }}
    >
      {children}
    </Box>
  )
}

/** Horizontal dP band with current + max-24h markers over a min→max range. */
function DpBar({ dp }: { dp: NonNullable<PressureReading['dpData']> }) {
  const span = dp.maxDp - dp.minDp || 1
  const pos = (v: number) => Math.min(Math.max(((v - dp.minDp) / span) * 100, 0), 100)
  return (
    <Box mt={4}>
      <Box style={{ position: 'relative', height: 10, marginBottom: 6 }}>
        <Box
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 5,
            opacity: 0.35,
            background:
              'linear-gradient(90deg, var(--mantine-color-teal-5) 0%, var(--mantine-color-petrol-5) 40%, var(--mantine-color-amber-5) 75%, var(--mantine-color-red-5) 100%)',
          }}
        />
        {[
          { v: dp.maxDp24h, c: 'var(--mantine-color-amber-5)' },
          { v: dp.currentDp, c: 'var(--mantine-color-petrol-4)' },
        ].map((m, i) => (
          <Box
            key={i}
            style={{
              position: 'absolute',
              top: -3,
              left: `${pos(m.v)}%`,
              transform: 'translateX(-50%)',
              width: 3,
              height: 16,
              borderRadius: 2,
              background: m.c,
              boxShadow: `0 0 6px ${m.c}`,
            }}
          />
        ))}
      </Box>
      <Group justify="space-between" gap={0}>
        <Text size="9px" c="dimmed" style={numericStyle}>
          {dp.minDp.toFixed(1)}
        </Text>
        <Text size="9px" c="dimmed" style={numericStyle}>
          {dp.maxDp.toFixed(1)}
        </Text>
      </Group>
    </Box>
  )
}

export function LineCard({ lineName, pressure, flow, volume, referenceTime }: LineCardProps) {
  const { t } = useLanguage()
  const dp = pressure.dpData
  const isStale =
    referenceTime && pressure.timestamp
      ? Math.abs(new Date(pressure.timestamp).getTime() - new Date(referenceTime).getTime()) > 60_000
      : false

  return (
    <Card
      padding="xs"
      radius="md"
      withBorder
      style={{
        // Fill the grid row so cards in a row line up regardless of which
        // sections (flow / volume / dP) a line actually has.
        height: '100%',
        borderColor: isStale ? 'var(--mantine-color-red-7)' : undefined,
        background: isStale ? 'color-mix(in srgb, var(--mantine-color-red-9) 12%, var(--hlv-surface))' : undefined,
      }}
    >
      <Stack gap={6} align="center">
        <Text fw={600} size="sm" ta="center" lineClamp={2} style={{ minHeight: '2.5em' }} title={lineName}>
          {lineName}
        </Text>

        {/* Pressure block */}
        <Box
          style={{
            width: '100%',
            background: 'var(--hlv-surface)',
            border: '1px solid var(--hlv-border)',
            borderRadius: 10,
            padding: '9px 10px 7px',
          }}
        >
          <Group justify="center" align="baseline" gap={5}>
            <Text fz={27} fw={700} lh={1} c="petrol" style={numericStyle}>
              {fmt(pressure.pressure)}
            </Text>
            <Text size="10px" c="dimmed">
              {pressure.pressureUnit}
            </Text>
          </Group>
          <Group justify="center" gap="lg" mt={6}>
            <Stack gap={0} align="center">
              <Text size="9px" fw={700} tt="uppercase" c="blue.4">
                min
              </Text>
              <Text size="sm" fw={600} style={numericStyle}>
                {fmt(pressure.minPressure24h)}
              </Text>
            </Stack>
            <Stack gap={0} align="center">
              <Text size="9px" fw={700} tt="uppercase" c="amber.5">
                max
              </Text>
              <Text size="sm" fw={600} style={numericStyle}>
                {fmt(pressure.maxPressure24h)}
              </Text>
            </Stack>
          </Group>
        </Box>

        <Text size="10px" c={isStale ? 'red.5' : 'dimmed'}>
          {fmtTime(pressure.timestamp)}
        </Text>

        {flow && flow.previousHour != null && (
          <DataSection>
            <Text size="9px" fw={600} tt="uppercase" c="petrol" ta="center">
              {t('lastHourShort')}
            </Text>
            <Group justify="center" align="baseline" gap={4}>
              <Text fw={700} size="md" style={numericStyle}>
                {fmtVol(flow.lastHour)}
              </Text>
              <Text size="10px" c="dimmed">
                {t('volumeUnit')}/ч
              </Text>
            </Group>
            <ChangeRow {...flow} />
          </DataSection>
        )}

        {volume && (
          <DataSection>
            <Text size="9px" fw={600} tt="uppercase" c="petrol" ta="center">
              {t('current24hShort')}
            </Text>
            <Group justify="center" align="baseline" gap={4}>
              <Text fw={700} size="md" style={numericStyle}>
                {fmtVol(volume.current24h)}
              </Text>
              <Text size="10px" c="dimmed">
                {t('volumeUnit')}
              </Text>
            </Group>
            <ChangeRow {...volume} />
          </DataSection>
        )}

        {dp && dp.hasDpData && (
          <DataSection>
            <Text size="9px" fw={600} tt="uppercase" c="petrol" ta="center" mb={2}>
              {dp.isMeter ? t('flowInWorkingConditions') : t('differentialPressure')}
            </Text>
            <DpBar dp={dp} />
            <Group justify="space-between" mt={8} gap={4}>
              <Stack gap={0}>
                <Text size="9px" c="dimmed">
                  {t('currentValue')}
                </Text>
                <Text size="xs" fw={600} c="petrol.4" style={numericStyle}>
                  {dp.currentDp.toFixed(2)} {dp.isMeter ? t('flowUnit') : pressure.dpUnit}
                </Text>
              </Stack>
              <Stack gap={0} align="flex-end">
                <Text size="9px" c="dimmed">
                  {t('maxValue24h')}
                </Text>
                <Text size="xs" fw={600} c="amber.5" style={numericStyle}>
                  {dp.maxDp24h.toFixed(2)} {dp.isMeter ? t('flowUnit') : pressure.dpUnit}
                </Text>
              </Stack>
            </Group>
          </DataSection>
        )}
      </Stack>
    </Card>
  )
}
