import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { IconAlertTriangle, IconCalendar, IconHistory } from '@tabler/icons-react'
import { useMutation } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { streamEnterprisePoll, type PollStored } from '@/api/enterprise'
import { PollProgress } from '@/components/PollProgress'

interface Props {
  enterprise: { id: number; enterprise_name: string } | null
  onClose: () => void
}

/** Where the history starts by default — the same 2024 the server falls back
 *  to for a point with an empty archive. */
const HISTORY_START = '2024-01-01'
const today = () => new Date().toISOString().slice(0, 10)

/**
 * Re-reading ONE point's archive from DPD over a chosen period.
 *
 * «Опитати» on the poll screen already catches a point up — from where its
 * archive ends to tomorrow — so this is for the other case: the stretch is
 * already there and it is wrong, or it was cleared and has to come back. Then
 * the period is not something the server can work out, and it is asked for.
 *
 * Same endpoint as the poll, with the dates spelled out: both granularities,
 * stored as they arrive.
 */
export function EnterpriseRereadModal({ enterprise, onClose }: Props) {
  const [from, setFrom] = useState<string | null>(HISTORY_START)
  const [to, setTo] = useState<string | null>(today())
  const [progress, setProgress] = useState<{
    done?: number
    total?: number
    phase?: string
  } | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    setFrom(HISTORY_START)
    setTo(today())
    setProgress(null)
  }, [enterprise?.id])

  // A poll of a year keeps the connection open for minutes; leaving the dialog
  // has to stop it rather than leave it running behind a closed window.
  useEffect(() => () => abort.current?.abort(), [])

  const backwards = !!from && !!to && from > to

  const reread = useMutation({
    mutationFn: () => {
      abort.current?.abort()
      abort.current = new AbortController()
      return streamEnterprisePoll(
        { enterprise_id: enterprise!.id, from_date: from!, to_date: to! },
        { onProgress: setProgress, signal: abort.current.signal },
      )
    },
    onSuccess: (stored: PollStored) => {
      notifications.show({
        color: 'green',
        message:
          `Перечитано: ${stored.daily} добових і ${stored.hourly} годинних нових, ` +
          `${stored.rewritten} перезаписано`,
      })
      setProgress(null)
      onClose()
    },
    onError: (e: Error) => {
      setProgress(null)
      notifications.show({ color: 'red', message: e.message })
    },
  })

  const close = () => {
    abort.current?.abort()
    onClose()
  }

  return (
    <Modal opened={!!enterprise} onClose={close} title="Перечитати архів підприємства" size="lg">
      <Stack gap="sm">
        <Text size="sm">
          Підприємство: <b>{enterprise?.enterprise_name}</b>
        </Text>

        <Group gap="sm" align="flex-end">
          <DatePickerInput
            label="Від"
            leftSection={<IconCalendar size={15} />}
            value={from}
            onChange={setFrom}
            valueFormat="DD.MM.YYYY"
            size="xs"
            w={190}
            popoverProps={{ zIndex: 500, withinPortal: true }}
          />
          <DatePickerInput
            label="До (включно)"
            leftSection={<IconCalendar size={15} />}
            value={to}
            onChange={setTo}
            valueFormat="DD.MM.YYYY"
            size="xs"
            w={190}
            popoverProps={{ zIndex: 500, withinPortal: true }}
          />
        </Group>

        <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
          Архів цього підприємства за вказаний період буде перечитано з ДПД —
          добовий і годинний. Наявні записи перезапишуться тим, що віддасть ДПД;
          рік історії — це хвилини очікування, вікно краще не закривати.
        </Alert>

        {progress && <PollProgress progress={progress} />}

        <Group justify="flex-end">
          <Button variant="default" size="xs" onClick={close}>
            Скасувати
          </Button>
          <Button
            size="xs"
            color="orange"
            leftSection={<IconHistory size={15} />}
            disabled={!from || !to || backwards}
            loading={reread.isPending}
            onClick={() => reread.mutate()}
          >
            Перечитати
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
