import { Alert, Group, Progress, Stack, Text } from '@mantine/core'
import { IconAlertTriangle, IconCheck, IconCloudDownload } from '@tabler/icons-react'

/**
 * A DPD poll while it runs, and what it stored when it is done.
 *
 * Deliberately no table. Fetching and looking were the same button until now,
 * which is why a modem poll — which fetches and has nothing to draw — looked
 * broken next to it. What an operator needs here is whether the data arrived
 * and how much of it; the readings themselves are the other tab.
 */
interface Props {
  selected: boolean
  loading: boolean
  progress: { done?: number; total?: number; phase?: string } | null
  stored: { daily: number; hourly: number; rewritten: number } | null
  error: string | null
}

export function DpdPollPane({ selected, loading, progress, stored, error }: Props) {
  if (!selected) {
    return (
      <Text size="sm" c="dimmed" p="md">
        Оберіть підприємство зліва.
      </Text>
    )
  }

  return (
    <Stack gap="sm" p="md">
      <Group gap="xs">
        <IconCloudDownload size={16} />
        <Text size="sm" fw={600}>
          Опитування з сервера Радміртех
        </Text>
      </Group>

      <Text size="xs" c="dimmed">
        Тягне добовий і годинний архіви від останньої дати в базі до завтра —
        доба тут газова, тож години поточної підшиті під дату, яка ще не
        настала. Якщо в базі порожньо, від дати встановлення корректора.
      </Text>

      {loading && (
        <Stack gap={4}>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              {progress?.phase ?? 'опитування'}
            </Text>
            {progress?.total ? (
              <Text size="xs" c="dimmed">
                {progress.done ?? 0} з {progress.total}
              </Text>
            ) : null}
          </Group>
          <Progress
            value={
              progress?.total ? ((progress.done ?? 0) / progress.total) * 100 : 100
            }
            animated
            size="sm"
            radius="sm"
          />
        </Stack>
      )}

      {error && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} p="xs">
          <Text size="xs">{error}</Text>
        </Alert>
      )}

      {stored && !loading && (
        <Alert color="green" variant="light" icon={<IconCheck size={16} />} p="xs">
          <Text size="xs">
            {stored.hourly || stored.daily
              ? `Нових записів: годин ${stored.hourly}, діб ${stored.daily}. Дані — у вкладці «Архів».`
              : `Нових записів немає — архів уже актуальний${
                  stored.rewritten ? ` (перевірено ${stored.rewritten} наявних)` : ''
                }.`}
          </Text>
        </Alert>
      )}
    </Stack>
  )
}
