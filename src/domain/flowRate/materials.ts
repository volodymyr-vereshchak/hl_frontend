/**
 * Material list and linear-expansion coefficients, ported 1:1 from
 * CalcDSTU8586.dll (Material.ListMaterials) and ДСТУ ГОСТ 8.586.1 Додаток Г.
 */

export interface Material {
  label: string
  /** Constant α fallback, 1/°C — used only when the material is absent from table Г.1. */
  a: number
}

/**
 * Exact order from Material.ListMaterials. Both pipe and orifice use this list,
 * and the index is what the form stores — do not reorder.
 * Defaults: pipe = index 2 (сталь 20), orifice = index 15 (12Х18Н9Т).
 */
export const MATERIALS: Material[] = [
  { label: '10', a: 11.7e-6 },
  { label: '15', a: 11.8e-6 },
  { label: '20', a: 11.9e-6 },
  { label: '06ХН28МДТ', a: 15.8e-6 },
  { label: '08Х13', a: 10.5e-6 },
  { label: '08Х18Н10', a: 16.5e-6 },
  { label: '08Х18Н10T', a: 16.5e-6 },
  { label: '08Х22Н6Т', a: 16.0e-6 },
  { label: '09Г2С', a: 12.0e-6 },
  { label: '10Г2', a: 11.9e-6 },
  { label: '10Х14Г14Н4Т', a: 17.0e-6 },
  { label: '12Х13', a: 10.5e-6 },
  { label: '12Х17', a: 10.8e-6 },
  { label: '12Х18Н10Т', a: 16.6e-6 },
  { label: '12Х18Н12Т', a: 16.5e-6 },
  { label: '12Х18Н9Т', a: 16.7e-6 },
  { label: '12Х18Н9ТЛ', a: 16.7e-6 },
  { label: '12Х1МФ', a: 12.5e-6 },
  { label: '15К', a: 11.7e-6 },
  { label: '20К', a: 11.8e-6 },
  { label: '15Х5М', a: 11.5e-6 },
  { label: '15ХМ', a: 12.5e-6 },
  { label: '16ГС', a: 12.2e-6 },
  { label: '18Х2Н4МА', a: 11.5e-6 },
  { label: '20Л', a: 11.9e-6 },
  { label: '20Х13', a: 10.5e-6 },
  { label: '20ХМЛ', a: 12.5e-6 },
  { label: '22К', a: 11.8e-6 },
  { label: '25Л', a: 12.0e-6 },
  { label: '25Х1МФ', a: 12.5e-6 },
  { label: '25Х2М1Ф', a: 12.5e-6 },
  { label: '30', a: 11.9e-6 },
  { label: '35', a: 11.7e-6 },
  { label: '30Х13', a: 10.5e-6 },
  { label: '30ХМ', a: 12.5e-6 },
  { label: '30ХМА', a: 12.5e-6 },
  { label: '31Х19Н9МВБТ', a: 16.0e-6 },
  { label: '35Л', a: 11.5e-6 },
  { label: '37Х12Н8Г8МФБ', a: 16.5e-6 },
  { label: '38ХА', a: 12.5e-6 },
  { label: '38ХН3МФА', a: 12.0e-6 },
  { label: '40', a: 11.8e-6 },
  { label: '45', a: 11.7e-6 },
  { label: '40Х', a: 12.0e-6 },
  { label: '45Л', a: 11.7e-6 },
]

/**
 * Linear-expansion polynomial coefficients (a0, a1, a2) from ДСТУ ГОСТ 8.586.1
 * Додаток Г, table Г.1: α(t) = 1e-6·[a0 + a1·(t/1000) + a2·(t/1000)²], t in °C.
 * Aligned 1:1 to MATERIALS above. The param archive stores these same values
 * (ParamList exposes A0/A1/A2 scaled to exactly a0/a1/a2), so the material is
 * recovered by matching the full triple. null = not in the standard table.
 */
export const MATERIAL_COEFFS: (readonly [number, number, number] | null)[] = [
  [10.8, 9.0, -4.2], // 0  10
  [11.1, 7.9, -3.9], // 1  15
  [11.1, 7.7, -3.4], // 2  20
  [9.153, 30.944, -26.478], // 3  06ХН28МДТ
  [9.971, 9.095, -4.115], // 4  08Х13
  [15.325, 11.25, 0], // 5  08Х18Н10
  [15.47, 10.5, 0], // 6  08Х18Н10T
  [6.4, 60.0, 0], // 7  08Х22Н6Т
  [10.66, 12.0, 0], // 8  09Г2С
  [9.94, 22.667, 0], // 9  10Г2
  [15.22, 13.0, 0], // 10 10Х14Г14Н4Т
  [9.557, 11.067, -5.0], // 11 12Х13
  null, // 12 12Х17 (not in table)
  [16.205, 6.571, 0], // 13 12Х18Н10Т
  [16.205, 6.571, 0], // 14 12Х18Н12Т
  [15.6, 8.3, -6.5], // 15 12Х18Н9Т
  [16.466, 5.36, 3.0], // 16 12Х18Н9ТЛ
  [10.0, 9.6, -6.0], // 17 12Х1МФ
  [10.8, 10.0, 0], // 18 15К
  [10.8, 10.0, 0], // 19 20К
  [10.1, 2.7, 0], // 20 15Х5М
  [11.448, 12.638, -7.137], // 21 15ХМ
  [9.903, 20.561, -15.675], // 22 16ГС
  [11.065, 11.224, -5.381], // 23 18Х2Н4МА
  [11.66, 9.0, 0], // 24 20Л
  [9.52, 11.333, 0], // 25 20Х13
  [9.83, 18.812, -14.191], // 26 20ХМЛ
  [9.142, 34.34, -43.526], // 27 22К
  [10.75, 12.5, 0], // 28 25Л
  [10.235, 13.64, -13.0], // 29 25Х1МФ
  [12.02, 8.0, 0], // 30 25Х2М1Ф
  [10.2, 10.4, -5.6], // 31 30
  [10.2, 10.4, -5.6], // 32 35
  [9.642, 9.6, -4.472], // 33 30Х13
  [10.72, 14.667, 0], // 34 30ХМ
  [10.72, 14.667, 0], // 35 30ХМА
  [16.216, 6.4, 0], // 36 31Х19Н9МВБТ
  null, // 37 35Л (not in fetched table)
  [15.8, 0.0, 0], // 38 37Х12Н8Г8МФБ
  [12.345, 5.433, 5.36], // 39 38ХА
  [11.446, 9.574, -4.945], // 40 38ХН3МФА
  [10.821, 17.872, -10.986], // 41 40
  [10.821, 17.872, -10.986], // 42 45
  [10.819, 15.487, -9.28], // 43 40Х
  [11.6, 0.0, 0], // 44 45Л
]

/**
 * Linear-expansion factor K = 1 + α(t)·(t − 20), ф. 5.6/5.7 ДСТУ ГОСТ 8.586.1
 * (GetKpipe/GetKorifice in the DLL). α is temperature-dependent via the table Г.1
 * polynomial; materials missing from that table fall back to the constant α.
 */
export function expansionFactor(matIdx: number, tC: number): number {
  const c = MATERIAL_COEFFS[matIdx]
  const alpha = c
    ? 1e-6 * (c[0] + c[1] * (tC / 1000) + c[2] * (tC / 1000) ** 2)
    : (MATERIALS[matIdx]?.a ?? 11.9e-6)
  return 1 + alpha * (tC - 20)
}

/**
 * Recover the MATERIALS index from a param's expansion polynomial (A0, A1, A2 —
 * the displayed ParamList values, equal to table Г.1's a0/a1/a2). Matches the
 * full triple, so e.g. steel 20 ≠ 15 ≠ 10, which differ only in a1/a2.
 * Returns null when nothing is close (material not in the standard table).
 */
export function matchMaterialIndex(
  A0: number | null | undefined,
  A1: number | null | undefined,
  A2: number | null | undefined,
): number | null {
  if (A0 == null || isNaN(A0)) return null
  const p = [A0, A1 || 0, A2 || 0]
  let best: number | null = null
  let bestDist = Infinity
  MATERIAL_COEFFS.forEach((c, i) => {
    if (!c) return
    const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  // The param equals one table row, so the right material gives dist ≈ 0; allow a
  // little slack for rounding but reject when nothing is reasonably close.
  return bestDist <= 1.0 ? best : null
}
