/**
 * X-axis tick for the time-series charts.
 *
 * Two modes, and the axis picks between them by how much room it has:
 *
 *  - upright, date over time on two lines, while the labels fit side by side.
 *    Straight text is easier to read and the axis stays 26–40 px tall.
 *  - slanted −45°, one line, when there are more points than upright labels
 *    fit. A slanted label needs only ~20 px of width instead of ~46, so a year
 *    of data gets two to three times more dates on the axis.
 *
 * The slanted mode was tried once before and reverted because the dates came
 * out truncated. That was not the rotation: the axis height stayed at the
 * upright value, and recharts clips whatever does not fit it. A rotated label
 * is laid out along its own diagonal, so the height it needs follows from the
 * label's length — hence `timeAxisHeight` takes the label width, and the chart
 * measures it rather than assuming.
 */

const FONT_SIZE = 11
const LINE_H = 12
/** −45° — sin and cos are the same, so one constant does both projections. */
const DIAGONAL = Math.SQRT1_2

interface TickProps {
  x?: number
  y?: number
  payload?: { value?: string | number }
  /** Both lines of the label; the second is omitted when empty. */
  format: (value: string) => [string, string]
  fill: string
  /** Slanted single-line label instead of two upright lines. */
  slanted?: boolean
}

export function TimeAxisTick({ x = 0, y = 0, payload, format, fill, slanted }: TickProps) {
  if (!payload) return null
  const [top, bottom] = format(String(payload.value ?? ''))

  if (slanted) {
    // Anchored at the tick and running down-left, so the label points at the
    // value it belongs to instead of straddling it.
    const label = bottom ? `${top} ${bottom}` : top
    return (
      <text
        x={x}
        y={y}
        dy={10}
        textAnchor="end"
        transform={`rotate(-45, ${x}, ${y})`}
        fill={fill}
        fontSize={FONT_SIZE}
      >
        {label}
      </text>
    )
  }

  return (
    <text x={x} y={y} dy={12} textAnchor="middle" fill={fill} fontSize={FONT_SIZE}>
      <tspan x={x}>{top}</tspan>
      {bottom && (
        <tspan x={x} dy={13}>
          {bottom}
        </tspan>
      )}
    </text>
  )
}

/**
 * Height the axis needs. Upright: one line, or two plus the tick marks.
 * Slanted: the label's own diagonal, which is what the earlier attempt got
 * wrong — `labelWidth` is the widest label in pixels.
 */
export function timeAxisHeight(twoLine: boolean, slantedLabelWidth?: number): number {
  if (slantedLabelWidth != null) {
    return Math.round(DIAGONAL * (slantedLabelWidth + LINE_H) + 6)
  }
  return twoLine ? 40 : 26
}

/** Horizontal room one label needs before the next one touches it. */
export const UPRIGHT_LABEL_W = 46
/** Slanted labels only have to clear each other's line height, not their length. */
export const SLANTED_LABEL_W = Math.ceil(LINE_H / DIAGONAL) + 3

/**
 * Slant only once upright labels would be spread this thin.
 *
 * Not "as soon as one date has to be dropped": a month labelled every other day
 * still reads perfectly upright, and turning the axis for that would cost
 * height and legibility for nothing. Past 2.5 points per label the axis becomes
 * a few lonely dates under a dense curve, and slanting earns its keep.
 */
export const SLANT_ABOVE = 2.5

/** Rough pixel width of a label at this font — digits and dots, so no measuring. */
export const labelPixels = (label: string) => label.length * 6.1
