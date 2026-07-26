import { Box, Group, Text } from '@mantine/core'
import { numericStyle } from '@/theme/theme'

interface Props {
  /** Pipe bore at 20 °C, mm — as typed. */
  D20: string
  /** Orifice bore at 20 °C, mm — as typed. */
  d20: string
  /** 0 — кутовий, 1 — трьохрадіусний, 2 — фланцевий. */
  otbor: number
  otborLabel: string
}

const num = (v: string): number | null => {
  const n = parseFloat(String(v).replace(',', '.'))
  return isNaN(n) || n <= 0 ? null : n
}

/**
 * Cross-section of the entered orifice assembly: the diameter ratio, the jet
 * and the tapping positions, drawn from the current form values. It is a sanity
 * check you can read at a glance — β outside 0.10…0.75 turns the bore amber
 * before the calculation refuses it.
 */
export function OrificeDiagram({ D20, d20, otbor, otborLabel }: Props) {
  const D = num(D20)
  const d = num(d20)
  // Geometry only needs the ratio; thermal expansion moves it by <0.1 %.
  const betaRaw = D && d ? d / D : null
  const beta = betaRaw != null ? Math.min(betaRaw, 1) : null
  // Nothing entered yet reads as "no verdict", not as a problem.
  const outOfRange = betaRaw != null && (betaRaw < 0.1 || betaRaw > 0.75)

  // Pipe interior spans y 18…102 (84 px ≙ D). The bore is β of that.
  const top = 18
  const bottom = 102
  const axis = (top + bottom) / 2
  const halfBore = beta != null ? (beta * (bottom - top)) / 2 : 0
  const plateX = 178
  const plateW = 9

  const stroke = 'var(--hlv-border)'
  const metal = 'var(--mantine-color-steel-5)'
  const accent = outOfRange ? 'var(--mantine-color-amber-5)' : 'var(--mantine-color-petrol-5)'

  // Tapping positions, ф. 5.6: corner at the plate faces, D–D/2, flange ±25.4 mm.
  const tapOffset = otbor === 1 ? 46 : otbor === 2 ? 18 : 6
  const taps = [plateX - tapOffset, plateX + plateW + (otbor === 1 ? tapOffset / 2 : tapOffset)]

  return (
    <Box>
      <Box
        component="svg"
        viewBox="0 0 320 128"
        style={{ width: '100%', maxWidth: 380, display: 'block' }}
        role="img"
        aria-label="Orifice cross-section"
      >
        {/* Pipe walls */}
        <rect x="8" y={top - 9} width="304" height="9" fill={metal} opacity="0.45" />
        <rect x="8" y={bottom} width="304" height="9" fill={metal} opacity="0.45" />
        <line x1="8" y1={top} x2="312" y2={top} stroke={stroke} />
        <line x1="8" y1={bottom} x2="312" y2={bottom} stroke={stroke} />

        {/* Axis */}
        <line
          x1="8"
          y1={axis}
          x2="312"
          y2={axis}
          stroke={stroke}
          strokeDasharray="7 4 2 4"
          opacity="0.9"
        />

        {beta != null && (
          <>
            {/* Plate: two halves leaving the bore between them */}
            <rect x={plateX} y={top} width={plateW} height={axis - halfBore - top} fill={metal} />
            <rect
              x={plateX}
              y={axis + halfBore}
              width={plateW}
              height={bottom - axis - halfBore}
              fill={metal}
            />

            {/* Jet: contracts through the bore, then spreads again */}
            <path
              d={`M ${plateX} ${axis - halfBore}
                  C ${plateX + 26} ${axis - halfBore}, ${plateX + 30} ${axis - halfBore * 0.62}, ${plateX + 52} ${axis - halfBore * 0.62}
                  L ${plateX + 96} ${axis - halfBore * 0.95}
                  L ${plateX + 96} ${axis + halfBore * 0.95}
                  L ${plateX + 52} ${axis + halfBore * 0.62}
                  C ${plateX + 30} ${axis + halfBore * 0.62}, ${plateX + 26} ${axis + halfBore}, ${plateX} ${axis + halfBore} Z`}
              fill={accent}
              opacity="0.16"
            />
            <line
              x1={plateX}
              y1={axis - halfBore}
              x2={plateX + plateW}
              y2={axis - halfBore}
              stroke={accent}
              strokeWidth="2"
            />
            <line
              x1={plateX}
              y1={axis + halfBore}
              x2={plateX + plateW}
              y2={axis + halfBore}
              stroke={accent}
              strokeWidth="2"
            />

            {/* d dimension, at the bore */}
            <line
              x1={plateX + plateW / 2}
              y1={axis - halfBore}
              x2={plateX + plateW / 2}
              y2={axis + halfBore}
              stroke={accent}
              strokeWidth="1"
              markerStart="url(#fc-arrow)"
              markerEnd="url(#fc-arrow)"
            />
            <text
              x={plateX + plateW + 6}
              y={axis - halfBore - 5}
              fill={accent}
              fontSize="11"
              fontWeight="600"
            >
              d
            </text>
          </>
        )}

        {/* Flow direction */}
        <line
          x1="20"
          y1={axis}
          x2="70"
          y2={axis}
          stroke={accent}
          strokeWidth="1.5"
          markerEnd="url(#fc-arrow-solid)"
        />

        {/* D dimension, upstream of the plate */}
        <line
          x1="104"
          y1={top}
          x2="104"
          y2={bottom}
          stroke="var(--mantine-color-dimmed)"
          strokeWidth="1"
          markerStart="url(#fc-arrow)"
          markerEnd="url(#fc-arrow)"
        />
        <text x="110" y={axis - 5} fill="var(--mantine-color-dimmed)" fontSize="11" fontWeight="600">
          D
        </text>

        {/* Pressure tappings */}
        {taps.map((x, i) => (
          <g key={i}>
            <line x1={x} y1={top - 9} x2={x} y2={top} stroke={accent} strokeWidth="2" />
            <circle cx={x} cy={top - 11} r="2.5" fill={accent} />
          </g>
        ))}

        <defs>
          <marker id="fc-arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6" fill="none" stroke="currentColor" strokeWidth="1" />
          </marker>
          <marker
            id="fc-arrow-solid"
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
          >
            <path d="M0,0 L7,3.5 L0,7 Z" fill={accent} />
          </marker>
        </defs>
      </Box>

      <Group gap="lg" mt={4}>
        <Text size="10px" c="dimmed">
          D₂₀{' '}
          <Text span style={numericStyle} c={D ? undefined : 'dimmed'}>
            {D ? D.toFixed(2) : '—'}
          </Text>{' '}
          мм
        </Text>
        <Text size="10px" c="dimmed">
          d₂₀{' '}
          <Text span style={numericStyle} c={d ? undefined : 'dimmed'}>
            {d ? d.toFixed(2) : '—'}
          </Text>{' '}
          мм
        </Text>
        <Text size="10px" c={outOfRange ? 'amber.5' : 'dimmed'}>
          β{' '}
          <Text span style={numericStyle} fw={600}>
            {betaRaw != null ? betaRaw.toFixed(4) : '—'}
          </Text>
        </Text>
        <Text size="10px" c="dimmed">
          {otborLabel}
        </Text>
      </Group>
    </Box>
  )
}
