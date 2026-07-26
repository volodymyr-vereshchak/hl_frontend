/**
 * ДСТУ ГОСТ 8.586 (orifice metering) — ported 1:1 from CalcDSTU8586.dll.
 *
 * Parity is pinned by src/domain/flowRate/parity.test.ts; transcription is
 * literal on purpose, so do not refactor the expressions.
 */

/**
 * Reader-Harris/Gallagher discharge coefficient, ф. 5.6 ДСТУ ГОСТ 8.586.2.
 * `dMm` is the *working* (thermally expanded) pipe bore, matching GetC().
 * `otborIdx`: 0 — кутовий, 1 — трьохрадіусний (D−D/2), 2 — фланцевий.
 */
export function dischargeCoeff(
  beta: number,
  reD: number,
  otborIdx: number,
  dMm: number,
): number {
  let L1: number, L2p: number
  if (otborIdx === 1) {
    L1 = 1
    L2p = 0.47
  } else if (otborIdx === 2) {
    L1 = 25.4 / dMm
    L2p = 25.4 / dMm
  } else {
    L1 = 0
    L2p = 0
  }

  const A = ((19000 * beta) / reD) ** 0.8
  const M2 = (2 * L2p) / (1 - beta)
  // Small-bore correction: applies only below D = 71.12 mm (2.8").
  const smallBore = dMm >= 71.12 ? 0 : 0.011 * (0.75 - beta) * (2.8 - dMm / 25.4)
  return (
    0.5961 +
    0.0261 * beta ** 2 -
    0.216 * beta ** 8 +
    0.000521 * ((1e6 * beta) / reD) ** 0.7 +
    (0.0188 + 0.0063 * A) * beta ** 3.5 * (1e6 / reD) ** 0.3 +
    ((0.043 + 0.08 * Math.exp(-10 * L1) - 0.123 * Math.exp(-7 * L1)) *
      (1 - 0.11 * A) *
      beta ** 4) /
      (1 - beta ** 4) -
    0.031 * (M2 - 0.8 * M2 ** 1.1) * beta ** 1.3 +
    smallBore
  )
}

// ── Correction factors Кш / Кп ───────────────────────────────────────────────
// Without these the pipe roughness, the orifice edge radius and the operating
// time have no effect on the result at all — see ф. 5.8 ДСТУ ГОСТ 8.586.5,
// where the flow is C·E·Кш·Кп·ε·…

/** Table 2 coefficients for Ra_max, ф. 5.10. Indexed [Re band][power of lg(Re)][k]. */
const RA_MAX_BK = [
  // Re band 0 → (1e4, 1e5]
  [
    [8.87, 6.7307, -10.244],
    [-3.7114, -5.5844, 5.7094],
    [0.41841, 0.732485, -0.76477],
    [0, 0, 0],
  ],
  // Re band 1 → (1e5, 3e6]
  [
    [27.23, -25.928, 1.7622],
    [-11.458, 12.426, -3.8765],
    [1.6117, -2.09397, 1.05567],
    [-0.07567, 0.106143, -0.076764],
  ],
  // Re band 2 → (3e6, 1e8]
  [
    [16.5416, 322.594, -92.029],
    [-6.60709, -132.2, 37.935],
    [0.88147, 17.795, -5.1885],
    [-0.039226, -0.799765, 0.23583],
  ],
]

/**
 * C#'s Math.Round is banker's rounding (half-to-even); JS Math.round is half-up.
 * Ra_max feeds a rounded intermediate, so match the DLL exactly.
 */
export function roundHalfEven(v: number, digits: number): number {
  const f = 10 ** digits
  const x = v * f
  if (Math.abs(x - Math.trunc(x)) === 0.5) {
    const fl = Math.floor(x)
    return (fl % 2 === 0 ? fl : fl + 1) / f
  }
  return Math.round(x) / f
}

/** ф. 5.10 — upper bound of admissible pipe roughness Ra. `dM` and result in metres. */
export function raMax(re: number, beta: number, dM: number): number {
  let v: number
  if (re <= 1e4) {
    v = 0.718866 * beta ** -3.887 + 0.36
  } else {
    const band = re <= 1e5 ? 0 : re <= 3e6 ? 1 : re <= 1e8 ? 2 : -1
    if (band < 0) return NaN
    const lg = Math.log10(re)
    let b0 = 0
    let b1 = 0
    let b2 = 0
    for (let k = 0; k <= 3; k++) {
      b0 += RA_MAX_BK[band][k][0] * lg ** k
      b1 += RA_MAX_BK[band][k][1] * lg ** k
      b2 += RA_MAX_BK[band][k][2] * lg ** k
    }
    v = b0 * (beta < 0.65 ? beta : 0.65) ** b1 + b2
  }
  const r = v < 1 ? roundHalfEven(v, 2) : v < 10 ? roundHalfEven(v, 1) : roundHalfEven(v, 0)
  return r >= 15 ? 0.0015 * dM : (dM * r) / 1e4
}

/** ф. 5.10 — lower bound of admissible pipe roughness Ra, metres. */
export function raMin(re: number, beta: number, dM: number): number {
  if (re < 3e6) return 0
  const lg = Math.log10(re)
  const v =
    beta < 0.65
      ? 7.1592 -
        12.387 * beta -
        (2.0118 - 3.469 * beta) * lg +
        (0.1382 - 0.23762 * beta) * lg ** 2
      : -0.892353 + 0.24308 * lg - 0.0162562 * lg ** 2
  return v <= 0 ? 0 : (dM * (Math.trunc(v * 1000) / 1000)) / 1e4
}

/** ф. 5.12 — friction factor λ. */
export function lambdaFriction(
  re: number,
  ash: number,
  kd: number,
  kr: number,
  dM: number,
): number {
  return (
    1 /
    (1.74 -
      2 * Math.log10((2 * ash) / dM - (37.36 * Math.log10(kd - kr * Math.log10(kd + 3.3333 * kr))) / re)) **
      2
  )
}

/**
 * ф. 5.11 — pipe roughness correction Кш. `rshM`, `dM` in metres.
 * Equals 1 while Ra sits inside the admissible band; only outside it does the
 * roughness bite.
 */
export function roughnessCoeff(re: number, beta: number, dM: number, rshM: number): number {
  const rMin = raMin(re, beta, dM)
  const rMax = raMax(re, beta, dM)
  const Ra = rshM / Math.PI
  if (!(Ra < rMin) && !(Ra > rMax)) return 1
  const bound = Ra < rMin ? rMin : rMax
  const kr = 5.035 / re
  const Ash = Math.PI * bound
  // 0.84678488… = π · 0.26954
  const kd = (0.8467848838485929 * bound) / dM
  const l1 = lambdaFriction(re, rshM, (0.26954 * rshM) / dM, kr, dM)
  const l2 = lambdaFriction(re, Ash, kd, kr, dM)
  return 1 + 5.22 * beta ** 3.5 * (l1 - l2)
}

/** Asymptotic edge-blunting radius, m (ф. 5.14 ДСТУ ГОСТ 8.586.2). */
export const R_EDGE_MAX = 0.000195

export interface BluntnessArgs {
  /** Working orifice bore, m. */
  dM: number
  /** Initial edge radius, m. */
  rnM: number
  /** Operating time, years. */
  years: number
  /** 0 — наработка (radius at that moment), 1 — міжконтрольний інтервал (averaged). */
  timeType: number
}

/**
 * ф. 5.13/5.16 — orifice edge blunting correction Кп.
 *
 * NOTE: the two branches test the 0.0004·d threshold against *different* radii —
 * ttwoRun against the initial rn, ttwoPeriod against the averaged value. That
 * asymmetry is what CalcDSTU8586.dll does; kept for parity.
 */
export function bluntnessCoeff({ dM, rnM, years, timeType }: BluntnessArgs): number {
  if (timeType === 1) {
    // As years → 0 the average degenerates to rn (l'Hôpital), so guard the
    // division rather than returning NaN.
    const rAvg =
      years > 0
        ? R_EDGE_MAX - (3 / years) * (R_EDGE_MAX - rnM) * (1 - Math.exp(-years / 3))
        : rnM
    return rAvg <= 0.0004 * dM ? 1 : 0.9826 + (rAvg / dM + 0.0007773) ** 0.6
  }
  if (rnM <= 0.0004 * dM) return 1
  const rk = R_EDGE_MAX - (R_EDGE_MAX - rnM) * Math.exp(-years / 3)
  return 0.9826 + (rk / dM + 0.0007773) ** 0.6
}

/** ISO 5167-2 expansibility factor ε for gas (κ from ГОСТ 30319.1 ф. 28). */
export function expansibility(
  beta: number,
  dpPa: number,
  p1Pa: number,
  kappa: number,
): number {
  const tau = 1 - dpPa / p1Pa
  return 1 - (0.351 + 0.256 * beta ** 4 + 0.93 * beta ** 8) * (1 - tau ** (1 / kappa))
}

export interface OrificeFlowArgs {
  /** Nominal bore at 20 °C, mm. */
  dPipeMm: number
  /** Nominal orifice bore at 20 °C, mm. */
  dOrificeMm: number
  /** Linear-expansion factors of pipe and orifice. */
  kD: number
  kd: number
  dpPa: number
  p1Pa: number
  /** Working density, kg/m³, and dynamic viscosity, Pa·s. */
  rhoW: number
  mu: number
  otborIdx: number
  kappa: number
  /** Pipe roughness Rsh, mm. */
  rshMm: number
  /** Orifice edge radius, mm. */
  rEdgeMm: number
  years: number
  timeType: number
}

export interface OrificeFlowResult {
  /** Mass flow, kg/s. */
  qm: number
  C: number
  Ksh: number
  Kbl: number
  eps: number
  beta: number
  dtMm: number
  dOrificeTMm: number
  reD: number
}

/** ф. 5.8 ДСТУ ГОСТ 8.586.5 — mass flow through the orifice, solved iteratively. */
export function orificeFlow({
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
}: OrificeFlowArgs): OrificeFlowResult {
  const DT = dPipeMm * 1e-3 * kD
  const dT = dOrificeMm * 1e-3 * kd
  const beta = dT / DT
  const E = 1 / Math.sqrt(1 - beta ** 4)
  const A0 = (Math.PI / 4) * dT ** 2
  const eps = expansibility(beta, dpPa, p1Pa, kappa)
  // Кп depends only on geometry and time, so it is constant across the iteration.
  const Kbl = bluntnessCoeff({ dM: dT, rnM: rEdgeMm * 1e-3, years, timeType })

  const dtMm = DT * 1e3
  let C = 0.6
  let Ksh = 1
  let qm = C * eps * E * A0 * Math.sqrt(2 * dpPa * rhoW)
  for (let i = 0; i < 25; i++) {
    const Re = qm > 0 ? (4 * qm) / (Math.PI * mu * DT) : 1
    const Cn = dischargeCoeff(beta, Re, otborIdx, dtMm)
    // Кш is Re-dependent, so it must be re-evaluated inside the loop.
    Ksh = roughnessCoeff(Re, beta, DT, rshMm * 1e-3)
    const qn = Cn * Ksh * Kbl * eps * E * A0 * Math.sqrt(2 * dpPa * rhoW)
    if (Math.abs(qn - qm) < 1e-12) {
      C = Cn
      qm = qn
      break
    }
    C = Cn
    qm = qn
  }
  const reD = (4 * qm) / (Math.PI * mu * DT)
  return { qm, C, Ksh, Kbl, eps, beta, dtMm, dOrificeTMm: dT * 1e3, reD }
}
