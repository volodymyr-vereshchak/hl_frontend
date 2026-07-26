import { Box, Group, Progress, Text } from '@mantine/core'
import { numericStyle } from '@/theme/theme'

export interface PollProgressValue {
  done?: number
  total?: number
  /**
   * 'waiting'     — another poll holds the branch lock
   * 'polling'     — devices are being read, done/total are meaningful
   * 'aggregating' — server-side post-processing
   */
  phase?: string
}

/**
 * Progress of a long DPD poll, fed by the NDJSON stream. Only the 'polling'
 * phase has a count, so the other phases render an indeterminate bar rather
 * than a misleading 0 %.
 */
export function PollProgress({ progress }: { progress: PollProgressValue | null }) {
  if (!progress) return null
  const { done = 0, total = 0, phase } = progress
  const pct = phase === 'polling' && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null

  const label =
    phase === 'waiting'
      ? 'Очікування іншого опитування…'
      : phase === 'aggregating'
        ? 'Обробка даних…'
        : pct !== null
          ? `Опитано ${done} із ${total} приладів`
          : 'Опитування…'

  return (
    <Box>
      <Progress
        value={pct ?? 100}
        animated
        striped={pct === null}
        color="petrol"
        size="sm"
        radius="xl"
        aria-label={label}
      />
      <Group justify="space-between" mt={4} gap="xs">
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        {pct !== null && (
          <Text size="xs" c="petrol" fw={600} style={numericStyle}>
            {pct}%
          </Text>
        )}
      </Group>
    </Box>
  )
}
