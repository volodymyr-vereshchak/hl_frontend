/**
 * The flow-rate calculation pipeline, ported 1:1 from FlowRateCalc.jsx.
 *
 * Everything runs on the client — no network call takes part in the result. The
 * validation order and the exact range limits are part of the port: they come
 * from InputParameters.CheckValues / TrySetRsh / TrySetRn / TrySetTorifice in
 * CalcDSTU8586.dll, and a change here silently changes which inputs are accepted.
 */
import { P_UNITS } from '@/domain/pressureUnits'
import { zStd, zNX19, zGERG91, ppk, tpk, gasViscosity, adiabat } from './gost30319'
import { orificeFlow, type OrificeFlowResult } from './dstu8586'
import { expansionFactor } from './materials'

/** Standard conditions, ДСТУ 8585. */
export const T0 = 293.15 // K (20 °C)
export const P0 = 0.101325 // MPa
export const RHO_AIR = 1.2041 // kg/m³

export type DeviceType = 'orifice' | 'meter'
/** 0 — not selected, 1 — GERG-91 мод., 2 — NX-19 мод. */
export type KstMethod = 0 | 1 | 2

/**
 * Form state. Numeric fields stay strings so that "empty" and "0" remain
 * distinguishable exactly as in the original form.
 */
export interface FlowCalcInput {
  device: DeviceType
  kst: KstMethod
  rho: string
  co2: string
  n2: string
  /** 0 — absolute, 1 — gauge (atmospheric pressure is then added). */
  pType: number
  patm: string
  patmU: number
  p: string
  pU: number
  t: string
  /** 0 — кутовий, 1 — трьохрадіусний, 2 — фланцевий. */
  otbor: number
  dp: string
  dpU: number
  D20: string
  matPipe: number
  rsh: string
  d20: string
  matOrifice: number
  rEdge: string
  /** 0 — наработка, 1 — міжконтрольний інтервал. */
  timeType: number
  timeOrifice: string
  qw: string
}

export interface FlowCalcResults {
  kst: KstMethod
  Z: number
  Zc: number
  K: number
  Kp: number
  rhoW: number
  rho: number
  gamma: number
  Tpc: number
  Ppc: number
  Pr: number
  Tr: number
  pMPa: number
  tK: number
  mu: number
  kappa: number
  orifice: OrificeFlowResult | null
  /** Flow at working conditions, m³/h. */
  qW: number
  /** Flow reduced to standard conditions, m³/h; null when a meter reads zero. */
  qStd: number | null
}

export type FlowCalcErrors = Record<string, string>

export type FlowCalcOutcome =
  | { ok: true; results: FlowCalcResults }
  | { ok: false; errors: FlowCalcErrors }

/** Message lookup, so the domain stays free of the locale layer. */
export type Translate = (key: string) => string

/** Accepts both decimal separators, like the original form did. */
function parseNum(v: string): number | null {
  const n = parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
}

export function calculateFlowRate(s: FlowCalcInput, t: Translate): FlowCalcOutcome {
  const errs: FlowCalcErrors = {}
  const req = (field: string, v: number | null, lo?: number, hi?: number): number | null => {
    if (v === null) {
      errs[field] = t('fcEnterValue')
      return null
    }
    if (lo != null && v < lo) {
      errs[field] = `${t('fcMin')}: ${lo}`
      return null
    }
    if (hi != null && v > hi) {
      errs[field] = `${t('fcMax')}: ${hi}`
      return null
    }
    return v
  }

  // Kst must be selected.
  if (s.kst === 0) return { ok: false, errors: { kst: t('fcSelectKst') } }

  // Ranges are the ГОСТ 30319 validity limits (InputParameters.CheckValues).
  const rho = req('rho', parseNum(s.rho), 0.67, 1.0)
  const co2 = parseNum(s.co2) ?? 0
  const n2 = parseNum(s.n2) ?? 0
  if (co2 < 0 || co2 > 16) errs.co2 = t('fcRangeCo2N2')
  if (n2 < 0 || n2 > 16) errs.n2 = t('fcRangeCo2N2')
  const tC = req('t', parseNum(s.t), -23.15, 70)
  const pv = req('p', parseNum(s.p), 0)

  if (Object.keys(errs).length > 0) return { ok: false, errors: errs }

  const pPa = pv! * P_UNITS[s.pU].k
  const p1Pa =
    s.pType === 0 ? pPa : pPa + (parseNum(s.patm) ?? 101325) * P_UNITS[s.patmU].k
  if (p1Pa <= 0) return { ok: false, errors: { p: t('fcPMustPositive') } }

  const gamma = rho! / RHO_AIR
  const tK = tC! + 273.15
  const pMPa = p1Pa * 1e-6
  // The Z correlations are only defined over 0.1…11 MPa absolute.
  if (pMPa < 0.1 || pMPa > 11) return { ok: false, errors: { p: t('fcPRangeAbs') } }

  const xa = n2 / 100
  const xy = co2 / 100
  const Tpc = tpk(rho!, xa, xy)
  const Ppc = ppk(rho!, xa, xy)
  const Pr = pMPa / Ppc
  const Tr = tK / Tpc
  const Zc = zStd(rho!, xa, xy)
  const Z = s.kst === 1 ? zGERG91(rho!, xa, xy, pMPa, tK) : zNX19(rho!, xa, xy, pMPa, tK)
  // K = Z/Zc is what ГОСТ 30319 calls the compressibility ratio; the working
  // density and the conversion factor both go through it (ф. 6 ГОСТ 30319.1).
  const K = Z / Zc
  const Kp = ((pMPa / P0) * (T0 / tK)) / K
  const rhoW = rho! * Kp
  const mu = gasViscosity(rho!, xa, xy, pMPa, tK)
  const kappa = adiabat(rho!, xa, pMPa, tK)

  let orifice: OrificeFlowResult | null = null
  let qW = 0
  let qStd: number | null = null

  if (s.device === 'orifice') {
    const D20v = req('D20', parseNum(s.D20), 50, 1200)
    const d20v = req('d20', parseNum(s.d20), 12.5, 960)
    const dpv = req('dp', parseNum(s.dp), 0)
    if (Object.keys(errs).length > 0) return { ok: false, errors: errs }

    const dpPa = dpv! * P_UNITS[s.dpU].k
    if (dpPa >= p1Pa) return { ok: false, errors: { dp: t('fcDpMustLessP') } }

    // Edge radius and operating time default to 0 (a freshly sharp orifice),
    // which drives Кп to 1 rather than erroring out.
    const rshv = req('rsh', parseNum(s.rsh), 0.001, 2.5)
    const rEdgev = s.rEdge === '' ? 0 : req('rEdge', parseNum(s.rEdge), 0, 1.0)
    const yearsv = s.timeOrifice === '' ? 0 : req('timeOrifice', parseNum(s.timeOrifice), 0, 100)
    if (Object.keys(errs).length > 0) return { ok: false, errors: errs }

    const kD = expansionFactor(s.matPipe, tC!)
    const kd = expansionFactor(s.matOrifice, tC!)
    const beta = (d20v! * kd) / (D20v! * kD)
    if (beta < 0.1 || beta > 0.75) {
      return { ok: false, errors: { d20: `β = ${beta.toFixed(4)} ${t('fcBetaRange')}` } }
    }

    orifice = orificeFlow({
      dPipeMm: D20v!,
      dOrificeMm: d20v!,
      kD,
      kd,
      dpPa,
      p1Pa,
      rhoW,
      mu,
      otborIdx: s.otbor,
      kappa,
      rshMm: rshv!,
      rEdgeMm: rEdgev!,
      years: yearsv!,
      timeType: s.timeType,
    })
    qW = (orifice.qm / rhoW) * 3600
    qStd = (orifice.qm / rho!) * 3600
  } else {
    qW = parseNum(s.qw) ?? 0
    qStd = qW > 0 ? qW * Kp : null
  }

  return {
    ok: true,
    results: {
      kst: s.kst,
      Z,
      Zc,
      K,
      Kp,
      rhoW,
      rho: rho!,
      gamma,
      Tpc,
      Ppc,
      Pr,
      Tr,
      pMPa,
      tK,
      mu,
      kappa,
      orifice,
      qW,
      qStd,
    },
  }
}

/** Blank form, matching the original INIT. */
export const INITIAL_INPUT: FlowCalcInput = {
  device: 'orifice',
  kst: 0,
  rho: '',
  co2: '',
  n2: '',
  pType: 0,
  patm: '101.325',
  patmU: 1,
  p: '',
  pU: 1,
  t: '',
  otbor: 0,
  dp: '',
  dpU: 0,
  D20: '',
  matPipe: 2,
  rsh: '0.05',
  d20: '',
  matOrifice: 15,
  rEdge: '0',
  timeType: 0,
  timeOrifice: '',
  qw: '',
}
