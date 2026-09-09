import { useMemo } from 'react'
import { Alert, Badge, Button, Group, Switch, Text, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconPlayerPlay } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dpdLineAdminApi } from '@/api/admin'
import { enterpriseApi } from '@/api/enterprise'
import { pollingApi, type PollDevice, type PollTargetKind } from '@/api/polling'
import { CrudTable } from '../CrudTable'
import { pollDevicePayload } from './pollDeviceForm'

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })

const DEVICES_KEY = ['admin', 'poll-devices']

const KIND_OPTIONS = [
  { value: 'enterprise', label: 'Підприємство' },
  { value: 'dpd_line', label: 'Лінія ДПД' },
]

const KIND_LABEL: Record<PollTargetKind, string> = {
  enterprise: 'Промисловість',
  dpd_line: 'Лінія ДПД',
}

/** The column the target id lands in, per kind. */
const TARGET_FIELD: Record<PollTargetKind, string> = {
  enterprise: 'enterprise_id',
  dpd_line: 'dpd_line_id',
}

/**
 * Опитування модемом — what to dial, and what happened last time.
 *
 * The card names a SITE, not a corrector, because the modem is at the site and
 * the correctors behind it get replaced. Which device gets read is decided
 * when the agent asks for its plan: whichever is fitted at that moment. The
 * reply is checked against it — a poll that reaches a different serial writes
 * nothing and is raised as an error, because that is either a replacement
 * nobody entered or a call that reached the wrong site.
 *
 * ЛУМГ correctors are not here: Ask2 keeps polling those and writing its
 * hostlib files.
 *
 * Three states on this screen are not settings and are easy to miss by
 * scrolling, so all three are counted in the notice: a site nobody has taken
 * is never polled, a point with no fitted corrector has nothing to dial for,
 * and a site that has never answered has never answered.
 *
 * The adapter and radio fields exist in the API — carried over from
 * ask2cfg.xml so the settings migration is mechanical — but no form shows
 * them: nothing uses that channel yet.
 */
export function PollDevicesTab() {
  const qc = useQueryClient()

  const { data: devices } = useQuery({ queryKey: DEVICES_KEY, queryFn: pollingApi.getDevices })
  const { data: dpdLines } = useQuery({
    queryKey: ['admin', 'dpd-lines'],
    queryFn: dpdLineAdminApi.getAll,
  })
  const { data: mappings } = useQuery({
    queryKey: ['admin', 'enterprise-mappings'],
    queryFn: enterpriseApi.getMappings,
  })
  const { data: agents } = useQuery({
    queryKey: ['admin', 'poll-agents'],
    queryFn: pollingApi.getAgents,
  })

  const requestPoll = useMutation({
    mutationFn: (d: PollDevice) =>
      d.manual_requested_at ? pollingApi.cancelPoll(d.id) : pollingApi.requestPoll(d.id),
    onSuccess: (res) => {
      notifications.show({
        message: res.requested_at
          ? 'Заявку прийнято — опитають, щойно агент прийде за планом'
          : 'Заявку скасовано',
        color: res.requested_at ? 'teal' : 'gray',
      })
      qc.invalidateQueries({ queryKey: DEVICES_KEY })
    },
    onError: notifyErr,
  })

  const points = useMemo(
    () =>
      (mappings ?? [])
        .map((m) => ({ value: String(m.id), label: m.enterprise_name ?? `#${m.id}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [mappings],
  )

  const agentName = (id: number) =>
    (agents ?? []).find((a) => a.id === id)?.name ?? `#${id}`

  const unassigned = (devices ?? []).filter((d) => d.enabled && d.agent_ids.length === 0)
  const noCorrector = (devices ?? []).filter(
    (d) => d.enabled && d.target_kind === 'enterprise' && d.device_id === null,
  )
  const neverPolled = (devices ?? []).filter((d) => d.enabled && !d.last_poll_at)

  const targetOptions = (form: Record<string, unknown>) => {
    const kind = (form.target_kind as PollTargetKind) ?? 'enterprise'
    if (kind === 'dpd_line') {
      return (dpdLines ?? []).map((l) => ({ value: String(l.id), label: l.name || `#${l.id}` }))
    }
    return points
  }

  return (
    <CrudTable<PollDevice>
      title="Опитування модемом"
      description="Куди дзвонити. Опитує агент на машині оператора — сервер лише зберігає налаштування"
      queryKey={DEVICES_KEY}
      fetchAll={pollingApi.getDevices}
      searchKeys={['target_label', 'phone', 'note']}
      rowLabel={(d) => d.target_label ?? `#${d.id}`}
      create={(v) => {
        const kind = (v.target_kind as PollTargetKind) ?? 'enterprise'
        return pollingApi.createDevice({
          [TARGET_FIELD[kind]]: Number(v.target_id),
          ...pollDevicePayload(v),
          // Belongs to the site, not to the card, but decided here.
          poll_dpd: v.poll_dpd !== false,
          poll_gsm: true,
        })
      }}
      // The target is not editable: repointing a card would silently reassign
      // everything the poll has already written. Delete and create instead,
      // which at least says what is happening.
      update={(id, v) =>
        pollingApi.updateDevice(id, {
          ...pollDevicePayload(v),
          poll_dpd: v.poll_dpd !== false,
          poll_gsm: v.poll_gsm !== false,
        })
      }
      remove={(id) => pollingApi.removeDevice(id)}
      toForm={(d) => ({
        target_kind: d.target_kind,
        target_id: String(d.enterprise_id ?? d.dpd_line_id ?? ''),
        enabled: d.enabled,
        auto_poll: d.auto_poll,
        poll_dpd: d.poll_dpd,
        poll_gsm: d.poll_gsm,
        poll_times: (d.poll_times ?? []).join(', '),
        phone: d.phone ?? '',
        protocol_id: d.protocol_id,
        device_address: d.device_address,
        priority: d.priority,
        depth_days: d.depth_days,
        note: d.note ?? '',
      })}
      notice={
        unassigned.length + noCorrector.length + neverPolled.length > 0 ? (
          <Alert color="amber" variant="light" icon={<IconAlertTriangle size={16} />}>
            {unassigned.length > 0 && (
              <Text size="sm">
                Без агента: {unassigned.length}. Їх не опитує ніхто — прилади
                обираються в налаштуваннях самого агента.
              </Text>
            )}
            {noCorrector.length > 0 && (
              <Text size="sm">
                Без встановленого коректора: {noCorrector.length}. Дзвонити нема
                до чого, поки в історії точки не з’явиться прилад.
              </Text>
            )}
            {neverPolled.length > 0 && (
              <Text size="sm">Жодного разу не опитано: {neverPolled.length}.</Text>
            )}
          </Alert>
        ) : undefined
      }
      fields={[
        {
          key: 'target_kind',
          label: 'Тип об’єкта',
          type: 'select',
          options: KIND_OPTIONS,
          required: true,
          onlyOn: 'create',
          hideInTable: true,
        },
        {
          key: 'target_id',
          label: 'Об’єкт',
          type: 'select',
          optionsFor: targetOptions,
          required: true,
          onlyOn: 'create',
          hideInTable: true,
        },
        {
          key: 'target_label',
          label: 'Об’єкт',
          hideInForm: true,
          render: (d) => (
            <Group gap={6} wrap="nowrap">
              <Text size="sm">{d.target_label ?? `#${d.id}`}</Text>
              <Badge size="xs" variant="light" color="gray">
                {KIND_LABEL[d.target_kind]}
              </Badge>
            </Group>
          ),
        },
        {
          // What the modem expects to find on the other end. A point between
          // correctors has nothing to dial for, and the poll has to say so
          // rather than call and fail.
          key: 'device_ser_num',
          label: 'Коректор зараз',
          hideInForm: true,
          render: (d) =>
            d.target_kind !== 'enterprise' ? (
              <Text size="xs" c="dimmed">
                —
              </Text>
            ) : d.device_ser_num ? (
              <Text size="xs">№{d.device_ser_num}</Text>
            ) : (
              <Badge size="xs" variant="light" color="amber">
                не встановлено
              </Badge>
            ),
        },
        { key: 'phone', label: 'Телефон' },
        {
          // Which Ask2 driver speaks to this device: 1070 Флоутек ВР-2,
          // 1052 КПЛГ, 1054 ВЕГА… To be filled in from the corrector type
          // once the corector_type → gas_vol_calc_type bridge exists.
          key: 'protocol_id',
          label: 'Протокол (ID драйвера)',
          type: 'number',
          numeric: true,
        },
        {
          // Goes into the request frame and is checked in the reply — every
          // driver does this, not only Флоутек. With one device on a line it
          // stays at its default, which is why it looks nominal, but sending
          // the wrong one looks exactly like a dead meter.
          key: 'device_address',
          label: 'Мережева адреса',
          type: 'number',
          numeric: true,
          hideInTable: true,
        },
        {
          key: 'poll_dpd',
          label: 'Читати також через ДПД API',
          hideInTable: true,
          renderField: (value, onChange) => (
            <Switch
              checked={value !== false}
              onChange={(e) => onChange(e.currentTarget.checked)}
              label="Об’єкт є в системі ДПД"
              description="Знято — читається лише модемом, ДПД про нього не питають"
            />
          ),
        },
        {
          key: 'poll_paths',
          label: 'Джерело',
          hideInForm: true,
          render: (d) => (
            <Group gap={4} wrap="nowrap">
              {d.poll_dpd && (
                <Badge size="xs" variant="light" color="gray">
                  ДПД
                </Badge>
              )}
              {d.poll_gsm && (
                <Badge size="xs" variant="light" color="grape">
                  GSM
                </Badge>
              )}
            </Group>
          ),
        },
        {
          key: 'poll_times',
          label: 'Години опитування',
          // Free text rather than a list editor: "06:00, 18:00" is how these
          // are written down, and an empty box means the global hours.
          render: (d) =>
            d.poll_times?.length ? (
              d.poll_times.join(', ')
            ) : (
              <Text size="xs" c="dimmed">
                загальні
              </Text>
            ),
        },
        { key: 'enabled', label: 'Увімкнено', type: 'checkbox' },
        { key: 'auto_poll', label: 'За розкладом', type: 'checkbox' },
        { key: 'priority', label: 'Пріоритет', type: 'number', numeric: true, hideInTable: true },
        {
          // Blank on purpose: a GSM poll has no backfill, so the first call
          // takes everything the corrector still holds.
          key: 'depth_days',
          label: 'Глибина, діб',
          type: 'number',
          numeric: true,
          hideInTable: true,
        },
        { key: 'note', label: 'Примітка', hideInTable: true },
        {
          key: 'agent_ids',
          label: 'Агенти',
          hideInForm: true,
          render: (d) =>
            d.agent_ids.length ? (
              <Text size="xs">{d.agent_ids.map(agentName).join(', ')}</Text>
            ) : (
              <Badge size="xs" variant="light" color="amber">
                нічий
              </Badge>
            ),
        },
        {
          key: 'last_poll_at',
          label: 'Останнє опитування',
          hideInForm: true,
          render: (d) => (
            <Group gap={6} wrap="nowrap">
              {d.last_poll_at ? (
                <Text size="xs">{new Date(d.last_poll_at).toLocaleString()}</Text>
              ) : (
                <Text size="xs" c="dimmed">
                  ніколи
                </Text>
              )}
              {d.last_status === 'error' && (
                <Tooltip label={d.last_error_text ?? d.last_error_code ?? ''} withArrow multiline w={280}>
                  <Badge size="xs" variant="light" color="red">
                    {d.last_error_code ?? 'помилка'}
                  </Badge>
                </Tooltip>
              )}
            </Group>
          ),
        },
      ]}
      extraRowActions={(d) => (
        <Tooltip
          label={
            d.manual_requested_at
              ? 'Заявку вже подано — натисніть, щоб скасувати'
              : 'Опитати позачергово, щойно агент прийде за планом'
          }
          withArrow
        >
          <Button
            size="compact-xs"
            variant={d.manual_requested_at ? 'light' : 'subtle'}
            color={d.manual_requested_at ? 'amber' : undefined}
            leftSection={<IconPlayerPlay size={13} />}
            loading={requestPoll.isPending && requestPoll.variables?.id === d.id}
            onClick={() => requestPoll.mutate(d)}
          >
            {d.manual_requested_at ? 'В черзі' : 'Опитати'}
          </Button>
        </Tooltip>
      )}
    />
  )
}
