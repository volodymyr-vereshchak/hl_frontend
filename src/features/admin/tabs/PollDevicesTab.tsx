import { useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Progress,
  ScrollArea,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import {
  IconAlertTriangle,
  IconFileText,
  IconInfoCircle,
  IconSearch,
} from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { pollingApi, type PollAgent, type PollDevice } from '@/api/polling'

/**
 * Монітор GSM — a monitor, not an editor.
 *
 * The settings moved to the enterprise card, where the modem actually
 * belongs: it is bolted to the wall at the site, and the correctors under it
 * get replaced. Editing them here as well would be two places to change one
 * number, which is two places to disagree.
 *
 * What is left is the thing the enterprise card cannot show — the state of
 * the whole fleet on one screen — plus the one setting that is genuinely
 * about machines rather than about a site: which agent dials it.
 */

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })

const DEVICES_KEY = ['admin', 'poll-devices']
const AGENTS_KEY = ['admin', 'poll-agents']

export function PollDevicesTab() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  /** The site whose last poll is open in its own window. */
  const [logOf, setLogOf] = useState<PollDevice | null>(null)

  const { data: devices, isLoading } = useQuery({
    queryKey: DEVICES_KEY,
    queryFn: pollingApi.getDevices,
    // A poll runs for minutes and the screen is watched while it does.
    refetchInterval: 5000,
  })
  const { data: agents } = useQuery({
    queryKey: AGENTS_KEY,
    queryFn: pollingApi.getAgents,
    // Whether a machine is on the line changes by itself, and this screen is
    // where somebody decides which machine to give a site to. Unlike the poll
    // state above, this one has a minute of resolution — see the agents tab.
    refetchInterval: 20000,
  })

  const agentOptions = useMemo(
    () =>
      (agents ?? []).map((a) => ({
        value: String(a.id),
        // Said in the option itself: a site handed to a machine that is not
        // running looks assigned here and refuses to poll over there.
        label: a.online ? a.name : `${a.name} · офлайн`,
      })),
    [agents],
  )
  const agentById = useMemo(
    () => new Map((agents ?? []).map((a) => [a.id, a])),
    [agents],
  )

  const assign = useMutation({
    mutationFn: ({ deviceId, agentIds }: { deviceId: number; agentIds: number[] }) =>
      pollingApi.setDeviceAgents(deviceId, agentIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DEVICES_KEY })
      // The agents screen counts sites per machine. Without this the number
      // there stays as it was until something else happens to refetch it,
      // which reads as an assignment that did not take.
      queryClient.invalidateQueries({ queryKey: AGENTS_KEY })
    },
    onError: notifyErr,
  })

  if (isLoading) return <Loader size="sm" />

  const cards = (devices ?? []).filter((d) => d.enterprise_id != null)
  const q = search.trim().toLowerCase()
  // Name, serial or phone: the three things somebody arrives here holding.
  // A phone typed with spaces or without the country code still has to find
  // the row, so digits are compared against digits.
  const digits = q.replace(/\D/g, '')
  const shown = q
    ? cards.filter(
        (c) =>
          (c.target_label ?? '').toLowerCase().includes(q) ||
          String(c.ser_num ?? '').includes(digits || q) ||
          (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits)),
      )
    : cards

  if (cards.length === 0) {
    return (
      <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />}>
        <Text size="sm">
          Жодне підприємство не має модема. Номер телефону вписується в картці
          підприємства — «Адміністрування → Підприємства», блок «Опитування
          модемом». Картка тут з'явиться сама.
        </Text>
      </Alert>
    )
  }

  return (
    <>
      <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />} mb="sm">
        <Text size="xs">
          Телефон, графік і години опитування — у картці підприємства. Тут видно
          стан по всьому парку і призначається машина, яка дзвонить.
        </Text>
      </Alert>

      <Group mb="sm" gap="sm" align="flex-end">
        <TextInput
          size="xs"
          w={300}
          label="Пошук"
          placeholder="Підприємство, № коректора або телефон"
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <Text size="xs" c="dimmed" pb={6}>
          {shown.length === cards.length
            ? `Підприємств: ${cards.length}`
            : `Знайдено: ${shown.length} з ${cards.length}`}
        </Text>
      </Group>

      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Підприємство</Table.Th>
            <Table.Th>Телефон</Table.Th>
            <Table.Th>Коректор</Table.Th>
            <Table.Th>Графік</Table.Th>
            <Table.Th w={260}>Хто опитує</Table.Th>
            <Table.Th>Останній опит</Table.Th>
            <Table.Th>Стан</Table.Th>
            <Table.Th w={40} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {shown.map((card) => (
            <Table.Tr key={card.id}>
              <Table.Td>
                <Text size="sm">{card.target_label ?? '—'}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs" ff="monospace">
                  {card.phone ?? '—'}
                </Text>
              </Table.Td>
              <Table.Td>
                <Corrector card={card} />
              </Table.Td>
              <Table.Td>
                <Schedule card={card} />
              </Table.Td>
              <Table.Td>
                <MultiSelect
                  size="xs"
                  data={agentOptions}
                  value={card.agent_ids.map(String)}
                  onChange={(ids) =>
                    assign.mutate({ deviceId: card.id, agentIds: ids.map(Number) })
                  }
                  placeholder={card.agent_ids.length ? undefined : 'нікому'}
                  // A site nobody took is never polled, and on every other
                  // column it looks exactly like a site that is fine.
                  error={card.agent_ids.length === 0}
                  searchable
                  clearable
                />
              </Table.Td>
              <Table.Td>
                <LastPoll card={card} agentName={
                  card.last_agent_id != null
                    ? agentById.get(card.last_agent_id)?.name
                    : undefined
                } />
              </Table.Td>
              <Table.Td>
                <State card={card} agents={agentById} />
              </Table.Td>
              <Table.Td>
                <Tooltip label="Журнал останнього опитування" withArrow>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    onClick={() => setLogOf(card)}
                  >
                    <IconFileText size={14} />
                  </Button>
                </Tooltip>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      {shown.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" py="md">
          Нічого не знайдено
        </Text>
      )}

      <LogModal card={logOf} onClose={() => setLogOf(null)} />
    </>
  )
}

/**
 * The log of the last call to one site.
 *
 * Read from a file rather than from the live log: that one is wiped when the
 * next session starts, and the question asked here is about the session that
 * has already ended — usually right after it failed, by somebody deciding
 * whether the meter needs a visit.
 */
function LogModal({ card, onClose }: { card: PollDevice | null; onClose: () => void }) {
  const { data, isFetching } = useQuery({
    queryKey: ['admin', 'poll-log', card?.id],
    queryFn: () => pollingApi.getLastLog(card!.id),
    enabled: card != null,
    // A poll that is running writes into this file as it goes.
    refetchInterval: card?.polling_agent_id != null ? 3000 : false,
  })

  return (
    <Modal
      opened={card != null}
      onClose={onClose}
      title={`Журнал опитування — ${card?.target_label ?? ''}`}
      size="xl"
    >
      {isFetching && !data ? (
        <Loader size="sm" />
      ) : data?.text ? (
        <>
          <Text size="xs" c="dimmed" mb={6}>
            {data.updated_at
              ? `Записано ${new Date(data.updated_at).toLocaleString('uk-UA')}`
              : ''}
          </Text>
          <ScrollArea h={420} type="auto">
            <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {data.text}
            </Code>
          </ScrollArea>
        </>
      ) : (
        <Text size="sm" c="dimmed">
          Це підприємство ще жодного разу не опитували через GSM — журналу
          немає.
        </Text>
      )}
    </Modal>
  )
}

/** Whichever corrector stands there today — resolved by the server, not stored. */
function Corrector({ card }: { card: PollDevice }) {
  if (!card.still_installed) {
    return (
      <Tooltip label="Усі коректори зняті — опитування відмовить" withArrow>
        <Badge size="xs" color="red" variant="light">
          немає встановлених
        </Badge>
      </Tooltip>
    )
  }
  return (
    <Group gap={6} wrap="nowrap">
      <Text size="xs">№{card.ser_num}</Text>
      <Text size="xs" c="dimmed">
        {card.model_name ?? ''}
      </Text>
    </Group>
  )
}

function Schedule({ card }: { card: PollDevice }) {
  if (!card.auto_poll) {
    return (
      <Text size="xs" c="dimmed">
        вручну
      </Text>
    )
  }
  const times = card.poll_times?.length ? card.poll_times.join(', ') : 'загальні години'
  return <Text size="xs">{times}</Text>
}

function LastPoll({ card, agentName }: { card: PollDevice; agentName?: string }) {
  if (!card.last_attempt_at) {
    return (
      <Text size="xs" c="dimmed">
        ще не опитувалось
      </Text>
    )
  }
  const when = new Date(card.last_attempt_at).toLocaleString('uk-UA')
  const rows = card.last_rows ?? {}
  return (
    <Group gap={6} wrap="nowrap">
      <Text size="xs">{when}</Text>
      {card.last_status === 'ok' ? (
        <Badge size="xs" color="green" variant="light">
          годин {rows.hour ?? 0}, діб {rows.day ?? 0}
        </Badge>
      ) : (
        <Tooltip label={card.last_error_text ?? 'помилка'} withArrow multiline w={280}>
          <Badge size="xs" color="red" variant="light">
            {card.last_error_code ?? 'помилка'}
          </Badge>
        </Tooltip>
      )}
      {agentName && (
        <Text size="xs" c="dimmed">
          {agentName}
        </Text>
      )}
    </Group>
  )
}

function State({
  card,
  agents,
}: {
  card: PollDevice
  agents: Map<number, PollAgent>
}) {
  if (card.polling_agent_id != null) {
    const total = card.progress_total ?? 0
    const done = card.progress_done ?? 0
    return (
      <Group gap={6} wrap="nowrap" w={160}>
        <Loader size={12} />
        <div style={{ flex: 1 }}>
          <Text size="xs">
            {agents.get(card.polling_agent_id)?.name ?? 'опитування'}
          </Text>
          {total > 0 && (
            <Progress value={(done / total) * 100} size="xs" radius="sm" animated />
          )}
        </div>
      </Group>
    )
  }
  if (card.manual_requested_at != null) {
    return (
      <Badge size="xs" color="blue" variant="light">
        у черзі
      </Badge>
    )
  }
  if (!card.enabled) {
    return (
      <Badge size="xs" color="gray" variant="light">
        вимкнено
      </Badge>
    )
  }
  if (card.agent_ids.length === 0) {
    return (
      <Tooltip label="Жодна машина не дзвонить цьому підприємству" withArrow>
        <Badge size="xs" color="orange" variant="light" leftSection={
          <IconAlertTriangle size={10} />
        }>
          без агента
        </Badge>
      </Tooltip>
    )
  }
  return (
    <Text size="xs" c="dimmed">
      очікує
    </Text>
  )
}
