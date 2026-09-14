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

const UNIT_K: Record<string, number> = Object.fromEntries(P_UNITS.map((u) => [u.label, u.k]))

// Defaults match the previously hardcoded units (кгс/см² / кгс/м²).
export const PRESSURE_UNIT_DEFAULT = 'кгс/см²'

/** The switch's "follow the setting / the meter" choice, rather than a unit. */
export const AUTO_UNIT = 'auto'

/**
 * Offered in the reading-unit switch. Not all eight: picking a unit to read a
 * gas archive in is a choice between the two the fleet actually reports and
 * the two anybody asks for — the full list belongs in a parameter form.
 */
export const SWITCHABLE_UNITS = ['кгс/см²', 'МПа', 'кПа', 'бар']
export const DP_UNIT_DEFAULT = 'кгс/м²'

// Values that mean "the device reported no unit". Part of the DPD correctors
// answer with the literal string "None"/"null" instead of omitting the field;
// taken at face value it shows up in a column header as «Тиск, None». The
// backend cleans these on ingest too — this is the guard for rows written
// before that landed.
const ABSENT_UNITS = new Set(['', 'none', 'null', 'nan', 'n/a', '-', '—', '--'])

/**
 * The same unit written the several ways the archive holds it.
 *
 * `кгс/см3` is not a unit at all — it is what the DPD API calls кгс/см², and
 * 157k rows carry it. Taken literally it is unknown, so the value would be
 * shown unconverted under someone else's caption; mapped here, it reads as
 * what the corrector actually measured.
 */
const UNIT_ALIASES: Record<string, string> = {
  'кгс/см3': 'кгс/см²',
  'кгс/см2': 'кгс/см²',
  'кг/см2': 'кгс/см²',
  'кг/см3': 'кгс/см²',
  'kgf/cm2': 'кгс/см²',
  'kgf/cm3': 'кгс/см²',
  'kg/cm2': 'кгс/см²',
  'кгс/м2': 'кгс/м²',
  'kgf/m2': 'кгс/м²',
  mpa: 'МПа',
  kpa: 'кПа',
  pa: 'Па',
  bar: 'бар',
  psi: 'PSI',
  'мм рт.ст.': 'мм рт.ст',
  'мм рт. ст.': 'мм рт.ст',
  'mm hg': 'мм рт.ст',
}

/** A unit reported by a device, or null when it reported nothing usable. */
export function normalizeUnit(raw: string | null | undefined): string | null {
  const text = String(raw ?? '').trim()
  const key = text.toLowerCase()
  if (ABSENT_UNITS.has(key)) return null
  return UNIT_ALIASES[key] ?? text
}

/** Is this a unit we can convert to and from? */
export function isKnownUnit(unit: string | null | undefined): boolean {
  return !!unit && unit in UNIT_K
}

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
