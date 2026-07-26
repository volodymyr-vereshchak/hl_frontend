/**
 * Extracts the flow-rate physics VERBATIM from the legacy frontend into an
 * oracle module, so the parity test compares the port against the original
 * source rather than against a second hand transcription of it.
 *
 * Usage:  node scripts/gen-flowrate-oracle.mjs [path/to/FlowRateCalc.jsx]
 *
 * The generated file is committed; regenerate it only when the legacy
 * calculation itself changes.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE =
  process.argv[2] ??
  resolve(here, '../../frontend/react-frontend/src/components/FlowRateCalc.jsx')
const TARGET = resolve(here, '../src/domain/flowRate/__oracle__/original.generated.mjs')

const src = readFileSync(SOURCE, 'utf8')
const lines = src.split(/\r?\n/)

/** Line index of the first line that includes `needle`, searching from `start`. */
function findLine(needle, start = 0) {
  const i = lines.findIndex((l, n) => n >= start && l.includes(needle))
  if (i < 0) throw new Error(`anchor not found: ${needle}`)
  return i
}

/** Inclusive slice between two anchors, as text. */
function slice(startNeedle, endNeedle) {
  const a = findLine(startNeedle)
  const b = findLine(endNeedle, a)
  return lines.slice(a, b + 1).join('\n')
}

const parts = [
  slice('const T0 =', 'const RHO_AIR ='),
  slice('const MATERIALS = [', '];'),
  slice('function zStd(', '// ─── Sub-components'),
  slice('const MATERIAL_COEFFS = [', 'return bestDist <= 1.0 ? best : null;'),
]

// The physics slice ends on the sub-components banner comment; drop it and the
// trailing blank lines so the module ends on the last function.
parts[2] = parts[2].split('\n').slice(0, -1).join('\n').trimEnd()
// matchMaterialIndex's closing brace sits after the anchor line.
parts[3] += '\n}'

const exported = [
  'T0',
  'P0',
  'RHO_AIR',
  'MATERIALS',
  'MATERIAL_COEFFS',
  'zStd',
  'ppk',
  'tpk',
  'zNX19',
  'zGERG91',
  'gasViscosity',
  'adiabat',
  'dischargeCoeff',
  'roundHalfEven',
  'raMax',
  'raMin',
  'lambdaFriction',
  'roughnessCoeff',
  'bluntnessCoeff',
  'expansibility',
  'orificeFlow',
  'expansionFactor',
  'matchMaterialIndex',
]

const out = `/* eslint-disable */
// GENERATED — DO NOT EDIT.
// Verbatim extract of the flow-rate physics from the legacy frontend:
//   ${SOURCE.replace(/\\/g, '/')}
// Regenerate with: node scripts/gen-flowrate-oracle.mjs
// Used only by parity.test.ts as the numerical oracle for the TypeScript port.

${parts.join('\n\n')}

export { ${exported.join(', ')} }
`

mkdirSync(dirname(TARGET), { recursive: true })
writeFileSync(TARGET, out, 'utf8')
console.log(`wrote ${TARGET} (${out.split('\n').length} lines)`)
