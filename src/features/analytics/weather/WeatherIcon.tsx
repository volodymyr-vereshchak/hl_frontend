import './WeatherIcon.css'
import type { WeatherKind } from './weatherKind'

const SUN = '#f5b301'
const RAIN = '#3d8bfd'
const SNOW = '#cfe6ff'

function Sun({ small }: { small?: boolean }) {
  const [cx, cy, r, ray] = small ? [22, 22, 8, 13] : [32, 32, 11, 19]
  return (
    <g className={small ? 'sun-small' : undefined}>
      <g className="rays" stroke={SUN} strokeWidth={small ? 2 : 2.6} strokeLinecap="round">
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4
          return (
            <line
              key={i}
              x1={cx + Math.cos(a) * (r + 3)}
              y1={cy + Math.sin(a) * (r + 3)}
              x2={cx + Math.cos(a) * ray}
              y2={cy + Math.sin(a) * ray}
            />
          )
        })}
      </g>
      <circle cx={cx} cy={cy} r={r} fill={SUN} />
    </g>
  )
}

function Moon({ small }: { small?: boolean }) {
  return small ? (
    <path className="moon" d="M24 12a10 10 0 1 0 8 15 8 8 0 0 1-8-15z" fill="#e9d98f" />
  ) : (
    <path className="moon" d="M34 14a16 16 0 1 0 12 24 13 13 0 0 1-12-24z" fill="#e9d98f" />
  )
}

function Cloud({ back, dark }: { back?: boolean; dark?: boolean }) {
  const fill = dark ? '#8f9aa5' : back ? '#c9d1d9' : '#eef2f5'
  const stroke = dark ? '#6f7a85' : '#aab4bd'
  return (
    <path
      className={back ? 'cloud back' : 'cloud'}
      transform={back ? 'translate(-6 -6) scale(0.85)' : undefined}
      d="M18 44h28a9 9 0 0 0 0-18 12 12 0 0 0-23-3 8 8 0 0 0-5 21z"
      fill={fill}
      stroke={stroke}
      strokeWidth={1.2}
    />
  )
}

function Drops({ count, long }: { count: number; long?: boolean }) {
  const xs = [22, 30, 38, 46, 26, 34, 42]
  return (
    <g stroke={RAIN} strokeWidth={2.2} strokeLinecap="round">
      {xs.slice(0, count).map((x, i) => (
        <line
          key={i}
          className="drop"
          x1={x}
          y1={47}
          x2={x - 2}
          y2={long ? 55 : 52}
          style={{ animationDelay: `${(i * 0.27) % 1}s` }}
        />
      ))}
    </g>
  )
}

function Flakes({ count }: { count: number }) {
  const xs = [22, 31, 40, 47, 27, 36, 44]
  return (
    <g fill={SNOW} stroke="#9cc4ee" strokeWidth={0.6}>
      {xs.slice(0, count).map((x, i) => (
        <circle
          key={i}
          className="flake"
          cx={x}
          cy={50}
          r={2.2}
          style={{ animationDelay: `${(i * 0.53) % 2.8}s` }}
        />
      ))}
    </g>
  )
}

/** An animated picture of the weather. `night` puts the moon for the sun. */
export function WeatherIcon({
  kind,
  size = 48,
  night = false,
  still = false,
  title,
}: {
  kind: WeatherKind
  size?: number
  night?: boolean
  /** No animation — for long rows of small pictures. */
  still?: boolean
  title?: string
}) {
  const heavy = kind === 'shower' || kind === 'snowfall'
  const cls = [
    'hlv-wx',
    kind === 'drizzle' ? 'drizzle' : '',
    heavy ? 'heavy' : '',
    still ? 'still' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <svg
      className={cls}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
    >
      {title && <title>{title}</title>}
      {kind === 'clear' && (night ? <Moon /> : <Sun />)}
      {kind === 'partly' && (
        <>
          {night ? <Moon small /> : <Sun small />}
          <Cloud />
        </>
      )}
      {kind === 'cloudy' && (
        <>
          <Cloud back />
          <Cloud />
        </>
      )}
      {kind === 'fog' && (
        <>
          <Cloud back />
          <g stroke="#a7b1ba" strokeWidth={2.6} strokeLinecap="round">
            <line className="fog-line" x1={14} y1={48} x2={50} y2={48} />
            <line className="fog-line" x1={18} y1={54} x2={54} y2={54} />
            <line className="fog-line" x1={12} y1={42} x2={40} y2={42} />
          </g>
        </>
      )}
      {(kind === 'drizzle' || kind === 'rain' || kind === 'shower' || kind === 'thunder') && (
        <>
          {kind === 'drizzle' && (night ? <Moon small /> : <Sun small />)}
          <Cloud back={kind !== 'drizzle'} dark={kind !== 'drizzle'} />
          <Cloud dark={kind !== 'drizzle'} />
          <Drops
            count={kind === 'drizzle' ? 3 : kind === 'rain' ? 4 : 7}
            long={kind === 'shower'}
          />
          {kind === 'thunder' && (
            <polygon
              className="bolt"
              points="33,40 26,52 31,52 28,62 39,48 33,48 36,40"
              fill={SUN}
            />
          )}
        </>
      )}
      {kind === 'sleet' && (
        <>
          <Cloud back dark />
          <Cloud dark />
          <Drops count={2} />
          <Flakes count={3} />
        </>
      )}
      {(kind === 'snow' || kind === 'snowfall') && (
        <>
          <Cloud back dark={kind === 'snowfall'} />
          <Cloud dark={kind === 'snowfall'} />
          <Flakes count={kind === 'snow' ? 4 : 7} />
        </>
      )}
    </svg>
  )
}
