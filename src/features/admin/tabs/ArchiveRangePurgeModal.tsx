import { useEffect, useState, type ReactNode } from 'react'
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Table,
  Text,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { IconAlertTriangle, IconCalendar, IconTrash } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { LineArchiveRange } from '@/api/admin'
import { describeRange, humanDate, type ArchiveExtent } from '@/domain/lineArchiveRange'

/** Rows per archive kind; interfaces with fixed keys fit, no index signature needed. */
type Counts<C> = { [K in keyof C]: number }

export interface ArchiveRangePurgeProps<C extends Counts<C>> {
  opened: boolean
  onClose: () => void
  title: string
  /** Who the range is cleared for — a line, or a branch and how many lines. */
  subject: ReactNode
  /** A new target opens with empty dates (see the effect below). */
  target: string
  kinds: Array<{ key: keyof C & string; label: string }>
  preview: (range: LineArchiveRange) => Promise<{ counts: C; extent: ArchiveExtent }>
  purge: (range: LineArchiveRange) => Promise<{ removed: C }>
  /** Column caption when no date is chosen yet: "Усього в лінії" and the like. */
  wholeLabel: string
  warning: ReactNode
  /** When given, removing asks once more, with this text, before it goes. */
  confirm?: (total: number) => ReactNode
}

/**
 * Clearing a stretch of archive over an open-ended range.
 *
 * Both dates are optional, and that is the point: what this is for is a
 * stretch that was read wrongly, and such a stretch is usually described as
 * "everything before we noticed" or "everything since the swap". So a start
 * on its own means everything from that day on, an end on its own everything
 * up to it, two dates the span between them with both days included, and no
 * dates the whole archive. The dialog says in words which of the four it is
 * about to do, and the whole archive is asked about once more before it goes,
 * since two empty fields are the easiest thing on the screen to leave by
 * accident.
 *
 * What is in the range is counted as the dates change, and the button that
 * removes it stays out of reach until there is a number next to it.
 */
export function ArchiveRangePurgeModal<C extends Counts<C>>({
  opened,
  onClose,
  title,
  subject,
  target,
  kinds,
  preview: fetchPreview,
  purge: runPurge,
  wholeLabel,
  warning,
  confirm,
}: ArchiveRangePurgeProps<C>) {
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Every target opens with empty dates: the range from the one before it
  // would be somebody else's range, silently pre-armed.
  useEffect(() => {
    setFrom(null)
    setTo(null)
  }, [target])

  const chosen = !!from || !!to
  const range: LineArchiveRange = { from_date: from ?? undefined, to_date: to ?? undefined }

  // Counting a range that reads backwards would mean nothing, so the query
  // waits; the sentence below says why.
  const backwards = !!from && !!to && from > to

  const preview = useQuery({
    queryKey: ['archive-purge-preview', target, from, to],
    queryFn: () => fetchPreview(range),
    enabled: opened && !backwards,
  })

  const counts = preview.data?.counts
  const total = counts ? (Object.values(counts) as number[]).reduce((a, b) => a + b, 0) : 0
  const extent = preview.data?.extent
  //: The range in words — the one thing in this dialog worth reading twice.
  const verdict = describeRange(from, to, extent)

  const purge = useMutation({
    mutationFn: () => runPurge(range),
    onSuccess: ({ removed }) => {
      const gone = (Object.values(removed) as number[]).reduce((a, b) => a + b, 0)
      notifications.show({
        color: 'green',
        message: `Видалено ${gone} записів: ${kinds
          .map((k) => `${k.label.toLowerCase()} ${removed[k.key]}`)
          .join(', ')}`,
      })
      queryClient.invalidateQueries({ queryKey: ['archive-purge-preview'] })
      onClose()
    },
    onError: (e: Error) => notifications.show({ color: 'red', message: e.message }),
  })

  const remove = () => {
    if (!confirm && chosen) {
      purge.mutate()
      return
    }
    modals.openConfirmModal({
      title,
      zIndex: 600,
      children: (
        <Stack gap="xs">
          {!chosen && (
            <Text size="sm" fw={600} c="red">
              Дати не вказано — видаляється весь архів, без залишку.
            </Text>
          )}
          {confirm ? (
            confirm(total)
          ) : (
            <Text size="sm">
              Буде видалено <b>{total}</b> записів. Це незворотно.
            </Text>
          )}
        </Stack>
      ),
      labels: { confirm: `Видалити ${total}`, cancel: 'Скасувати' },
      confirmProps: { color: 'red' },
      onConfirm: () => purge.mutate(),
    })
  }

  return (
    <Modal opened={opened} onClose={onClose} title={title} size="lg">
      <Stack gap="sm">
        <Group gap="xs">
          {subject}
          <Badge size="sm" variant="light" color="gray">
            {extent?.first
              ? `архів: ${humanDate(extent.first)} — ${humanDate(extent.last)}`
              : 'архів порожній'}
          </Badge>
        </Group>

        <Group gap="sm" align="flex-end">
          <DatePickerInput
            label="Від (включно)"
            placeholder="від початку архіву"
            leftSection={<IconCalendar size={15} />}
            value={from}
            onChange={setFrom}
            valueFormat="DD.MM.YYYY"
            clearable
            size="xs"
            w={200}
            popoverProps={{ zIndex: 500, withinPortal: true }}
          />
          <DatePickerInput
            label="До (включно)"
            placeholder="до кінця архіву"
            leftSection={<IconCalendar size={15} />}
            value={to}
            onChange={setTo}
            valueFormat="DD.MM.YYYY"
            clearable
            size="xs"
            w={200}
            popoverProps={{ zIndex: 500, withinPortal: true }}
          />
          {preview.isFetching && <Loader size="xs" mb={6} />}
        </Group>

        <Paper withBorder p="xs" bg={backwards ? 'red.0' : undefined}>
          <Text size="sm" c={backwards ? 'red' : undefined}>
            {verdict.text}
          </Text>
        </Paper>

        <Table withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Архів</Table.Th>
              <Table.Th w={160}>{chosen ? 'Потрапляє в період' : wholeLabel}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {kinds.map((kind) => (
              <Table.Tr key={kind.key}>
                <Table.Td>{kind.label}</Table.Td>
                <Table.Td>{counts ? counts[kind.key] : '—'}</Table.Td>
              </Table.Tr>
            ))}
            <Table.Tr>
              <Table.Td>
                <b>Разом</b>
              </Table.Td>
              <Table.Td>
                <b>{counts ? total : '—'}</b>
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>

        <Alert
          color={!chosen && total > 0 ? 'red' : total > 0 ? 'orange' : 'gray'}
          variant="light"
          icon={<IconAlertTriangle size={16} />}
        >
          {warning}
        </Alert>

        <Group justify="flex-end">
          <Button variant="default" size="xs" onClick={onClose}>
            Скасувати
          </Button>
          <Button
            size="xs"
            color="red"
            leftSection={<IconTrash size={15} />}
            disabled={backwards || !counts || total === 0}
            loading={purge.isPending}
            onClick={remove}
          >
            {chosen ? 'Видалити' : 'Видалити все'}
            {counts && total > 0 ? ` ${total}` : ''}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
