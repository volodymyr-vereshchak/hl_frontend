import { Box, Text, useMantineColorScheme } from '@mantine/core'
import { numericStyle } from '@/theme/theme'

interface PressureGaugeProps {
  label: string
  value: number
  min: number
  max: number
  unit: string
  min24h?: number | null
  max24h?: number | null
  size?: number
}

const START = -210 // degrees (sweep 240°, instrument-style)
const SWEEP = 240

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p0 = polar(cx, cy, r, a0)
  const p1 = polar(cx, cy, r, a1)
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`
}

/**
 * Analog manometer — the app's signature element. A 240° dial with tick marks,
 * a 24h min/max band, and an amber needle. Renders crisp in light and dark.
 */
export function PressureGauge({
  label,
  value,
  min,
  max,
  unit,
  min24h,
  max24h,
  size = 132,
}: PressureGaugeProps) {
  const { colorScheme } = useMantineColorScheme()
  const dark = colorScheme === 'dark'

  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 12
  const clamp = (v: number) => Math.max(min, Math.min(max, v))
  const toAngle = (v: number) => START + ((clamp(v) - min) / (max - min || 1)) * SWEEP
  const needleAngle = toAngle(value)
  const needle = polar(cx, cy, r - 8, needleAngle)

  const trackColor = dark ? '#2c353d' : '#e2e7ea'
  const tickColor = dark ? '#5a6b75' : '#9aa7ad'
  const bandColor = 'var(--mantine-color-petrol-5)'
  const needleColor = 'var(--mantine-color-amber-5)'

  const ticks = Array.from({ length: 7 }, (_, i) => START + (i / 6) * SWEEP)

  const hasBand = min24h != null && max24h != null && max24h > min24h

  return (
    <Box style={{ textAlign: 'center', width: size }}>
      <svg width={size} height={size * 0.82} viewBox={`0 0 ${size} ${size * 0.82}`}>
        {/* Track */}
        <path
          d={arcPath(cx, cy, r, START, START + SWEEP)}
          fill="none"
          stroke={trackColor}
          strokeWidth={8}
          strokeLinecap="round"
        />
        {/* 24h min/max band */}
        {hasBand && (
          <path
            d={arcPath(cx, cy, r, toAngle(min24h), toAngle(max24h))}
            fill="none"
            stroke={bandColor}
            strokeWidth={8}
            strokeLinecap="round"
            opacity={0.55}
          />
        )}
        {/* Ticks */}
        {ticks.map((a, i) => {
          const p1 = polar(cx, cy, r - 8, a)
          const p2 = polar(cx, cy, r - 1, a)
          return (
            <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={tickColor} strokeWidth={1.5} />
          )
        })}
        {/* Needle */}
        <line
          x1={cx}
          y1={cy}
          x2={needle.x}
          y2={needle.y}
          stroke={needleColor}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={4} fill={needleColor} />
      </svg>
      <Box mt={-8}>
        <Text fw={700} fz={20} lh={1} style={numericStyle}>
          {value.toFixed(2)}
        </Text>
        <Text size="xs" c="dimmed">
          {unit}
        </Text>
        <Text size="sm" fw={600} mt={4} lineClamp={1} title={label}>
          {label}
        </Text>
      </Box>
    </Box>
  )
}
