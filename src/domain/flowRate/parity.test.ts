/**
 * Bit-for-bit parity between the TypeScript port and the original calculation.
 *
 * The oracle is not a second transcription: scripts/gen-flowrate-oracle.mjs
 * extracts the physics VERBATIM out of the legacy FlowRateCalc.jsx. So a green
 * run here means the port reproduces the original source exactly, down to the
 * last ULP — which is the requirement for this screen.
 *
 * Comparisons use Object.is, so NaN must match NaN and −0 must match −0.
 */
import { describe, it, expect } from 'vitest'
import { zStd, ppk, tpk, zNX19, zGERG91, gasViscosity, adiabat } from './gost30319'
import {
  dischargeCoeff,
  roundHalfEven,
  raMax,
  raMin,
  lambdaFriction,
  roughnessCoeff,
  bluntnessCoeff,
  expansibility,
  orificeFlow,
  R_EDGE_MAX,
} from './dstu8586'
import { MATERIALS, MATERIAL_COEFFS, expansionFactor, matchMaterialIndex } from './materials'
import { calculateFlowRate, T0, P0, RHO_AIR, type FlowCalcInput } from './calculate'
import { P_UNITS } from '@/domain/pressureUnits'

// Typed as `any` via __oracle__/oracle.d.ts — the oracle is generated JS that
// stays out of the TypeScript program on purpose.
import * as O from './__oracle__/original.generated.mjs'

/** Deterministic PRNG so a failure is always reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Asserts identity, reporting the arguments that produced a mismatch. */
function same(actual: number, expected: number, args: unknown[], label: string) {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `${label}(${args.join(', ')}): port ${actual} !== original ${expected}`,
    )
  }
}

/** Random gas composition inside the ГОСТ 30319 validity box. */
function gasSample(r: () => number) {
  return {
    rho: 0.67 + r() * 0.33,
    xa: r() * 0.16,
    xy: r() * 0.16,
    p: 0.1 + r() * 10.9,
    ts: 249.9 + r() * 93.5, // −23.15…70 °C
  }
}

describe('flow-rate parity — constants', () => {
  it('shares the standard-condition constants', () => {
    expect(T0).toBe(O.T0)
    expect(P0).toBe(O.P0)
    expect(RHO_AIR).toBe(O.RHO_AIR)
    expect(R_EDGE_MAX).toBe(0.000195)
  })

  it('has the same material list, in the same order', () => {
    expect(MATERIALS.length).toBe(O.MATERIALS.length)
    MATERIALS.forEach((m, i) => {
      expect([i, m.label, m.a]).toEqual([i, O.MATERIALS[i].label, O.MATERIALS[i].a])
    })
  })

  it('has the same expansion-coefficient table, including the null rows', () => {
    expect(MATERIAL_COEFFS.length).toBe(O.MATERIAL_COEFFS.length)
    MATERIAL_COEFFS.forEach((c, i) => {
      const o = O.MATERIAL_COEFFS[i]
      if (c === null || o === null) {
        expect([i, c]).toEqual([i, o])
        return
      }
      expect([i, ...c]).toEqual([i, ...o])
    })
  })
})

describe('flow-rate parity — ГОСТ 30319', () => {
  it('zStd / ppk / tpk over the composition box', () => {
    const r = rng(1)
    for (let i = 0; i < 4000; i++) {
      const { rho, xa, xy } = gasSample(r)
      const a = [rho, xa, xy]
      same(zStd(rho, xa, xy), O.zStd(rho, xa, xy), a, 'zStd')
      same(ppk(rho, xa, xy), O.ppk(rho, xa, xy), a, 'ppk')
      same(tpk(rho, xa, xy), O.tpk(rho, xa, xy), a, 'tpk')
    }
  })

  it('zNX19 over the p–T box, including the piecewise F seams', () => {
    const r = rng(2)
    for (let i = 0; i < 6000; i++) {
      const { rho, xa, xy, p, ts } = gasSample(r)
      const a = [rho, xa, xy, p, ts]
      same(zNX19(rho, xa, xy, p, ts), O.zNX19(rho, xa, xy, p, ts), a, 'zNX19')
    }
  })

  it('zNX19 on a dense low-pressure sweep (where F branches overlap)', () => {
    for (let ip = 0; ip <= 60; ip++) {
      for (let it = 0; it <= 40; it++) {
        const p = 0.1 + ip * 0.18
        const ts = 250 + it * 2.3
        const a = [0.68, 0.01, 0.005, p, ts]
        same(
          zNX19(0.68, 0.01, 0.005, p, ts),
          O.zNX19(0.68, 0.01, 0.005, p, ts),
          a,
          'zNX19',
        )
      }
    }
  })

  it('zGERG91 over the p–T box', () => {
    const r = rng(3)
    for (let i = 0; i < 6000; i++) {
      const { rho, xa, xy, p, ts } = gasSample(r)
      const a = [rho, xa, xy, p, ts]
      same(zGERG91(rho, xa, xy, p, ts), O.zGERG91(rho, xa, xy, p, ts), a, 'zGERG91')
    }
  })

  it('gasViscosity and adiabat', () => {
    const r = rng(4)
    for (let i = 0; i < 6000; i++) {
      const { rho, xa, xy, p, ts } = gasSample(r)
      same(
        gasViscosity(rho, xa, xy, p, ts),
        O.gasViscosity(rho, xa, xy, p, ts),
        [rho, xa, xy, p, ts],
        'gasViscosity',
      )
      same(adiabat(rho, xa, p, ts), O.adiabat(rho, xa, p, ts), [rho, xa, p, ts], 'adiabat')
    }
  })
})

describe('flow-rate parity — ДСТУ ГОСТ 8.586', () => {
  it('dischargeCoeff for every tapping type, across the small-bore threshold', () => {
    const r = rng(5)
    for (let i = 0; i < 8000; i++) {
      const beta = 0.1 + r() * 0.65
      const re = 10 ** (3 + r() * 5)
      const otbor = i % 3
      // Straddle D = 71.12 mm so the small-bore term is exercised both ways.
      const d = 20 + r() * 180
      const a = [beta, re, otbor, d]
      same(
        dischargeCoeff(beta, re, otbor, d),
        O.dischargeCoeff(beta, re, otbor, d),
        a,
        'dischargeCoeff',
      )
    }
  })

  it('dischargeCoeff exactly at the small-bore boundary', () => {
    for (const d of [71.11, 71.12, 71.13]) {
      for (const otbor of [0, 1, 2]) {
        same(
          dischargeCoeff(0.5, 1e6, otbor, d),
          O.dischargeCoeff(0.5, 1e6, otbor, d),
          [0.5, 1e6, otbor, d],
          'dischargeCoeff',
        )
      }
    }
  })

  it('roundHalfEven matches C# banker rounding', () => {
    const r = rng(6)
    const cases: [number, number][] = [
      [0.125, 2],
      [0.135, 2],
      [0.145, 2],
      [2.5, 0],
      [3.5, 0],
      [-2.5, 0],
      [-0.5, 0],
      [1.25, 1],
      [1.35, 1],
      [14.5, 0],
      [15.5, 0],
    ]
    for (let i = 0; i < 3000; i++) {
      cases.push([r() * 40 - 20, i % 3])
    }
    for (const [v, d] of cases) {
      same(roundHalfEven(v, d), O.roundHalfEven(v, d), [v, d], 'roundHalfEven')
    }
  })

  it('raMax / raMin across every Re band and both β regimes', () => {
    const r = rng(7)
    for (let i = 0; i < 8000; i++) {
      const re = 10 ** (3 + r() * 6) // 1e3 … 1e9, so the out-of-range NaN is hit too
      const beta = 0.1 + r() * 0.65
      const dM = 0.05 + r() * 1.15
      const a = [re, beta, dM]
      same(raMax(re, beta, dM), O.raMax(re, beta, dM), a, 'raMax')
      same(raMin(re, beta, dM), O.raMin(re, beta, dM), a, 'raMin')
    }
    // Band edges, where the piecewise selection changes.
    for (const re of [1e4, 1e4 + 1, 1e5, 1e5 + 1, 3e6, 3e6 + 1, 1e8, 1e8 + 1]) {
      for (const beta of [0.2, 0.64, 0.65, 0.66, 0.75]) {
        same(raMax(re, beta, 0.3), O.raMax(re, beta, 0.3), [re, beta, 0.3], 'raMax')
        same(raMin(re, beta, 0.3), O.raMin(re, beta, 0.3), [re, beta, 0.3], 'raMin')
      }
    }
  })

  it('lambdaFriction', () => {
    const r = rng(8)
    for (let i = 0; i < 5000; i++) {
      const re = 10 ** (4 + r() * 4)
      const ash = r() * 0.002
      const kd = r() * 0.01
      const kr = 5.035 / re
      const dM = 0.05 + r() * 1.15
      const a = [re, ash, kd, kr, dM]
      same(
        lambdaFriction(re, ash, kd, kr, dM),
        O.lambdaFriction(re, ash, kd, kr, dM),
        a,
        'lambdaFriction',
      )
    }
  })

  it('roughnessCoeff, including inside and outside the admissible band', () => {
    const r = rng(9)
    for (let i = 0; i < 8000; i++) {
      const re = 10 ** (4 + r() * 4)
      const beta = 0.1 + r() * 0.65
      const dM = 0.05 + r() * 1.15
      // 0.001…2.5 mm is the accepted Rsh range; converted to metres here.
      const rshM = (0.001 + r() * 2.499) * 1e-3
      const a = [re, beta, dM, rshM]
      same(
        roughnessCoeff(re, beta, dM, rshM),
        O.roughnessCoeff(re, beta, dM, rshM),
        a,
        'roughnessCoeff',
      )
    }
  })

  it('bluntnessCoeff for both time types, including the years → 0 guard', () => {
    const r = rng(10)
    for (let i = 0; i < 6000; i++) {
      const dM = 0.0125 + r() * 0.9
      const rnM = r() * 0.001
      const years = i % 7 === 0 ? 0 : r() * 100
      const timeType = i % 2
      const a = [dM, rnM, years, timeType]
      same(
        bluntnessCoeff({ dM, rnM, years, timeType }),
        O.bluntnessCoeff({ d_m: dM, rn_m: rnM, years, timeType }),
        a,
        'bluntnessCoeff',
      )
    }
    // Exactly on the 0.0004·d threshold, for both branches.
    for (const timeType of [0, 1]) {
      const dM = 0.1
      const rnM = 0.0004 * dM
      same(
        bluntnessCoeff({ dM, rnM, years: 0, timeType }),
        O.bluntnessCoeff({ d_m: dM, rn_m: rnM, years: 0, timeType }),
        [dM, rnM, 0, timeType],
        'bluntnessCoeff',
      )
    }
  })

  it('expansibility', () => {
    const r = rng(11)
    for (let i = 0; i < 5000; i++) {
      const beta = 0.1 + r() * 0.65
      const p1 = 1e5 + r() * 1e7
      const dp = r() * p1 * 0.5
      const kappa = 1.2 + r() * 0.4
      const a = [beta, dp, p1, kappa]
      same(
        expansibility(beta, dp, p1, kappa),
        O.expansibility(beta, dp, p1, kappa),
        a,
        'expansibility',
      )
    }
  })

  it('orificeFlow — every returned field, over random plausible meters', () => {
    const r = rng(12)
    for (let i = 0; i < 3000; i++) {
      const dPipeMm = 50 + r() * 400
      // Keep β inside 0.1…0.75 the way the form validation does.
      const dOrificeMm = dPipeMm * (0.12 + r() * 0.6)
      const kD = 1 + (r() - 0.5) * 1e-3
      const kd = 1 + (r() - 0.5) * 1e-3
      const p1Pa = 1e5 + r() * 6e6
      const dpPa = r() * Math.min(p1Pa * 0.4, 2e5)
      const rhoW = 0.7 + r() * 60
      const mu = (9 + r() * 6) * 1e-6
      const otborIdx = i % 3
      const kappa = 1.2 + r() * 0.4
      const rshMm = 0.001 + r() * 2.499
      const rEdgeMm = r() * 0.5
      const years = i % 5 === 0 ? 0 : r() * 100
      const timeType = i % 2

      const mine = orificeFlow({
        dPipeMm,
        dOrificeMm,
        kD,
        kd,
        dpPa,
        p1Pa,
        rhoW,
        mu,
        otborIdx,
        kappa,
        rshMm,
        rEdgeMm,
        years,
        timeType,
      })
      const theirs = O.orificeFlow({
        D_mm: dPipeMm,
        d_mm: dOrificeMm,
        kD,
        kd,
        dP_Pa: dpPa,
        P1_Pa: p1Pa,
        rho_w: rhoW,
        mu,
        otborIdx,
        kappa,
        Rsh_mm: rshMm,
        rEdge_mm: rEdgeMm,
        years,
        timeType,
      })

      const args = [dPipeMm, dOrificeMm, dpPa, p1Pa, rhoW, mu, otborIdx, rshMm, rEdgeMm]
      same(mine.qm, theirs.qm, args, 'orificeFlow.qm')
      same(mine.C, theirs.C, args, 'orificeFlow.C')
      same(mine.Ksh, theirs.Ksh, args, 'orificeFlow.Ksh')
      same(mine.Kbl, theirs.Kbl, args, 'orificeFlow.Kbl')
      same(mine.eps, theirs.eps, args, 'orificeFlow.eps')
      same(mine.beta, theirs.beta, args, 'orificeFlow.beta')
      same(mine.dtMm, theirs.DT_mm, args, 'orificeFlow.DT_mm')
      same(mine.dOrificeTMm, theirs.dT_mm, args, 'orificeFlow.dT_mm')
      same(mine.reD, theirs.Re_D, args, 'orificeFlow.Re_D')
    }
  })
})

describe('flow-rate parity — materials', () => {
  it('expansionFactor for every material over the working temperature range', () => {
    for (let idx = 0; idx < MATERIALS.length; idx++) {
      for (let k = 0; k <= 100; k++) {
        const tC = -23.15 + (k * 93.15) / 100
        same(
          expansionFactor(idx, tC),
          O.expansionFactor(idx, tC),
          [idx, tC],
          'expansionFactor',
        )
      }
    }
  })

  it('matchMaterialIndex — exact rows, perturbed rows and far-away triples', () => {
    for (let i = 0; i < MATERIAL_COEFFS.length; i++) {
      const c = MATERIAL_COEFFS[i]
      if (!c) continue
      expect([i, matchMaterialIndex(c[0], c[1], c[2])]).toEqual([
        i,
        O.matchMaterialIndex(c[0], c[1], c[2]),
      ])
      const [a0, a1, a2] = [c[0] + 0.02, c[1] - 0.03, c[2] + 0.01]
      expect([i, matchMaterialIndex(a0, a1, a2)]).toEqual([
        i,
        O.matchMaterialIndex(a0, a1, a2),
      ])
    }
    const odd: [unknown, unknown, unknown][] = [
      [null, 1, 1],
      [undefined, 1, 1],
      [NaN, 1, 1],
      [999, 999, 999],
      [11.1, null, null],
      [11.1, undefined, undefined],
      [10.8, 9.0, -4.2],
    ]
    for (const [a0, a1, a2] of odd) {
      expect([a0, matchMaterialIndex(a0 as number, a1 as number, a2 as number)]).toEqual([
        a0,
        O.matchMaterialIndex(a0, a1, a2),
      ])
    }
  })
})

// ── End-to-end: the whole handleCalc chain ───────────────────────────────────

/** The original handleCalc body, expressed against the oracle module. */
function originalChain(s: FlowCalcInput, mtype: 'orifice' | 'meter') {
  const pf = (v: string) => {
    const n = parseFloat(String(v).replace(',', '.'))
    return isNaN(n) ? null : n
  }
  const rho = pf(s.rho)!
  const co2 = pf(s.co2) ?? 0
  const n2 = pf(s.n2) ?? 0
  const tC = pf(s.t)!
  const pv = pf(s.p)!
  const pPa = pv * P_UNITS[s.pU].k
  const P1_Pa = s.pType === 0 ? pPa : pPa + (pf(s.patm) ?? 101325) * P_UNITS[s.patmU].k
  const gamma = rho / O.RHO_AIR
  const T_K = tC + 273.15
  const P_MPa = P1_Pa * 1e-6
  const xa = n2 / 100
  const xy = co2 / 100
  const Tpc = O.tpk(rho, xa, xy)
  const Ppc = O.ppk(rho, xa, xy)
  const Pr = P_MPa / Ppc
  const Tr = T_K / Tpc
  const Zc = O.zStd(rho, xa, xy)
  const Z =
    s.kst === 1 ? O.zGERG91(rho, xa, xy, P_MPa, T_K) : O.zNX19(rho, xa, xy, P_MPa, T_K)
  const K = Z / Zc
  const Kp = ((P_MPa / O.P0) * (O.T0 / T_K)) / K
  const rho_w = rho * Kp
  const mu = O.gasViscosity(rho, xa, xy, P_MPa, T_K)
  const kappa = O.adiabat(rho, xa, P_MPa, T_K)

  let oRes = null
  let Q_w = 0
  let Q_std: number | null = null
  if (mtype === 'orifice') {
    const D20v = pf(s.D20)!
    const d20v = pf(s.d20)!
    const dP_Pa = pf(s.dp)! * P_UNITS[s.dpU].k
    const rshv = pf(s.rsh)!
    const rEdgev = s.rEdge === '' ? 0 : pf(s.rEdge)!
    const yearsv = s.timeOrifice === '' ? 0 : pf(s.timeOrifice)!
    const kD = O.expansionFactor(s.matPipe, tC)
    const kd = O.expansionFactor(s.matOrifice, tC)
    oRes = O.orificeFlow({
      D_mm: D20v,
      d_mm: d20v,
      kD,
      kd,
      dP_Pa,
      P1_Pa,
      rho_w,
      mu,
      otborIdx: s.otbor,
      kappa,
      Rsh_mm: rshv,
      rEdge_mm: rEdgev,
      years: yearsv,
      timeType: s.timeType,
    })
    Q_w = (oRes.qm / rho_w) * 3600
    Q_std = (oRes.qm / rho) * 3600
  } else {
    Q_w = pf(s.qw) ?? 0
    Q_std = Q_w > 0 ? Q_w * Kp : null
  }
  return { Z, Zc, K, Kp, rho_w, gamma, Tpc, Ppc, Pr, Tr, P_MPa, T_K, mu, kappa, oRes, Q_w, Q_std }
}

const t = (k: string) => k

describe('flow-rate parity — calculateFlowRate end to end', () => {
  it('reproduces handleCalc for random valid orifice inputs, both Kst methods', () => {
    const r = rng(13)
    for (let i = 0; i < 800; i++) {
      const D20 = 50 + r() * 500
      const d20 = Math.max(12.5, D20 * (0.15 + r() * 0.55))
      const s: FlowCalcInput = {
        device: 'orifice',
        kst: (1 + (i % 2)) as 1 | 2,
        rho: String(0.67 + r() * 0.33),
        co2: String(r() * 5),
        n2: String(r() * 5),
        pType: i % 2,
        patm: '101.325',
        patmU: 1,
        p: String(500 + r() * 4000), // кПа
        pU: 1,
        t: String(-20 + r() * 85),
        otbor: i % 3,
        dp: String(1 + r() * 60), // кПа
        dpU: 1,
        D20: String(D20),
        matPipe: i % MATERIALS.length,
        rsh: String(0.001 + r() * 0.3),
        d20: String(d20),
        matOrifice: (i * 7) % MATERIALS.length,
        rEdge: r() < 0.2 ? '' : String(r() * 0.4),
        timeType: i % 2,
        timeOrifice: r() < 0.2 ? '' : String(r() * 40),
        qw: '',
      }

      const out = calculateFlowRate(s, t)
      const beta =
        (parseFloat(s.d20) * O.expansionFactor(s.matOrifice, parseFloat(s.t))) /
        (parseFloat(s.D20) * O.expansionFactor(s.matPipe, parseFloat(s.t)))
      if (beta < 0.1 || beta > 0.75) {
        expect(out.ok).toBe(false)
        continue
      }
      expect(out.ok).toBe(true)
      if (!out.ok) continue

      const exp = originalChain(s, 'orifice')
      const args = [i]
      same(out.results.Z, exp.Z, args, 'Z')
      same(out.results.Zc, exp.Zc, args, 'Zc')
      same(out.results.K, exp.K, args, 'K')
      same(out.results.Kp, exp.Kp, args, 'Kp')
      same(out.results.rhoW, exp.rho_w, args, 'rho_w')
      same(out.results.gamma, exp.gamma, args, 'gamma')
      same(out.results.Tpc, exp.Tpc, args, 'Tpc')
      same(out.results.Ppc, exp.Ppc, args, 'Ppc')
      same(out.results.Pr, exp.Pr, args, 'Pr')
      same(out.results.Tr, exp.Tr, args, 'Tr')
      same(out.results.pMPa, exp.P_MPa, args, 'P_MPa')
      same(out.results.tK, exp.T_K, args, 'T_K')
      same(out.results.mu, exp.mu, args, 'mu')
      same(out.results.kappa, exp.kappa, args, 'kappa')
      same(out.results.qW, exp.Q_w, args, 'Q_w')
      same(out.results.qStd!, exp.Q_std!, args, 'Q_std')
      same(out.results.orifice!.qm, exp.oRes.qm, args, 'oRes.qm')
      same(out.results.orifice!.C, exp.oRes.C, args, 'oRes.C')
      same(out.results.orifice!.Ksh, exp.oRes.Ksh, args, 'oRes.Ksh')
      same(out.results.orifice!.Kbl, exp.oRes.Kbl, args, 'oRes.Kbl')
      same(out.results.orifice!.eps, exp.oRes.eps, args, 'oRes.eps')
      same(out.results.orifice!.reD, exp.oRes.Re_D, args, 'oRes.Re_D')
    }
  })

  it('reproduces handleCalc for meter inputs', () => {
    const r = rng(14)
    for (let i = 0; i < 500; i++) {
      const s: FlowCalcInput = {
        device: 'meter',
        kst: (1 + (i % 2)) as 1 | 2,
        rho: String(0.67 + r() * 0.33),
        co2: String(r() * 5),
        n2: String(r() * 5),
        pType: i % 2,
        patm: '101.325',
        patmU: 1,
        p: String(500 + r() * 4000),
        pU: 1,
        t: String(-20 + r() * 85),
        otbor: 0,
        dp: '',
        dpU: 1,
        D20: '',
        matPipe: 2,
        rsh: '0.05',
        d20: '',
        matOrifice: 15,
        rEdge: '0',
        timeType: 0,
        timeOrifice: '',
        qw: i % 9 === 0 ? '0' : String(r() * 5000),
      }
      const out = calculateFlowRate(s, t)
      expect(out.ok).toBe(true)
      if (!out.ok) continue
      const exp = originalChain(s, 'meter')
      same(out.results.Kp, exp.Kp, [i], 'Kp')
      same(out.results.qW, exp.Q_w, [i], 'Q_w')
      expect(out.results.qStd).toBe(exp.Q_std)
      expect(out.results.orifice).toBeNull()
    }
  })

  it('applies the same validation gates as the original', () => {
    const base: FlowCalcInput = {
      device: 'orifice',
      kst: 2,
      rho: '0.68',
      co2: '0.5',
      n2: '1',
      pType: 0,
      patm: '101.325',
      patmU: 1,
      p: '3000',
      pU: 1,
      t: '10',
      otbor: 0,
      dp: '30',
      dpU: 1,
      D20: '200',
      matPipe: 2,
      rsh: '0.05',
      d20: '100',
      matOrifice: 15,
      rEdge: '0',
      timeType: 0,
      timeOrifice: '',
      qw: '',
    }
    expect(calculateFlowRate(base, t).ok).toBe(true)

    const bad = (patch: Partial<FlowCalcInput>, field: string) => {
      const out = calculateFlowRate({ ...base, ...patch }, t)
      expect([field, out.ok]).toEqual([field, false])
      if (!out.ok) expect(Object.keys(out.errors)).toContain(field)
    }
    bad({ kst: 0 }, 'kst')
    bad({ rho: '0.5' }, 'rho')
    bad({ rho: '1.2' }, 'rho')
    bad({ rho: '' }, 'rho')
    bad({ co2: '20' }, 'co2')
    bad({ n2: '-1' }, 'n2')
    bad({ t: '-30' }, 't')
    bad({ t: '80' }, 't')
    bad({ p: '50' }, 'p') // 0.05 MPa — below the correlation range
    bad({ p: '12000' }, 'p') // 12 MPa — above it
    bad({ D20: '40' }, 'D20')
    bad({ d20: '10' }, 'd20')
    bad({ rsh: '3' }, 'rsh')
    bad({ rEdge: '2' }, 'rEdge')
    bad({ timeOrifice: '200' }, 'timeOrifice')
    bad({ dp: '4000' }, 'dp') // dP ≥ P1
    bad({ d20: '20' }, 'd20') // β = 0.1 − ε, out of range
    bad({ d20: '190' }, 'd20') // β > 0.75
  })

  it('treats empty edge radius and operating time as a sharp new orifice', () => {
    const base: FlowCalcInput = {
      device: 'orifice',
      kst: 2,
      rho: '0.68',
      co2: '0.5',
      n2: '1',
      pType: 0,
      patm: '101.325',
      patmU: 1,
      p: '3000',
      pU: 1,
      t: '10',
      otbor: 0,
      dp: '30',
      dpU: 1,
      D20: '200',
      matPipe: 2,
      rsh: '0.05',
      d20: '100',
      matOrifice: 15,
      rEdge: '',
      timeType: 0,
      timeOrifice: '',
      qw: '',
    }
    const a = calculateFlowRate(base, t)
    const b = calculateFlowRate({ ...base, rEdge: '0', timeOrifice: '0' }, t)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.results.orifice!.Kbl).toBe(1)
      expect(a.results.qW).toBe(b.results.qW)
    }
  })

  it('accepts a comma as the decimal separator, like the original form', () => {
    const s: FlowCalcInput = {
      device: 'meter',
      kst: 2,
      rho: '0,68',
      co2: '0,5',
      n2: '1',
      pType: 0,
      patm: '101.325',
      patmU: 1,
      p: '3000',
      pU: 1,
      t: '10',
      otbor: 0,
      dp: '',
      dpU: 1,
      D20: '',
      matPipe: 2,
      rsh: '0.05',
      d20: '',
      matOrifice: 15,
      rEdge: '0',
      timeType: 0,
      timeOrifice: '',
      qw: '1000',
    }
    const out = calculateFlowRate(s, t)
    expect(out.ok).toBe(true)
    if (out.ok) same(out.results.qStd!, originalChain(s, 'meter').Q_std!, [], 'Q_std')
  })
})
