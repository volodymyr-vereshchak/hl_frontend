import { Stack, Text } from '@mantine/core'
import { modals } from '@mantine/modals'
import { periodDays } from '@/domain/periodLoad'
import type { DateRange } from '@/store/selectionStore'

type Translate = (key: string) => string

/** '2026-05-17' or '2026-05-17 07:00:00' → '17.05.2026'. */
const fmtDate = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-')
  return d ? `${d}.${m}.${y}` : s
}

/** Locale strings carry {name} placeholders; nothing else interpolates. */
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all)

/**
 * Why the industry overlay asks before it runs, in the order that matters:
 * which period, what it will do, how long that takes.
 *
 * The archive itself does not ask any more — its table pages and its request
 * is a database read. The overlay polls the DPD API per enterprise, and past
 * the backend's 30-day cache window it has to backfill from that API first.
 */
export function overlayWarningLines(range: DateRange, t: Translate): string[] {
  return [
    fill(t('periodSpan'), {
      from: fmtDate(range.fromDate),
      to: fmtDate(range.toDate),
      days: String(periodDays(range)),
    }),
    t('overlayPollsDpd'),
    t('overlayMayTakeMinutes'),
  ]
}

export function OverlayWarning({ range, t }: { range: DateRange; t: Translate }) {
  const lines = overlayWarningLines(range, t)
  const last = lines.length - 1
  return (
    <Stack gap={6}>
      {lines.map((line, i) => (
        <Text
          key={line}
          size="sm"
          fw={i === 0 ? 600 : undefined}
          c={i === last ? 'dimmed' : undefined}
        >
          {line}
        </Text>
      ))}
    </Stack>
  )
}

/** One dialog at a time — the period can change while it is open. */
let openId: string | null = null

export function confirmEnterpriseOverlay(
  range: DateRange,
  t: Translate,
  onConfirm: () => void,
) {
  if (openId) modals.close(openId)
  openId = modals.openConfirmModal({
    title: t('overlayHeavyTitle'),
    children: <OverlayWarning range={range} t={t} />,
    labels: { confirm: t('load'), cancel: t('cancel') },
    confirmProps: { color: 'grape' },
    onClose: () => {
      openId = null
    },
    onConfirm,
  })
}
