// Archive table column descriptors — pure, stateless (ported from archiveColumns.js).
import type { ArchiveType } from '@/types'

export const EDIT_CHANNEL_NAMES = ['P', 'T', 'dP', 'dPL', 'Густ']

/** edit_name may contain "%s" (channel index in old/new value) → human label. */
export function resolveEditName(
  editName: string | null | undefined,
  rawOldValue: unknown,
  rawNewValue: unknown,
): string {
  if (!editName || !editName.includes('%s')) return editName ?? ''
  const isChannelIdx = (v: unknown): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < EDIT_CHANNEL_NAMES.length
  const idx = isChannelIdx(rawOldValue) ? rawOldValue : isChannelIdx(rawNewValue) ? rawNewValue : null
  const channelName = idx !== null ? EDIT_CHANNEL_NAMES[idx] : String(rawOldValue ?? '?')
  return editName.replace('%s', channelName)
}

/**
 * Label for one entry of the sys/edit type filter.
 *
 * Filtering is by event CODE, so an edit name with a "%s" channel placeholder
 * stands for every channel at once — the option must say so. Naming the
 * channels beats a bare "…": the reader picking "Постановка на константу"
 * needs to know it will bring back the P rows AND the T rows.
 */
export function eventTypeLabel(name: string): string {
  return name.includes('%s') ? name.replace('%s', EDIT_CHANNEL_NAMES.join('/')) : name
}

export interface ArchiveColumn {
  key: string
  label: string
  sortable?: boolean
  isSummable?: boolean
  isAveragable?: boolean
  tooltip?: string
}

interface ColumnOptions {
  archiveType: ArchiveType
  isVirtualLine?: boolean
  isDpdLine?: boolean
  lineUnits?: { meter?: boolean } | null
  showOutputPressure?: boolean
  pressureUnit: string
  dpUnit: string
  t: (key: string) => string
}

export function getArchiveColumns({
  archiveType,
  isVirtualLine,
  isDpdLine,
  lineUnits,
  showOutputPressure,
  pressureUnit,
  dpUnit,
  t,
}: ColumnOptions): ArchiveColumn[] {
  const wVolumeDpLabel = lineUnits?.meter
    ? `${t('workingVolume')}, ${t('volumeUnit')}`
    : `${t('differentialPressure')}, ${dpUnit}`

  // Max/min dP are the alarm band of an ORIFICE plate. A meter-based line has
  // no differential pressure at all — the device stores its flow limits in the
  // same two fields, so the numbers are right and only the caption was wrong.
  const maxLimitLabel = lineUnits?.meter
    ? `${t('paramMaxFlow')}, ${t('flowUnit')}`
    : t('paramMaxDp')
  const minLimitLabel = lineUnits?.meter
    ? `${t('paramMinFlow')}, ${t('flowUnit')}`
    : t('paramMinDp')

  switch (archiveType) {
    case 'daily':
    case 'hourly':
      if (isVirtualLine) {
        return [
          { key: 'period', label: t('period'), sortable: true },
          { key: 'volume', label: t('volume'), sortable: true, isSummable: true },
        ]
      }
      if (isDpdLine) {
        return [
          { key: 'period', label: t('period'), sortable: true },
          { key: 'volume', label: t('volume'), sortable: true, isSummable: true },
          { key: 'pressure', label: `${t('pressure')}, ${pressureUnit}`, sortable: true, isAveragable: true },
          { key: 'temperature', label: t('temperature'), sortable: true, isAveragable: true },
        ]
      }
      return [
        { key: 'period', label: t('period'), sortable: true },
        { key: 'volume', label: t('volume'), sortable: true, isSummable: true },
        { key: 'w_volume_dp', label: wVolumeDpLabel, sortable: true, isAveragable: true },
        { key: 'pressure', label: `${t('pressure')}, ${pressureUnit}`, sortable: true, isAveragable: true },
        ...(showOutputPressure
          ? [
              {
                key: 'output_pressure',
                label: `${t('outputPressure')}, ${pressureUnit}`,
                sortable: true,
                isAveragable: true,
              },
            ]
          : []),
        { key: 'temperature', label: t('temperature'), sortable: true, isAveragable: true },
        { key: 'density', label: t('density'), sortable: true, isAveragable: true },
        { key: 'edit_counts', label: t('editCounts'), sortable: true, isSummable: true, tooltip: t('changesCount') },
        { key: 'sys_counts', label: t('sysCounts'), sortable: true, isSummable: true, tooltip: t('alarmsCount') },
      ]
    case 'edit':
      return [
        { key: 'period', label: t('period'), sortable: true },
        { key: 'edit_name', label: t('editType'), sortable: true },
        { key: 'old_value', label: t('oldValue'), sortable: true },
        { key: 'new_value', label: t('newValue'), sortable: true },
      ]
    case 'sys':
      return [
        { key: 'period', label: t('period'), sortable: true },
        { key: 'sys_name', label: t('operationType'), sortable: true },
        // Not summable: this is the counter READING at the moment of the event
        // (battery-run start and its matching end), not a volume delta. Adding
        // the readings up produced a totals row that meant nothing.
        { key: 'volume', label: t('value'), sortable: true },
      ]
    case 'param':
      return [
        { key: 'period', label: t('period'), sortable: true },
        { key: 'density', label: t('density'), sortable: true, isAveragable: true },
        { key: 'co2', label: 'CO2 (%)', sortable: true, isAveragable: true },
        { key: 'n2', label: 'N2 (%)', sortable: true, isAveragable: true },
        { key: 'D20', label: 'D20', sortable: true, isAveragable: true },
        { key: 'd20', label: 'd20', sortable: true, isAveragable: true },
        { key: 'cutoff', label: 'Cutoff', sortable: true, isAveragable: true },
        { key: 'roughness', label: 'Roughness', sortable: true, isAveragable: true },
        { key: 'max_dp', label: maxLimitLabel, sortable: true, isAveragable: true },
        { key: 'min_dp', label: minLimitLabel, sortable: true, isAveragable: true },
        { key: 'radius', label: t('paramRadius'), sortable: true, isAveragable: true },
        { key: 'max_p', label: t('paramMaxP'), sortable: true, isAveragable: true },
        { key: 'min_p', label: t('paramMinP'), sortable: true, isAveragable: true },
        { key: 'max_t', label: t('paramMaxT'), sortable: true, isAveragable: true },
        { key: 'min_t', label: t('paramMinT'), sortable: true, isAveragable: true },
      ]
    default:
      return []
  }
}
