/**
 * X-axis tick for the time-series charts: the date on one line, the time under
 * it, both horizontal.
 *
 * The axis used to render its labels rotated -45°. A rotated label is laid out
 * along its own diagonal, so "01.07 07:00" needs far more vertical room than an
 * upright one, and recharts clips whatever does not fit the axis height — the
 * dates came out looking truncated. Stacked lines fit in half the space and
 * read straight.
 */

interface TickProps {
  x?: number
  y?: number
  payload?: { value?: string | number }
  /** Both lines of the label; the second is omitted when empty. */
  format: (value: string) => [string, string]
  fill: string
}

export function TimeAxisTick({ x = 0, y = 0, payload, format, fill }: TickProps) {
  if (!payload) return null
  const [top, bottom] = format(String(payload.value ?? ''))
  return (
    <text x={x} y={y} dy={12} textAnchor="middle" fill={fill} fontSize={11}>
      <tspan x={x}>{top}</tspan>
      {bottom && (
        <tspan x={x} dy={13}>
          {bottom}
        </tspan>
      )}
    </text>
  )
}

/** Height the axis needs: one line, or two plus the tick marks. */
export const timeAxisHeight = (twoLine: boolean) => (twoLine ? 40 : 26)
