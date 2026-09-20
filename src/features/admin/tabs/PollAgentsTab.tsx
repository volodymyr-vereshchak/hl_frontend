import { useState } from 'react'
import { Alert, Badge, Button, Code, Group, Paper, Stack, Text, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import {
  IconAlertTriangle,
  IconDownload,
  IconFileText,
  IconKey,
  IconPhoneCall,
} from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { branchAdminApi } from '@/api/admin'
import {
  pollingApi,
  type AgentInstaller,
  type PollAgent,
  type PollAgentBusy,
  type PollAgentCreated,
} from '@/api/polling'
import { copyText } from '@/lib/clipboard'
import { toOptions } from '../useAdminTopology'
import { CrudTable } from '../CrudTable'
import { PollLogModal } from '../PollLogModal'

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })

const AGENTS_KEY = ['admin', 'poll-agents']

/**
 * Агенти опитування — the machines allowed to dial meters.
 *
 * An agent is a service on somebody's workstation, not a browser session, so
 * it authenticates with a key instead of a cookie. The key is shown once, on
 * creation, and only its hash is kept: one that could be read back later is
 * one that leaks from wherever it is read. Lost means reissued, which is what
 * «Новий ключ» is for — and it stops the old one working immediately.
 */
export function PollAgentsTab() {
  const qc = useQueryClient()
  // Shown once and never again, so it stays until it is dismissed — the same
  // treatment a generated user password gets.
  const [issuedKey, setIssuedKey] = useState<{ name: string; key: string } | null>(null)
  // The call being watched, as it was when the window was opened. The card is
  // remembered, not looked up again: when the agent hangs up, the journal is
  // still the answer to what just happened, and a window that vanishes the
  // moment the call ends takes the last lines away with it.
  const [watching, setWatching] = useState<
    { agentId: number; deviceId: number; label: string } | null
  >(null)

  const { data: branches } = useQuery({
    queryKey: ['admin', 'branches'],
    queryFn: branchAdminApi.getAll,
  })
  const { data: agents } = useQuery({
    queryKey: AGENTS_KEY,
    queryFn: pollingApi.getAgents,
    // Two things on this screen move without anybody touching it: whether a
    // machine is on the line, and how many sites it was given in the monitor.
    // The table shares this query, so refreshing here refreshes it too.
    //
    // Twenty seconds, not five. An agent counts as on the line if it was heard
    // from in the last minute, so asking twelve times inside that minute
    // cannot make the answer any fresher — it only makes the browser talk. The
    // count of sites does not wait for this either: assigning one invalidates
    // this query outright.
    //
    // A call in progress is the exception: it is the one thing here that
    // moves minute by minute, so while any agent is on the phone the screen
    // asks every five seconds and goes back to twenty when they hang up.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((a) => a.busy) ? 5000 : 20000,
  })
  const { data: installer } = useQuery({
    queryKey: ['admin', 'poll-agent-installer'],
    queryFn: pollingApi.getAgentInstaller,
  })

  const rotate = useMutation({
    mutationFn: (a: PollAgent) => pollingApi.rotateKey(a.id),
    onSuccess: (created) => {
      setIssuedKey({ name: created.name, key: created.key })
      qc.invalidateQueries({ queryKey: AGENTS_KEY })
    },
    onError: notifyErr,
  })

  // Whether that call is still running is read from the list, which refreshes
  // itself — so the window stops following the file at the moment the agent
  // hangs up, and says so, rather than either freezing or closing.
  const watchedAgent = (agents ?? []).find((a) => a.id === watching?.agentId) ?? null
  const stillOnTheLine =
    watchedAgent?.busy?.poll_device_id != null &&
    watchedAgent.busy.poll_device_id === watching?.deviceId

  const branchName = (id: number | null) =>
    id == null ? 'Усі філії' : ((branches ?? []).find((b) => b.id === id)?.name ?? `#${id}`)

  /** An agent that took nothing polls nothing — worth saying, because an
   *  empty column looks the same as a working setup. */
  const idle = (agents ?? []).filter((a) => a.active && a.device_count === 0)

  return (
    <>
      <Installer build={installer} />

      {issuedKey && (
        <Alert
          color="amber"
          variant="light"
          icon={<IconKey size={16} />}
          withCloseButton
          onClose={() => setIssuedKey(null)}
          mb="sm"
          title={`Ключ агента «${issuedKey.name}»`}
        >
          <Text size="sm" mb={6}>
            Скопіюйте його зараз — більше він ніде не показується.
          </Text>
          <Group gap="xs">
            <Code style={{ wordBreak: 'break-all' }}>{issuedKey.key}</Code>
            <Button size="compact-xs" variant="light" onClick={() => copyText(issuedKey.key)}>
              Копіювати
            </Button>
          </Group>
        </Alert>
      )}

      <CrudTable<PollAgent, PollAgentCreated>
        title="Агенти опитування"
        description="Машини з модемами, яким дозволено опитувати прилади"
        queryKey={AGENTS_KEY}
        fetchAll={pollingApi.getAgents}
        searchKeys={['name', 'host']}
        rowLabel={(a) => a.name}
        create={(v) =>
          pollingApi.createAgent({
            name: String(v.name ?? '').trim(),
            branch_id: v.branch_id ?? null,
            active: v.active !== false,
          })
        }
        update={(id, v) =>
          pollingApi.updateAgent(id, {
            name: String(v.name ?? '').trim(),
            branch_id: v.branch_id ?? null,
            active: !!v.active,
          })
        }
        remove={(id) => pollingApi.removeAgent(id)}
        onCreated={(created) => setIssuedKey({ name: created.name, key: created.key })}
        notice={
          idle.length > 0 ? (
            <Alert color="amber" variant="light" icon={<IconAlertTriangle size={16} />}>
              Агентів без жодного приладу: {idle.length}. Такий агент нічого не
              опитує — прилади обираються в його налаштуваннях.
            </Alert>
          ) : undefined
        }
        fields={[
          {
            key: 'name',
            label: 'Назва',
            required: true,
            // The one field that says which machine this is, so it is worth
            // making it say it: a hostname plus where the box stands.
            placeholder: 'Напр.: Запоріжжя, каб. 214 (PC-ZP-214)',
          },
          {
            key: 'branch_id',
            label: 'Філія',
            type: 'select',
            numericValue: true,
            options: toOptions(branches ?? []),
            render: (a) => branchName(a.branch_id),
          },
          { key: 'active', label: 'Активний', type: 'checkbox' },
          {
            key: 'device_count',
            label: 'Приладів',
            hideInForm: true,
            numeric: true,
            render: (a) => (
              <Badge size="sm" variant="light" color={a.device_count ? 'teal' : 'amber'}>
                {a.device_count}
              </Badge>
            ),
          },
          {
            key: 'last_seen_at',
            label: 'Стан',
            hideInForm: true,
            render: (a) => <Presence agent={a} />,
          },
          {
            key: 'host',
            label: 'Машина',
            hideInForm: true,
            render: (a) => (
              <Text size="xs" c="dimmed">
                {[a.host, a.version].filter(Boolean).join(' · ') || '—'}
              </Text>
            ),
          },
        ]}
        extraRowActions={(a) => (
          <>
            {/* The call as it happens. Disabled rather than hidden when the
                agent is free: the button is where somebody looks for it, and
                «зараз нікого не опитує» is the answer they came for. */}
            <Tooltip
              label={
                a.busy
                  ? `Показати, що зараз відбувається: ${a.busy.label ?? 'дзвінок'}`
                  : 'Агент зараз нікого не опитує — показувати нічого'
              }
              withArrow
            >
              <Button
                size="compact-xs"
                variant="subtle"
                leftSection={<IconFileText size={13} />}
                data-disabled={!a.busy || undefined}
                onClick={() =>
                  a.busy &&
                  setWatching({
                    agentId: a.id,
                    deviceId: a.busy.poll_device_id,
                    label: `${a.name} → ${a.busy.label ?? 'дзвінок'}`,
                  })
                }
              >
                Поточний лог
              </Button>
            </Tooltip>
            <Tooltip label="Видати новий ключ; старий одразу перестає працювати" withArrow>
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={<IconKey size={13} />}
              loading={rotate.isPending && rotate.variables?.id === a.id}
              onClick={() => rotate.mutate(a)}
            >
              Новий ключ
            </Button>
          </Tooltip>
          </>
        )}
      />

      <PollLogModal
        opened={watching != null}
        deviceId={watching?.deviceId ?? null}
        label={watching?.label ?? ''}
        live={stillOnTheLine}
        note={
          stillOnTheLine && watchedAgent?.busy
            ? callDetail(watchedAgent.busy)
            : watching
              ? 'Дзвінок завершено — це журнал того, що встигло відбутися'
              : undefined
        }
        onClose={() => setWatching(null)}
      />
    </>
  )
}


/**
 * The agent itself, next to the key it needs.
 *
 * Getting the program onto an operator's machine used to be a folder on a
 * share and a phone call. Here it is the second step of the screen that
 * already issued the key: create the agent, take the archive, run what is
 * inside it.
 *
 * A zip rather than the .exe itself: the archive saves nothing on size, but an
 * .exe arriving through a browser is what proxies and mail filters strike out.
 *
 * The server may have no build at all, and that is said in words rather than
 * left as a button that answers 404.
 */
function Installer({ build }: { build?: AgentInstaller }) {
  const megabytes = build?.size ? (build.size / 1024 / 1024).toFixed(1) : null
  const built = build?.built_at ? new Date(build.built_at).toLocaleDateString('uk-UA') : null

  return (
    <Paper withBorder p="sm" radius="md" mb="sm">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={2}>
          <Text size="sm" fw={500}>
            Програма агента для машини з модемом
          </Text>
          <Text size="xs" c="dimmed">
            Створіть агента нижче, скопіюйте ключ, завантажте архів на ту машину,
            розпакуйте й запустіть. Програма сама запитає адресу сервера, ключ і
            COM-порт.
          </Text>
          {build?.available && (
            <Text size="xs" c="dimmed">
              {build.filename} · {megabytes} МБ{built ? ` · зібрано ${built}` : ''}
            </Text>
          )}
        </Stack>
        {build?.available ? (
          <Button
            size="xs"
            variant="light"
            leftSection={<IconDownload size={14} />}
            onClick={() => pollingApi.downloadAgent()}
          >
            Завантажити
          </Button>
        ) : (
          <Tooltip
            label="Покладіть збірку в backend/data/agent на сервері (hl_poller/build_exe.py --install)"
            withArrow
            multiline
            w={280}
          >
            <Text size="xs" c="dimmed">
              Збірки немає на сервері
            </Text>
          </Tooltip>
        )}
      </Group>
    </Paper>
  )
}


/**
 * Is this machine there right now.
 *
 * The registry cannot answer that: an agent whose workstation went home still
 * holds its assignments and looks, on every other column, exactly like one
 * that is working. The server decides it by the same silence it uses to
 * refuse an immediate poll, so the badge and the refusal always agree.
 */
function Presence({ agent }: { agent: PollAgent }) {
  // Said before anything about the connection: an agent of the wrong build is
  // on the line and polls nothing, and "на зв'язку" beside a machine that
  // picks nothing up is the more confusing of the two facts.
  if (!agent.version_ok) {
    return (
      <Tooltip
        label={`Агент версії ${agent.version ?? '—'}, сервер роздає ${
          agent.expected_version ?? '—'
        }. Опитування зупинено. Завантажте збірку вище й перезапустіть агента.`}
        withArrow
        multiline
        w={300}
      >
        <Badge size="sm" color="red" variant="light" leftSection={<IconAlertTriangle size={11} />}>
          версія {agent.version ?? '—'}
        </Badge>
      </Tooltip>
    )
  }
  // Дзвонить — the answer to "is this machine doing anything right now",
  // which «на зв'язку» never was: an agent can sit online all day and poll
  // nothing. A claim is held only for the length of one call, so its mere
  // presence is the fact.
  if (agent.busy) {
    return (
      <Tooltip label={callDetail(agent.busy)} withArrow multiline w={260}>
        <Badge
          size="sm"
          color="blue"
          variant="light"
          leftSection={<IconPhoneCall size={11} />}
        >
          опитує · {agent.busy.label ?? `#${agent.busy.poll_device_id}`}
        </Badge>
      </Tooltip>
    )
  }
  if (agent.online) {
    return (
      <Badge size="sm" color="teal" variant="light">
        на зв'язку · вільний
      </Badge>
    )
  }
  if (!agent.last_seen_at) {
    return (
      <Tooltip label="Програму агента ще жодного разу не запускали з цим ключем" withArrow>
        <Badge size="sm" color="gray" variant="light">
          ще не виходив
        </Badge>
      </Tooltip>
    )
  }
  return (
    <Tooltip label={new Date(agent.last_seen_at).toLocaleString('uk-UA')} withArrow>
      <Badge size="sm" color="gray" variant="light">
        офлайн · {silence(agent.last_seen_at)}
      </Badge>
    </Tooltip>
  )
}

const PHASE_NAMES: Record<string, string> = {
  hourly: 'годинний архів',
  daily: 'добовий архів',
}

/** What the running call is doing, for the tooltip over «опитує». */
function callDetail(busy: PollAgentBusy): string {
  const parts: string[] = []
  if (busy.since) {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(busy.since).getTime()) / 60000))
    parts.push(`Дзвінок триває ${minutes} хв`)
  }
  const phase = busy.phase ? PHASE_NAMES[busy.phase] : null
  if (phase && busy.total) parts.push(`${phase}: ${busy.done ?? 0} з ${busy.total}`)
  else if (phase) parts.push(phase)
  else parts.push("З'єднання")
  return parts.join(' · ')
}

/** How long the silence has lasted, in the roughest unit that still says it. */
function silence(since: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000))
  if (minutes < 60) return `${minutes} хв`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} год`
  return `${Math.round(hours / 24)} дн`
}
