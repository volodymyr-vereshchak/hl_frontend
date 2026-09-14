import { useState } from 'react'
import { Alert, Badge, Button, Code, Group, Paper, Stack, Text, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconDownload, IconKey } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { branchAdminApi } from '@/api/admin'
import {
  pollingApi,
  type AgentInstaller,
  type PollAgent,
  type PollAgentCreated,
} from '@/api/polling'
import { copyText } from '@/lib/clipboard'
import { toOptions } from '../useAdminTopology'
import { CrudTable } from '../CrudTable'

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
    refetchInterval: 5000,
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
        )}
      />
    </>
  )
}


/**
 * The agent itself, next to the key it needs.
 *
 * Getting the program onto an operator's machine used to be a folder on a
 * share and a phone call. Here it is the second step of the screen that
 * already issued the key: create the agent, take the .exe, run it.
 *
 * The server may have no build — it is a build artifact, put in place the way
 * the frontend build is — and that is said in words rather than left as a
 * button that answers 404.
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
            Створіть агента нижче, скопіюйте ключ, завантажте файл на ту машину
            й запустіть. Він сам запитає адресу сервера, ключ і COM-порт.
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
            Завантажити .exe
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
  if (agent.online) {
    return (
      <Badge size="sm" color="teal" variant="light">
        на зв'язку
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

/** How long the silence has lasted, in the roughest unit that still says it. */
function silence(since: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000))
  if (minutes < 60) return `${minutes} хв`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} год`
  return `${Math.round(hours / 24)} дн`
}
