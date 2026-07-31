/**
 * Every input the orifice form offers has to reach the result. These three had
 * to be checked by hand often enough to be worth pinning down: the pipe and
 * orifice MATERIALS (they set the thermal expansion of D and d, so they move β)
 * and the pipe ROUGHNESS (Кш).
 */
import { describe, it, expect } from 'vitest'
import { calculateFlowRate, INITIAL_INPUT, type FlowCalcInput } from './calculate'
import { MATERIALS } from './materials'

const t = (k: string) => k

/** A real orifice line: D20/d20 and gas from the archive, β ≈ 0.6. */
const BASE: FlowCalcInput = {
  ...INITIAL_INPUT,
  device: 'orifice',
  kst: 1,
  rho: '0.6874',
  co2: '0.2',
  n2: '1.1',
  pType: 0,
  p: '2.5',
  pU: 2, // МПа
  t: '10',
  dp: '25',
  dpU: 1, // кПа
  D20: '200',
  d20: '120',
  rsh: '0.05',
  rEdge: '0.04',
  timeOrifice: '2',
}

const flowOf = (patch: Partial<FlowCalcInput>): number => {
  const out = calculateFlowRate({ ...BASE, ...patch }, t)
  if (!out.ok) throw new Error(`calculation failed: ${JSON.stringify(out.errors)}`)
  return out.results.qStd ?? out.results.qW
}

describe('inputs that must reach the result', () => {
  const base = flowOf({})

  it('is a working baseline', () => {
    expect(base).toBeGreaterThan(0)
  })

  it('pipe material changes the flow — it expands the bore', () => {
    // Steel vs a materially different alloy: kD differs, so β and A0 do too.
    const other = MATERIALS.findIndex((_, i) => flowOf({ matPipe: i }) !== base)
    expect(other).toBeGreaterThanOrEqual(0)
    expect(flowOf({ matPipe: other })).not.toBe(base)
  })

  it('orifice material changes the flow', () => {
    const other = MATERIALS.findIndex((_, i) => flowOf({ matOrifice: i }) !== base)
    expect(other).toBeGreaterThanOrEqual(0)
    expect(flowOf({ matOrifice: other })).not.toBe(base)
  })

  it('roughness changes the flow once it leaves the admissible band', () => {
    // Кш is 1 while Ra sits inside the band, so a value that stays inside
    // legitimately changes nothing — the check has to use one that does not.
    // Outside the band Кш > 1: a rough pipe raises the discharge coefficient.
    expect(flowOf({ rsh: '2' })).toBeGreaterThan(base)
  })

  it('rejects a roughness of 0 — which is what rounding to 2 decimals produced', () => {
    // The archive holds 0.0032 and 0.005 mm on real orifice lines. Rounded to
    // two decimals they became "0", and 0 is outside the accepted 0.001…2.5
    // range, so the pull left the form unable to calculate at all.
    expect(calculateFlowRate({ ...BASE, rsh: '0.0032' }, t).ok).toBe(true)
    const zero = calculateFlowRate({ ...BASE, rsh: '0' }, t)
    expect(zero.ok).toBe(false)
    if (!zero.ok) expect(zero.errors.rsh).toBeDefined()
  })

  it('the orifice edge radius and its operating time change the flow (Кп)', () => {
    expect(flowOf({ rEdge: '0.15', timeOrifice: '10' })).not.toBe(base)
  })
})
