import { useState } from 'react'
import {
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Table,
  Text,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { IconAlertTriangle, IconCalendar, IconTrash } from '@tabler/icons-react'
import { useMutation } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { enterpriseApi, type ArchivePurge } from '@/api/enterprise'

interface Props {
  enterprise: { id: number; enterprise_name: string } | null
  onClose: () => void
  onPurged?: () => void
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Removing a stretch of a point's archive.
 *
 * Deliberate, irreversible and rare, so it is counted before it is done: the
 * dialog says how many rows would go and from which correctors, and the
 * button that removes them cannot be pressed before that count has been
 * fetched.
 *
 * The dates are gas days — the hours of one run from 07:00 to 07:00 — and the
 * server clips the range to the window each corrector actually stood at this
 * point, so a device that came from somewhere else keeps the rows it made
 * there.
 */
export function ArchivePurgeModal({ enterprise, onClose, onPurged }: Props) {
  const today = new Date()
  const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate())
  const [from, setFrom] = useState<string>(iso(monthAgo))
  const [to, setTo] = useState<string>(iso(today))
  const [seen, setSeen] = useState<ArchivePurge | null>(null)

  const range = { from_date: from, to_date: to }

  const count = useMutation({
    mutationFn: () => enterpriseApi.previewArchivePurge(enterprise!.id, range),
    onSuccess: setSeen,
    onError: (e: Error) => notifications.show({ color: 'red', message: e.message }),
  })

  const purge = useMutation({
    mutationFn: () => enterpriseApi.purgeArchive(enterprise!.id, range),
    onSuccess: (removed) => {
      notifications.show({
        color: 'green',
        message: `Видалено: ${removed.hourly} годинних, ${removed.daily} добових`,
      })
      onPurged?.()
      close()
    },
    onError: (e: Error) => notifications.show({ color: 'red', message: e.message }),
  })

  const close = () => {
    setSeen(null)
    onClose()
  }

  // A new range invalidates the count that was shown for the old one.
  const pick = (setter: (v: string) => void) => (value: string | null) => {
    if (!value) return
    setSeen(null)
    setter(value)
  }

  const nothing = seen != null && seen.hourly === 0 && seen.daily === 0

  return (
    <Modal opened={!!enterprise} onClose={close} title="Очистити архів" size="lg">
      <Stack gap="sm">
        <Text size="sm">
          Підприємство: <b>{enterprise?.enterprise_name}</b>
        </Text>

        <Group gap="sm" align="flex-end">
          <DatePickerInput
            label="Від газової доби"
            leftSection={<IconCalendar size={15} />}
            value={from}
            onChange={pick(setFrom)}
            valueFormat="DD.MM.YYYY"
            size="xs"
            w={170}
            popoverProps={{ zIndex: 500, withinPortal: true }}
          />
          <DatePickerInput
            label="До газової доби, включно"
            leftSection={<IconCalendar size={15} />}
            value={to}
            onChange={pick(setTo)}
            valueFormat="DD.MM.YYYY"
            size="xs"
            w={190}
            popoverProps={{ zIndex: 500, withinPortal: true }}
          />
          <Button size="xs" variant="light" loading={count.isPending} onClick={() => count.mutate()}>
            Порахувати
          </Button>
        </Group>

        <Text size="xs" c="dimmed">
          Газова доба йде з 07:00 до 07:00, тому години беруться саме за цими
          межами, а доби — за днями, якими вони підписані.
        </Text>

        {seen && (
          <>
            <Table withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Коректор</Table.Th>
                  <Table.Th>Період, що потрапляє</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {seen.devices.map((d) => (
                  <Table.Tr key={`${d.device_id}-${d.from}`}>
                    <Table.Td>№{d.ser_num}</Table.Td>
                    <Table.Td>
                      {d.from.replace('T', ' ').slice(0, 16)} — {d.to.replace('T', ' ').slice(0, 16)}
                    </Table.Td>
                  </Table.Tr>
                ))}
                {seen.devices.length === 0 && (
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
              color={nothing ? 'gray' : 'orange'}
              variant="light"
              icon={<IconAlertTriangle size={16} />}
            >
              {nothing ? (
                'У цьому періоді записів немає — видаляти нічого.'
              ) : (
                <>
                  Буде видалено <b>{seen.hourly}</b> годинних і <b>{seen.daily}</b> добових
                  записів. Це незворотно. Те, що потрапляє в останні 30 днів, нічний
                  рефреш ДПД поверне сам; старіше — лише окремим опитуванням того
                  діапазону.
                </>
              )}
            </Alert>
          </>
        )}

        <Group justify="flex-end">
          <Button variant="default" size="xs" onClick={close}>
            Скасувати
          </Button>
          <Button
            size="xs"
            color="red"
            leftSection={<IconTrash size={15} />}
            disabled={!seen || nothing}
            loading={purge.isPending}
            onClick={() => purge.mutate()}
          >
            Видалити
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
