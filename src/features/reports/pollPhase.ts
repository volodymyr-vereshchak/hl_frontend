import type { StreamProgress } from '@/api/enterprise'

/**
 * Turns the enterprise stream's raw progress into a sentence a user can read.
 * The stream reports a phase and, while polling, a device counter — "12/40" on
 * its own says nothing about what is happening.
 */
export function pollPhaseLabel(p: StreamProgress, t: (k: string) => string): string {
  if (p.phase === 'waiting') return t('phaseWaiting')
  if (p.phase === 'aggregating') return t('phaseAggregating')
  if (p.total) return `${t('phaseEnterprise')}: ${p.done ?? 0} / ${p.total} ${t('phaseDevicesDone')}`
  return t('phaseEnterprise')
}
