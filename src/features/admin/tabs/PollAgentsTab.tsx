import { useState } from 'react'
import { Alert, Badge, Button, Code, Group, Text, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconKey } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { branchAdminApi } from '@/api/admin'
import { pollingApi, type PollAgent, type PollAgentCreated } from '@/api/polling'
import { copyText } from '@/lib/clipboard'
import { toOptions } from '../useAdminTopology'
import { CrudTable } from '../CrudTable'

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })

const AGENTS_KEY = ['admin', 'poll-agents']

const KIND_OPTIONS = [
  { value: 'workstation', label: 'АРМ оператора' },
  { value: 'dedicated', label: 'Виділена машина' },
]

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
  const { data: agents } = useQuery({ queryKey: AGENTS_KEY, queryFn: pollingApi.getAgents })

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
            kind: v.kind ?? 'workstation',
            branch_id: v.branch_id ?? null,
            active: v.active !== false,
          })
        }
        update={(id, v) =>
          pollingApi.updateAgent(id, {
            name: String(v.name ?? '').trim(),
            kind: v.kind,
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
          { key: 'name', label: 'Назва', required: true },
          { key: 'kind', label: 'Тип', type: 'select', options: KIND_OPTIONS },
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
            label: 'Востаннє на зв’язку',
            hideInForm: true,
            render: (a) =>
              a.last_seen_at ? (
                new Date(a.last_seen_at).toLocaleString()
              ) : (
                <Text size="xs" c="dimmed">
                  ще не виходив
                </Text>
              ),
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
