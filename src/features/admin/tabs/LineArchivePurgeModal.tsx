import { useEffect, useState } from 'react'
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
import { IconAlertTriangle, IconCalendar, IconTrash } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { lineAdminApi, type LineArchiveCounts } from '@/api/admin'
import { describeRange, humanDate } from '@/domain/lineArchiveRange'
import type { Line } from '@/types'

interface Props {
  line: Line | null
  onClose: () => void
}

/** The five archives, in the order the screen names them. */
const KINDS: Array<{ key: keyof LineArchiveCounts; label: string }> = [
  { key: 'daily', label: 'Добові' },
  { key: 'hourly', label: 'Годинні' },
  { key: 'edits', label: 'Зміни' },
  { key: 'alarms', label: 'Аварії та події' },
  { key: 'params', label: 'Параметри' },
]

/**
 * Clearing a stretch of one line's archive — all five of them together.
 *
 * Both dates are optional, and that is the point: what this is for is a
 * stretch that was read wrongly, and such a stretch is usually described as
 * "everything before we noticed" or "everything since the swap". So a start
 * on its own means everything from that day on, an end on its own everything
 * up to it, and two dates the span between them with both days included. The
 * dialog says in words which of the three it is about to do, so nobody has to
 * infer it from two empty-looking fields.
 *
 * What is in the range is counted as the dates change, and the button that
 * removes it stays out of reach until there is a number next to it.
 */
export function LineArchivePurgeModal({ line, onClose }: Props) {
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Every line opens with empty dates: the range from the line before it would
  // be somebody else's range, silently pre-armed.
  useEffect(() => {
    setFrom(null)
    setTo(null)
  }, [line?.id])

  const chosen = !!from || !!to

  // Counting a range that reads backwards would mean nothing, so the query
  // waits; the sentence below says why.
  const backwards = !!from && !!to && from > to

  const preview = useQuery({
    queryKey: ['line-archive-preview', line?.id, from, to],
    queryFn: () =>
      lineAdminApi.previewArchive(line!.id, {
        from_date: from ?? undefined,
        to_date: to ?? undefined,
      }),
    enabled: !!line && !backwards,
  })

  const counts = preview.data?.counts
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0
  const extent = preview.data?.extent
  //: The range in words — the one thing in this dialog worth reading twice.
  const verdict = describeRange(from, to, extent)

  const purge = useMutation({
    mutationFn: () =>
      lineAdminApi.purgeArchive(line!.id, {
        from_date: from ?? undefined,
        to_date: to ?? undefined,
      }),
    onSuccess: ({ removed }) => {
      const gone = Object.values(removed).reduce((a, b) => a + b, 0)
      notifications.show({
        color: 'green',
        message: `Видалено ${gone} записів: ${KINDS.map(
          (k) => `${k.label.toLowerCase()} ${removed[k.key]}`,
        ).join(', ')}`,
      })
      queryClient.invalidateQueries({ queryKey: ['line-archive-preview'] })
      onClose()
    },
    onError: (e: Error) => notifications.show({ color: 'red', message: e.message }),
  })


  return (
    <Modal
      opened={!!line}
      onClose={onClose}
      title="Очистити архів лінії"
      size="lg"
    >
      <Stack gap="sm">
        <Group gap="xs">
          <Text size="sm">
            Лінія: <b>{line?.name}</b>
          </Text>
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
              <Table.Th w={160}>
                {chosen ? 'Потрапляє в період' : 'Усього в лінії'}
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {KINDS.map((kind) => (
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
          color={chosen && total > 0 ? 'orange' : 'gray'}
          variant="light"
          icon={<IconAlertTriangle size={16} />}
        >
          Видаляються всі п'ять архівів разом: добові, годинні, зміни, аварії та
          параметри. Це незворотно — повернути їх може лише повторне читання
          файлів хостлібів, тобто «Оновити» по цьому шляху в адмінці.
        </Alert>

        <Group justify="flex-end">
          <Button variant="default" size="xs" onClick={onClose}>
            Скасувати
          </Button>
          <Button
            size="xs"
            color="red"
            leftSection={<IconTrash size={15} />}
            disabled={!chosen || backwards || !counts || total === 0}
            loading={purge.isPending}
            onClick={() => purge.mutate()}
          >
            Видалити{counts && chosen && total > 0 ? ` ${total}` : ''}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
