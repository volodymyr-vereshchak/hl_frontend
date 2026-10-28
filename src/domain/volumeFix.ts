import type { EnterpriseRecord } from '@/api/enterprise'
import type { ArchiveRow } from '@/api/entities'
import { getContractHour } from './commercialDay'
import { enterprisePeriodKey, type PeriodType } from './enterpriseVolumes'

/**
 * A period whose corrector's totaliser was set back — the corrector replaced
 * or its archive cleared. Its reported volume was "new reading minus old",
 * minus everything the old one counted, and the backend stored it as:
 *   'zeroed' — 0: the real volume is unknown;
 *   'hours'  — (daily) the sum of that commercial day's hours, every one of
 *              them in the archive, the hour of the jump counted as 0.
 * See backend/db/dao/volume_fix.py.
 */
export type VolumeFix = 'zeroed' | 'hours'

/** Devices of an enterprise record with each kind of fix. */
export interface FixCounts {
  hours: number
  zeroed: number
}

/** What a marked cell shows: how strongly, and why. */
export interface FixMark {
  tone: VolumeFix
  hint: string
}

const pad = (n: number) => String(n).padStart(2, '0')

export function volumeFixHint(fix: VolumeFix, periodType: PeriodType): string {
  if (fix === 'hours') {
    const h = pad(getContractHour())
    return (
      'Суматор коректора скинуто (заміна коректора або очищення архіву). ' +
      `Об'єм за добу — сума годинних ${h}:00–${h}:00.`
    )
  }
  return periodType === 'hourly'
    ? "Суматор коректора скинуто в цю годину — об'єм невідомий, показано 0."
    : "Суматор коректора скинуто. Годинних даних за цю добу немає повністю — об'єм невідомий, показано 0."
}

export function enterpriseFixHint(counts: FixCounts): string | null {
  const parts: string[] = []
  if (counts.hours) parts.push(`у ${counts.hours} — сума годинних`)
  if (counts.zeroed) parts.push(`у ${counts.zeroed} — невідомий, враховано 0`)
  if (!parts.length) return null
  const total = counts.hours + counts.zeroed
  return `Суматор скинуто у ${total} ${total === 1 ? 'приладу' : 'приладів'} підприємств: об'єм ${parts.join(', ')}.`
}

/** periodKey → fix counts, for the periods with any. */
export function buildEnterpriseFixByPeriod(
  records: EnterpriseRecord[] | undefined,
  periodType: PeriodType,
): Record<string, FixCounts> {
  const out: Record<string, FixCounts> = {}
  for (const record of records ?? []) {
    const hours = record.volume_fix_hours ?? 0
    const zeroed = record.volume_fix_zeroed ?? 0
    if (!hours && !zeroed) continue
    const key = enterprisePeriodKey(record.period, periodType)
    const entry = (out[key] ??= { hours: 0, zeroed: 0 })
    entry.hours += hours
    entry.zeroed += zeroed
  }
  return out
}

/** The mark of one archive cell, or null for an ordinary one. */
export function cellFixMark(key: string, row: ArchiveRow, periodType: PeriodType): FixMark | null {
  if (key === 'volume') {
    const fix = row.volume_fix
    if (fix === 'hours' || fix === 'zeroed')
      return { tone: fix, hint: volumeFixHint(fix, periodType) }
    return null
  }
  if (key === 'totalEnterprise' || key === 'netVolume') {
    const counts = {
      hours: Number(row.enterprise_fix_hours) || 0,
      zeroed: Number(row.enterprise_fix_zeroed) || 0,
    }
    const hint = enterpriseFixHint(counts)
    // An unknown volume outweighs a reconstructed one: red if any is unknown.
    return hint ? { tone: counts.zeroed ? 'zeroed' : 'hours', hint } : null
  }
  return null
}
