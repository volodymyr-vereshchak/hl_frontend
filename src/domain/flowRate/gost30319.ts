/**
 * ГОСТ 30319 — ported 1:1 from GOST30319.dll as used by Ask2.
 *
 * Common argument convention: `rho` — standard density kg/m³, `xa` — N₂ mole
 * fraction, `xy` — CO₂ mole fraction, `pMPa` — absolute pressure, `ts` — K.
 *
 * Every expression here is transcribed from the reference implementation; do not
 * "simplify" them. Parity is pinned by src/domain/flowRate/parity.test.ts.
 */

/** ф. 36 — compressibility factor at standard conditions. */
export function zStd(rho: number, xa: number, xy: number): number {
  return 1 - (0.0741 * rho - 0.006 - 0.063 * xa - 0.0575 * xy) ** 2
}

/** ф. 17 — pseudocritical pressure, MPa. */
export function ppk(rho: number, xa: number, xy: number): number {
  return 2.9585 * (1.608 - 0.05994 * rho + xy - 0.392 * xa)
}

/** ф. 18 — pseudocritical temperature, K. */
export function tpk(rho: number, xa: number, xy: number): number {
  return 88.25 * (0.9915 + 1.759 * rho - xy - 1.681 * xa)
}

/** NX-19 мод. — ГОСТ 30319.2, ф. 6…16. */
export function zNX19(rho: number, xa: number, xy: number, pMPa: number, ts: number): number {
  const Ta = 0.71892 * (ts / tpk(rho, xa, xy)) + 0.0007
  const Pa = 0.6714 * (pMPa / ppk(rho, xa, xy)) + 0.0147
  const dTa = Ta - 1.09

  // F is piecewise over (Pa, ΔTa). The DLL applies these as three sequential
  // (not mutually exclusive) tests, so on an overlapping boundary the last
  // matching branch wins — preserved here deliberately.
  let F = NaN
  if (Pa >= 0 && Pa <= 2 && dTa >= 0 && dTa <= 0.3) {
    F =
      (75e-5 * Pa ** 2.3) / Math.exp(20 * dTa) +
      0.0011 * Math.sqrt(dTa) * (Pa * (2.17 - Pa + 1.4 * Math.sqrt(dTa))) ** 2
  }
  if (Pa >= 0 && Pa <= 1.3 && dTa >= -0.25 && dTa <= 0) {
    F = 75e-5 * Pa ** 2.3 * (2 - Math.exp(20 * dTa)) + 1.317 * Pa * (1.69 - Pa ** 2) * dTa ** 4
  }
  if (Pa >= 1.3 && Pa <= 2 && dTa >= -0.21 && dTa <= 0) {
    F =
      75e-5 * Pa ** 2.3 * (2 - Math.exp(20 * dTa)) +
      0.455 *
        (1.3 - Pa) *
        (1.69 * 2 ** 1.25 - Pa ** 2) *
        (dTa * (0.03249 + 18.028 * dTa ** 2) + dTa ** 2 * (42.844 + 200 * dTa ** 2))
  }

  const O1 = Ta ** 5 / (Ta ** 2 * (6.60756 * Ta - 4.42646) + 3.22706) // ф. 11
  const O0 = ((Ta ** 2 * (1.77218 - 0.8879 * Ta) + 0.305131) * O1) / Ta ** 4 // ф. 10
  const B1 = (2 * O1) / 3 - O0 ** 2 // ф. 9
  const B0 = O0 * (O1 - O0 ** 2) + 0.1 * O1 * Pa * (F - 1) // ф. 8
  const B2 = (B0 + Math.sqrt(B0 ** 2 + B1 ** 3)) ** (1 / 3) // ф. 7
  return ((1 + 0.00132 / Ta ** 3.25) ** 2 * Pa) / (10 * (B1 / B2 - B2 + O0)) // ф. 6
}

/** GERG-91 мод. — ГОСТ 30319.2, ф. 20…22, 34, 35, 37, 43. */
export function zGERG91(rho: number, xa: number, xy: number, pMPa: number, ts: number): number {
  const xe = 1 - xa - xy // ф. 22
  const Me = (24.05525 * zStd(rho, xa, xy) * rho - 28.0135 * xa - 44.01 * xy) / xe // ф. 35
  const H = 128.64 + 47.479 * Me // ф. 34

  // ф. 20 — second virial coefficient Bm
  const F0 = 0.72 + 1.875e-5 * (320 - ts) ** 2
  const B22 = -0.86834 + 0.0040376 * ts - 5.1657e-6 * ts ** 2
  const B12 = -0.339693 + 0.00161176 * ts - 2.04429e-6 * ts ** 2
  const B11 = -0.1446 + 0.00074091 * ts - 9.1195e-7 * ts ** 2
  const Bee =
    -0.425468 +
    0.002865 * ts -
    4.62073e-6 * ts ** 2 +
    (8.77118e-4 - 5.56281e-6 * ts + 8.81514e-9 * ts ** 2) * H +
    (-8.24747e-7 + 4.31436e-9 * ts - 6.08319e-12 * ts ** 2) * H * H
  const Bm =
    xe ** 2 * Bee +
    xe * xa * F0 * (Bee + B11) -
    1.73 * xe * xy * Math.sqrt(Bee * B22) +
    xa ** 2 * B11 +
    2 * xa * xy * B12 +
    xy ** 2 * B22

  // ф. 21 — third virial coefficient Cm
  const G0 = 0.92 + 0.0013 * (ts - 270)
  const C122 = 0.00358783 + 8.06674e-6 * ts - 3.25798e-8 * ts ** 2
  const C112 = 0.00552066 - 1.68609e-5 * ts + 1.57169e-8 * ts ** 2
  const C222 = 0.0020513 + 3.4888e-5 * ts - 8.3703e-8 * ts ** 2
  const C111 = 0.0078498 - 3.9895e-5 * ts + 6.1187e-8 * ts ** 2
  const Ceee =
    -0.302488 +
    0.00195861 * ts -
    3.16302e-6 * ts ** 2 +
    (6.46422e-4 - 4.22876e-6 * ts + 6.88157e-9 * ts ** 2) * H +
    (-3.32805e-7 + 2.2316e-9 * ts - 3.67713e-12 * ts ** 2) * H ** 2
  const Cm =
    xe ** 3 * Ceee +
    3 * xe ** 2 * xa * G0 * (Ceee * Ceee * C111) ** (1 / 3) +
    2.76 * xe ** 2 * xy * (Ceee * Ceee * C222) ** (1 / 3) +
    3 * xe * xa * xa * G0 * (Ceee * C111 * C111) ** (1 / 3) +
    6.6 * xe * xa * xy * (Ceee * C111 * C222) ** (1 / 3) +
    2.76 * xe * xy ** 2 * (Ceee * C222 * C222) ** (1 / 3) +
    xa ** 3 * C111 +
    3 * xa * xa * xy * C112 +
    3 * xa * xy * xy * C122 +
    xy ** 3 * C222

  const b = (1000 * pMPa) / (2.7715 * ts) // ф. 43
  const D1 = 1 + b * Bm
  const D2 = 1 + 1.5 * (b * Bm + b * b * Cm)
  const D3 = (D2 - Math.sqrt(D2 * D2 - D1 ** 3)) ** (1 / 3)
  return (1 + D3 + D1 / D3) / 3 // ф. 37
}

/** Dynamic viscosity, ф. 44/45 ГОСТ 30319.1. Result in Pa·s. */
export function gasViscosity(
  rho: number,
  xa: number,
  xy: number,
  pMPa: number,
  ts: number,
): number {
  const corr = 1 + (pMPa / ppk(rho, xa, xy)) ** 2 / (30 * (ts / tpk(rho, xa, xy) - 1))
  return (
    ((3.24 * (Math.sqrt(ts) + 1.37 - 9.09 * rho ** 0.125)) /
      (Math.sqrt(rho) + 2.08 - 1.5 * (xa + xy))) *
    corr *
    1e-6
  )
}

/** Isentropic exponent (adiabat), ф. 28 ГОСТ 30319.1. CO₂ does not enter it. */
export function adiabat(rho: number, xa: number, pMPa: number, ts: number): number {
  const r = pMPa / ts
  return (
    1.556 * (1 + 0.074 * xa) -
    0.00039 * ts * (1 - 0.68 * xa) -
    0.208 * rho +
    r ** 1.43 * (384 * (1 - xa) * r ** 0.8 + 26.4 * xa)
  )
}
