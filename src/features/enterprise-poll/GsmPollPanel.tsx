import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Progress,
  ScrollArea,
  Stack,
  Text,
} from '@mantine/core'
import {
  IconAlertTriangle,
  IconCheck,
  IconPhone,
  IconPlayerStop,
} from '@tabler/icons-react'
import { useMutation } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'

import { enterprisePollApi, type PollLogLine, type PollWatch } from '@/api/polling'

/**
 * A GSM poll as it happens.
 *
 * The call is made on an operator's workstation, minutes away from this
 * screen, and one hour of archive is one request down a phone line. Without
 * something moving, a poll of a month looks exactly like a page that has
 * frozen — so this shows the modem's own account of the call and counts the
 * records as they arrive.
 */

/** How often to ask. A second is what makes the dialling feel live; the
 *  request is cheap because it only asks for lines it has not seen. */
const REFRESH_MS = 1000

interface Props {
  enterpriseId: number
  enterpriseName: string
  /** Bumped by the parent on every new «Опитати», so the panel starts clean
   *  rather than continuing the previous session's log. */
  runKey: number
}

export function GsmPollPanel({ enterpriseId, enterpriseName, runKey }: Props) {
  const [watch, setWatch] = useState<PollWatch | null>(null)
  const cancel = useMutation({
    mutationFn: () => enterprisePollApi.cancel(enterpriseId),
    onSuccess: (result) => {
      notifications.show({
        color: result.outcome === 'idle' ? 'gray' : 'orange',
        message: result.detail,
      })
      // Shown at once rather than waited for: the next tick is up to a second
      // away, and a button that goes on offering to stop what it just stopped
      // gets pressed again.
      setWatch((have) =>
        have && result.outcome === 'asked' ? { ...have, cancelling: true } : have,
      )
    },
    onError: (e: Error) =>
      notifications.show({ color: 'red', message: e.message }),
  })

  const [lines, setLines] = useState<PollLogLine[]>([])
  const [failed, setFailed] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setWatch(null)
    setLines([])
    setFailed(null)

    let alive = true
    let seq = 0
    // One request at a time.
    //
    // The tick fires every second; on a slow link a request takes longer than
    // that, and two would go out asking from the same `seq` — which is how
    // the journal on one workstation showed «Ініціалізація» and the dialling
    // several times over while the file on the server held one of each. The
    // duplicates were never in the data; they were this loop racing itself.
    let inFlight = false

    const tick = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const next = await enterprisePollApi.watch(enterpriseId, seq)
        if (!alive) return
        setWatch(next)
        if (next.lines.length) {
          seq = next.lines[next.lines.length - 1].seq
          // And belt as well as braces: a line already on the screen is
          // dropped by its sequence number, whatever asked for it.
          setLines((have) => {
            const known = new Set(have.map((line) => line.seq))
            const fresh = next.lines.filter((line) => !known.has(line.seq))
            return fresh.length ? [...have, ...fresh] : have
          })
        }
        setFailed(null)
      } catch (e) {
        // A refresh that fails is not a poll that failed: the call carries on
        // beside the modem. Say so quietly and keep asking.
        if (alive) setFailed(e instanceof Error ? e.message : 'немає зв’язку з сервером')
      } finally {
        inFlight = false
      }
    }

    void tick()
    const timer = setInterval(() => void tick(), REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [enterpriseId, runKey])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [lines.length])

  const running = watch?.status === 'waiting' || watch?.status === 'polling'
  const done = watch?.done ?? 0
  const total = watch?.total ?? 0

  return (
    <Stack gap="xs" h="100%">
      <Group gap="xs" wrap="nowrap">
        <IconPhone size={16} />
        <Text fw={600} size="sm">
          {enterpriseName}
        </Text>
        {watch?.ser_num != null && (
          <Badge size="xs" variant="light">
            №{watch.ser_num}
          </Badge>
        )}
        <StatusBadge status={watch?.status} agent={watch?.agent_name} />
        {/* Only while there is something to stop. A call already finished
            has nothing to cancel, and a button that does nothing invites the
            press that proves it. */}
        {running && (
          <Button
            size="compact-xs"
            variant="subtle"
            color="red"
            ml="auto"
            leftSection={<IconPlayerStop size={13} />}
            loading={cancel.isPending}
            disabled={watch?.cancelling}
            onClick={() => cancel.mutate()}
          >
            {watch?.cancelling ? 'зупиняю…' : 'Зупинити'}
          </Button>
        )}
      </Group>

      {/* What this source is, in the pane that describes it. Switching to GSM
          used to leave the ДПД description standing, which reads as "the
          modem fetches from the vendor's server" — the opposite of the truth. */}
      <Text size="xs" c="dimmed">
        Агент біля модема дзвонить на прилад і читає годинний та добовий
        архіви від останнього запису в базі до поточної години. Якщо в базі
        порожньо — 30 діб годин і кільце добових, скільки прилад тримає.
      </Text>

      {/* The wait is real and worth naming: the agent learns of this on its
          next report, and hangs up between records rather than mid-reading. */}
      {watch?.cancelling && (
        <Text size="xs" c="orange">
          Зупиняю — агент покладе слухавку, щойно дочитає поточний запис.
          Прочитане цим дзвінком буде відкинуто, щоб не лишити дірку в архіві;
          дані нікуди не зникнуть, їх прочитає наступний опит.
        </Text>
      )}

      {/* Two different waits, and an operator needs to tell them apart: the
          request sitting unread, and the phone actually ringing. */}
      {watch?.status === 'waiting' && (
        <Group gap={6}>
          <Loader size="xs" />
          <Text size="xs" c="dimmed">
            Чекаю, поки агент {watch.agent_name ? `«${watch.agent_name}» ` : ''}
            візьме завдання
          </Text>
        </Group>
      )}

      {/* Labelled from the agent's own phase rather than from the first thing
          it happened to read. It said "прочитано годин" through the whole of
          the daily ring, counting days — and before any reading began at all,
          while the modem was still dialling. */}
      {total > 0 && (
        <Stack gap={2}>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              {watch?.phase === 'daily' ? 'Прочитано діб' : 'Прочитано годин'}
            </Text>
            <Text size="xs" c="dimmed">
              {done} з {total}
            </Text>
          </Group>
          <Progress
            value={(done / total) * 100}
            animated={running}
            size="sm"
            radius="sm"
            color={watch?.phase === 'daily' ? 'grape' : undefined}
          />
        </Stack>
      )}

      {watch?.status === 'error' && watch.error_text && (
        <Alert
          color="red"
          variant="light"
          icon={<IconAlertTriangle size={16} />}
          p="xs"
        >
          <Text size="xs">{watch.error_text}</Text>
        </Alert>
      )}

      {watch?.status === 'ok' && (
        <Alert color="green" variant="light" icon={<IconCheck size={16} />} p="xs">
          {/* Both counts: the call reads two archives, and a summary that
              named one of them left the other looking like it had not run. */}
          <Text size="xs">
            Готово. Прочитано годин: {watch.rows?.hour ?? 0}, діб:{' '}
            {watch.rows?.day ?? 0}
          </Text>
        </Alert>
      )}

      {failed && (
        <Text size="xs" c="orange">
          Оновлення не пройшло ({failed}) — опитування триває, спробую ще раз
        </Text>
      )}

      <Paper withBorder p="xs" style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea h="100%" type="auto">
          <Stack gap={2}>
            {lines.length === 0 && (
              <Text size="xs" c="dimmed">
                Журнал сеансу з'явиться, щойно агент почне дзвонити.
              </Text>
            )}
            {lines.map((line) => (
              <Text
                key={line.seq}
                size="xs"
                ff="monospace"
                c={line.level === 'error' ? 'red' : undefined}
              >
                {line.ts ? `${new Date(line.ts).toLocaleTimeString('uk-UA')} ` : ''}
                {line.message}
              </Text>
            ))}
            <div ref={bottom} />
          </Stack>
        </ScrollArea>
      </Paper>
    </Stack>
  )
}

function StatusBadge({
  status,
  agent,
}: {
  status?: PollWatch['status']
  agent?: string | null
}) {
  if (status === 'polling') {
    return (
      <Badge size="xs" color="blue" variant="light">
        {agent ? `на зв'язку: ${agent}` : 'опитування'}
      </Badge>
    )
  }
  if (status === 'ok') {
    return (
      <Badge size="xs" color="green" variant="light">
        готово
      </Badge>
    )
  }
  if (status === 'error') {
    return (
      <Badge size="xs" color="red" variant="light">
        помилка
      </Badge>
    )
  }
  return (
    <Badge size="xs" color="gray" variant="light">
      очікування
    </Badge>
  )
}
