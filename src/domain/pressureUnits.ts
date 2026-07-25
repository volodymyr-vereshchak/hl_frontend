// Shared pressure / differential-pressure unit list.
// Order matches Units.ListUnits from CalcDSTU8586.dll — DO NOT reorder:
// FlowRateCalc relies on the index to pick the conversion factor `k`.
// index 0=Па, 1=кПа (default P/DP in flow calc), 7=мм рт.ст.
export const P_UNITS: { label: string; k: number }[] = [
  { label: 'Па', k: 1 },
  { label: 'кПа', k: 1e3 },
  { label: 'МПа', k: 1e6 },
  { label: 'бар', k: 1e5 },
  { label: 'кгс/см²', k: 98066.5 },
  { label: 'кгс/м²', k: 9.80665 },
  { label: 'PSI', k: 6894.76 },
  { label: 'мм рт.ст', k: 133.322 },
]

/** Plain label list for per-line unit selectors (display-only, no conversion). */
export const UNIT_LABELS = P_UNITS.map((u) => u.label)

// Defaults match the previously hardcoded units (кгс/см² / кгс/м²).
export const PRESSURE_UNIT_DEFAULT = 'кгс/см²'
export const DP_UNIT_DEFAULT = 'кгс/м²'

const UNIT_K: Record<string, number> = Object.fromEntries(P_UNITS.map((u) => [u.label, u.k]))

/**
 * Convert a numeric value between pressure units using their Pa factors.
 * value_to = value_from * k_from / k_to. No-op if either unit is unknown.
 */
export function convertPressureValue(value: number, fromUnit: string, toUnit: string): number {
  if (fromUnit === toUnit) return value
  const kFrom = UNIT_K[fromUnit]
  const kTo = UNIT_K[toUnit]
  if (!kFrom || !kTo) return value
  return (value * kFrom) / kTo
}
