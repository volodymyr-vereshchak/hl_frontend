import { useEffect, useState } from 'react'
import {
  Alert,
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
import { useMutation, useQuery } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { enterpriseApi, type ArchivePurge } from '@/api/enterprise'
import { humanDate } from '@/domain/lineArchiveRange'

interface Props {
  enterprise: { id: number; enterprise_name: string } | null
  onClose: () => void
  onPurged?: () => void
}

/**
 * Removing a stretch of a point's archive — or all of it.
 *
 * Deliberate, irreversible and rare, so it is counted before it is done: the
 * dialog says how many rows would go and from which correctors, and the button
 * that removes them cannot be pressed before that count has come back.
 *
 * Both dates are optional, which is the shape the work actually has. A stretch
 * that was read wrongly is described as "everything before we noticed" or
 * "everything since the swap", and when the whole archive of a point is wrong
 * — a corrector polled under somebody else's serial for as long as anybody can
 * remember — the honest answer is to leave both empty and take it all.
 *
 * The dates are gas days, and the server clips the range to the window each
 * corrector actually stood at this point, so a device that came from somewhere
 * else keeps the rows it made there.
 */
export function ArchivePurgeModal({ enterprise, onClose, onPurged }: Props) {
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)

  // Every point opens with empty dates: the range from the point before it
  // would be somebody else's range, silently pre-armed.
  useEffect(() => {
    setFrom(null)
    setTo(null)
  }, [enterprise?.id])

  const backwards = !!from && !!to && from > to
  const range = {
    ...(from ? { from_date: from } : {}),
    ...(to ? { to_date: to } : {}),
  }

  // Counted as the dates change rather than on a button: the number IS the
  // warning, and a button that has to be pressed to see it gets pressed last.
  const seen = useQuery({
    queryKey: ['enterprise-purge-preview', enterprise?.id, from, to],
    queryFn: () => enterpriseApi.previewArchivePurge(enterprise!.id, range),
    enabled: !!enterprise && !backwards,
  })

  const counted: ArchivePurge | undefined = seen.data
  const total = counted ? counted.hourly + counted.daily : 0
  const everything = !from && !to

  const purge = useMutation({
    mutationFn: () => enterpriseApi.purgeArchive(enterprise!.id, range),
    onSuccess: (removed) => {
      notifications.show({
        color: 'green',
        message: `Видалено: ${removed.hourly} годинних, ${removed.daily} добових`,
      })
      onPurged?.()
      onClose()
    },
    onError: (e: Error) => notifications.show({ color: 'red', message: e.message }),
  })

  /** The range in words — the one thing here worth reading twice. */
  const explained = () => {
    if (backwards) return 'Початкова дата пізніша за кінцеву — поміняйте їх місцями'
    if (from && to) return `Буде видалено з ${humanDate(from)} по ${humanDate(to)} включно`
    if (from) return `Буде видалено все від ${humanDate(from)} і новіше`
    if (to) return `Буде видалено все до ${humanDate(to)} включно`
    return 'Дати не вказані — буде видалено ВЕСЬ архів цього підприємства'
  }

  return (
    <Modal opened={!!enterprise} onClose={onClose} title="Очистити архів" size="lg">
      <Stack gap="sm">
        <Text size="sm">
          Підприємство: <b>{enterprise?.enterprise_name}</b>
        </Text>

        <Group gap="sm" align="flex-end">
          <DatePickerInput
            label="Від газової доби"
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
            label="До газової доби, включно"
            placeholder="до кінця архіву"
            leftSection={<IconCalendar size={15} />}
            value={to}
            onChange={setTo}
            valueFormat="DD.MM.YYYY"
            clearable
            size="xs"
            w={210}
            popoverProps={{ zIndex: 500, withinPortal: true }}
          />
          {seen.isFetching && <Loader size="xs" mb={6} />}
        </Group>

        <Paper withBorder p="xs" bg={backwards || everything ? 'red.0' : undefined}>
          <Text size="sm" c={backwards || everything ? 'red' : undefined}>
            {explained()}
          </Text>
        </Paper>

        <Text size="xs" c="dimmed">
          Газова доба йде з 07:00 до 07:00, тому години беруться саме за цими
          межами, а доби — за днями, якими вони підписані.
        </Text>

        {counted && (
          <>
            <Table withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Коректор</Table.Th>
                  <Table.Th>Період, що потрапляє</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {counted.devices.map((d) => (
                  <Table.Tr key={`${d.device_id}-${d.from}`}>
                    <Table.Td>№{d.ser_num}</Table.Td>
                    <Table.Td>
                      {d.from.replace('T', ' ').slice(0, 16)} — {d.to.replace('T', ' ').slice(0, 16)}
                    </Table.Td>
                  </Table.Tr>
                ))}
                {counted.devices.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={2}>
                      <Text size="sm" c="dimmed">
                        У цей період на підприємстві не стояв жоден коректор
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>

            <Alert
              color={total === 0 ? 'gray' : 'orange'}
              variant="light"
              icon={<IconAlertTriangle size={16} />}
            >
              {total === 0 ? (
                'У цьому періоді записів немає — видаляти нічого.'
              ) : (
                <>
                  Буде видалено <b>{counted.hourly}</b> годинних і <b>{counted.daily}</b> добових
                  записів. Це незворотно. З ДПД повернеться лише те, що
                  перечитають; начитане модемом не повернеться — у коректорі
                  лежать тижні, а не роки.
                </>
              )}
            </Alert>
          </>
        )}

        <Group justify="flex-end">
          <Button variant="default" size="xs" onClick={onClose}>
            Скасувати
          </Button>
          <Button
            size="xs"
            color="red"
            leftSection={<IconTrash size={15} />}
            disabled={backwards || !counted || total === 0}
            loading={purge.isPending}
            onClick={() => purge.mutate()}
          >
            {everything ? 'Видалити весь архів' : 'Видалити'}
            {counted && total > 0 ? ` (${total})` : ''}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
