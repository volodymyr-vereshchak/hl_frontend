import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  Progress,
  ScrollArea,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import {
  IconAlertTriangle,
  IconDownload,
  IconFileText,
  IconInfoCircle,
  IconSearch,
} from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { describeCron } from '@/domain/cronSchedule'
import { pollingApi, type PollAgent, type PollDevice } from '@/api/polling'
import { useAdminNavigation } from '../adminNavigation'
import { CheckboxFilter } from '@/components/CheckboxFilter'

/**
 * Монітор GSM — a monitor, not an editor.
 *
 * The settings moved to the enterprise card, where the modem actually
 * belongs: it is bolted to the wall at the site, and the correctors under it
 * get replaced. Editing them here as well would be two places to change one
 * number, which is two places to disagree.
 *
 * What is left is the thing the enterprise card cannot show: the state of the
 * whole fleet on one screen. Which agent dials a site went to the card too —
 * setting a site up is one form, not two, and the second one was easy to
 * forget. Every site's name here opens that form, so nothing on this screen
 * is a dead end.
 */

const DEVICES_KEY = ['admin', 'poll-devices']
const AGENTS_KEY = ['admin', 'poll-agents']

export function PollDevicesTab() {
  const [search, setSearch] = useState('')
  /** Filters, all multi-select: the questions asked here are "show me these
   *  two models" and "show me everything that is not fine", not "show me
   *  exactly one thing". */
  const [fState, setFState] = useState<string[]>([])
  const [fMode, setFMode] = useState<string[]>([])
  const [fModel, setFModel] = useState<string[]>([])
  const openEnterprise = useAdminNavigation((s) => s.openEnterprise)
  const openDpdLine = useAdminNavigation((s) => s.openDpdLine)
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

  /** Models that actually have a modem, counted — see the field's comment. */
  const modelOptions = useMemo(() => {
    const seen = new Map<string, number>()
    for (const card of devices ?? []) {
      if (card.enterprise_id == null) continue
      const name = card.model_name ?? '—'
      seen.set(name, (seen.get(name) ?? 0) + 1)
    }
    return [...seen.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'uk'))
      .map(([name, count]) => ({ value: name, label: name, count }))
  }, [devices])

  const modeOptions = useMemo(() => {
    const cards = devices ?? []
    const auto = cards.filter((c) => c.auto_poll).length
    return [
      { value: 'auto', label: 'за графіком', count: auto },
      { value: 'manual', label: 'тільки вручну', count: cards.length - auto },
    ]
  }, [devices])

  /** Likewise: a state nothing is in is a filter that can only empty the
   *  table, and the list is short enough that its absence is informative. */
  const stateFilterOptions = useMemo(() => {
    const seen = new Map<string, number>()
    for (const card of devices ?? []) {
      const state = stateOf(card)
      seen.set(state, (seen.get(state) ?? 0) + 1)
    }
    return [...seen.entries()]
      .map(([value, count]) => ({ value, label: STATE_LABELS[value] ?? value, count }))
      .sort((a, b) => a.label.localeCompare(b.label, 'uk'))
  }, [devices])

  const agentById = useMemo(
    () => new Map((agents ?? []).map((a) => [a.id, a])),
    [agents],
  )

  if (isLoading) return <Loader size="sm" />

  // Every card with a modem, whatever it stands for: a ДПД line can have
  // one of its own, and a monitor that hides half the fleet is a monitor
  // somebody checks and then goes looking elsewhere anyway.
  const cards = devices ?? []
  const q = search.trim().toLowerCase()
  // Name, serial or phone: the three things somebody arrives here holding.
  // A phone typed with spaces or without the country code still has to find
  // the row, so digits are compared against digits.
  const digits = q.replace(/\D/g, '')
  const shown = cards.filter((c) => {
    if (q) {
      const found =
        (c.target_label ?? '').toLowerCase().includes(q) ||
        String(c.ser_num ?? '').includes(digits || q) ||
        (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits))
      if (!found) return false
    }
    if (fState.length && !fState.includes(stateOf(c))) return false
    if (fMode.length && !fMode.includes(c.auto_poll ? 'auto' : 'manual')) return false
    if (fModel.length && !fModel.includes(c.model_name ?? '—')) return false
    return true
  })

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
          Телефон, графік і машина, яка дзвонить, — у картці підприємства (назва
          в таблиці її відкриває). Тут видно стан по всьому парку.
        </Text>
      </Alert>

      <Group mb="sm" gap="sm" align="flex-end">
        <TextInput
          size="xs"
          w={260}
          label="Пошук"
          placeholder="Підприємство, № коректора або телефон"
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        {/* The control the lines use: a count on the button, checkboxes in
            the list — one row high however much is picked. */}
        <CheckboxFilter
          label="Стан"
          options={stateFilterOptions}
          value={fState}
          onChange={setFState}
          width={220}
        />
        <CheckboxFilter
          label="Як опитується"
          options={modeOptions}
          value={fMode}
          onChange={setFMode}
          width={220}
        />
        {/* Only the models that are actually on this screen. The catalogue
            holds thirty-nine and a handful have modems: a list of the rest is
            a list of ways to filter to nothing. */}
        <CheckboxFilter
          label="Коректор"
          options={modelOptions}
          value={fModel}
          onChange={setFModel}
          searchPlaceholder="Модель коректора"
          width={280}
        />
        <Text size="xs" c="dimmed" pb={6}>
          {shown.length === cards.length
            ? `Підприємств: ${cards.length}`
            : `Показано: ${shown.length} з ${cards.length}`}
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
                {/* The name is the way back to the settings this screen
                    shows but no longer edits. Finding the same site again
                    by hand, down a list of hundreds, is what makes a
                    read-only screen feel like a dead end. */}
                <Tooltip
                  label={
                    card.dpd_line_id != null
                      ? 'Відкрити картку ДПД-лінії'
                      : 'Відкрити картку підприємства'
                  }
                  withArrow
                >
                  <Anchor
                    size="sm"
                    component="button"
                    type="button"
                    ta="left"
                    onClick={() => {
                      if (card.enterprise_id != null) openEnterprise(card.enterprise_id)
                      else if (card.dpd_line_id != null) openDpdLine(card.dpd_line_id)
                    }}
                  >
                    {card.target_label ?? '—'}
                  </Anchor>
                </Tooltip>
                {card.dpd_line_id != null && (
                  // Said on the row, because "Радушне" reads as a site until
                  // somebody notices it is a line.
                  <Badge size="xs" variant="light" color="gray" tt="none" ml={6}>
                    ДПД-лінія
                  </Badge>
                )}
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
                <Assigned card={card} agents={agentById} />
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
  // Two views of one call: what happened, and every frame it took. The second
  // is for working out a fault, so it starts closed and is not remembered —
  // the next site opened is a fresh question.
  const [technical, setTechnical] = useState(false)
  useEffect(() => {
    if (card == null) setTechnical(false)
  }, [card])

  const { data, isFetching } = useQuery({
    queryKey: ['admin', 'poll-log', card?.id, technical],
    queryFn: () =>
      technical ? pollingApi.getDebugLog(card!.id) : pollingApi.getLastLog(card!.id),
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
      <Group justify="space-between" align="center" mb={8} wrap="nowrap">
        <Text size="xs" c="dimmed">
          {data?.updated_at
            ? `Записано ${new Date(data.updated_at).toLocaleString('uk-UA')}`
            : ''}
        </Text>
        <Group gap="sm" wrap="nowrap">
          <Switch
            size="xs"
            checked={technical}
            onChange={(e) => setTechnical(e.currentTarget.checked)}
            label="Технічний журнал"
          />
          {/* The technical journal is read by somebody who is not here: it
              gets sent on. A file is what people attach to a message. */}
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconDownload size={13} />}
            disabled={!data?.text}
            onClick={() => card && saveJournal(card, data?.text ?? '', technical)}
          >
            Завантажити
          </Button>
        </Group>
      </Group>
      {isFetching && !data ? (
        <Loader size="sm" />
      ) : data?.text ? (
        <>
          <ScrollArea h={420} type="auto">
            <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {data.text}
            </Code>
          </ScrollArea>
        </>
      ) : (
        <Text size="sm" c="dimmed">
          {technical
            ? 'Технічного журналу цього дзвінка немає — його пише агент від версії 0.7.0.'
            : 'Це підприємство ще жодного разу не опитували через GSM — журналу немає.'}
        </Text>
      )}
    </Modal>
  )
}

/**
 * Save a journal as a file, named so that a pile of them still makes sense.
 *
 * The site, what kind of journal it is and when it was polled are all in the
 * name, because these travel: the technical one is written for somebody who
 * will read it somewhere else, in a week, next to four others.
 */
function saveJournal(card: PollDevice, text: string, technical: boolean) {
  const site = (card.target_label ?? `прилад-${card.id}`)
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 60)
  const when = new Date()
  const stamp = `${String(when.getDate()).padStart(2, '0')}.${String(
    when.getMonth() + 1,
  ).padStart(2, '0')}.${when.getFullYear()}`
  const name = `${technical ? 'технічний' : 'журнал'} ${site} ${stamp}.log`

  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Given back at once: the browser has copied what it needs by now, and a
  // blob left hanging keeps the whole text in memory until the tab closes.
  URL.revokeObjectURL(url)
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
    <div>
      <Group gap={6} wrap="nowrap">
        <Text size="xs">№{card.ser_num}</Text>
        <Text size="xs" c="dimmed">
          {card.model_name ?? ''}
        </Text>
      </Group>
      {/* What answered the phone, when it is not what the catalogue says. The
          agent reads the corrector by its own account, so this is the model
          actually being polled — and the card is the thing to correct. */}
      {card.detected_model && !sameModel(card.model_name, card.detected_model) && (
        <Tooltip label="Так прилад назвав себе на останньому дзвінку" withArrow>
          <Text size="xs" c="orange">
            відповів: {card.detected_model}
          </Text>
        </Tooltip>
      )}
    </div>
  )
}

/** "ФЛОУТЕК-ТМ-2-3-4" and "Floutek-TM-2-3-4" are the same model in two
 *  alphabets; the version is what decides. */
function sameModel(card: string | null, answered: string): boolean {
  const version = (name: string | null) => name?.match(/\d+(?:[.-]\d+)*/)?.[0] ?? null
  const a = version(card)
  const b = version(answered)
  return a == null || b == null || a === b
}

function Schedule({ card }: { card: PollDevice }) {
  if (!card.auto_poll) {
    return (
      <Text size="xs" c="dimmed">
        вручну
      </Text>
    )
  }
  // The expression itself under the words: an operator reads "Кожні 4 год",
  // and whoever set it up recognises the cron they typed.
  return (
    <div>
      <Text size="xs">{describeCron(card.poll_cron ?? '')}</Text>
      {card.poll_cron && (
        <Text size="10px" c="dimmed" ff="monospace">
          {card.poll_cron}
        </Text>
      )}
    </div>
  )
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

/**
 * Which machines dial this site — shown, not chosen.
 *
 * Chosen on the enterprise card, with the phone number it goes with. Named
 * here anyway: "who should have called this" is the first question asked of a
 * site that has not been polled since Tuesday, and the answer belongs beside
 * the evidence rather than a tab away.
 */
function Assigned({
  card,
  agents,
}: {
  card: PollDevice
  agents: Map<number, PollAgent>
}) {
  if (card.agent_ids.length === 0) {
    return (
      <Tooltip
        label="Призначається в картці підприємства, блок «Опитування модемом»"
        withArrow
      >
        <Badge size="xs" color="orange" variant="light">
          нікому
        </Badge>
      </Tooltip>
    )
  }
  return (
    <Group gap={4} wrap="wrap">
      {card.agent_ids.map((id) => {
        const agent = agents.get(id)
        return (
          <Badge
            key={id}
            size="xs"
            variant="light"
            color={agent?.online ? 'teal' : 'gray'}
          >
            {agent?.name ?? `#${id}`}
            {agent && !agent.online ? ' · офлайн' : ''}
          </Badge>
        )
      })}
    </Group>
  )
}

/**
 * The one word for what a row is doing, and what the filter selects on.
 *
 * Derived here rather than stored so that the badge and the filter cannot
 * disagree — a row filtered as "з помилкою" that shows a green last poll is
 * worse than no filter at all.
 */
export function stateOf(card: PollDevice): string {
  if (card.polling_agent_id != null) return 'polling'
  if (card.manual_requested_at != null) return 'queued'
  if (!card.enabled) return 'off'
  if (card.agent_ids.length === 0) return 'unassigned'
  if (card.last_status === 'ok') return 'ok'
  if (card.last_status) return 'error'
  return 'never'
}

/** What each of those is called on the screen. */
const STATE_LABELS: Record<string, string> = {
  ok: 'успішно',
  error: 'з помилкою',
  polling: 'опитується зараз',
  queued: 'у черзі',
  unassigned: 'без агента',
  off: 'вимкнено',
  never: 'ще не опитували',
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
