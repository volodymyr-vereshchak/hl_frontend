import { useMemo } from 'react'
import { Alert, Badge, Button, Group, Switch, Text, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconPlayerPlay } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dpdLineAdminApi } from '@/api/admin'
import { currentDevice, enterpriseApi } from '@/api/enterprise'
import { pollingApi, type PollDevice, type PollTargetKind } from '@/api/polling'
import { useAdminTopology } from '../useAdminTopology'
import { CrudTable } from '../CrudTable'
import { pollDevicePayload } from './pollDeviceForm'

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })

const DEVICES_KEY = ['admin', 'poll-devices']

const KIND_OPTIONS = [
  { value: 'calc', label: 'Обчислювач ЛУМГ' },
  { value: 'dpd_line', label: 'Лінія ДПД' },
  { value: 'dpd_device', label: 'Коректор промисловості' },
]

const KIND_LABEL: Record<PollTargetKind, string> = {
  calc: 'ЛУМГ',
  dpd_line: 'ДПД лінія',
  dpd_device: 'Промисловість',
}

/** The column the target id lands in, per kind. */
const TARGET_FIELD: Record<PollTargetKind, string> = {
  calc: 'gas_volume_calc_id',
  dpd_line: 'dpd_line_id',
  dpd_device: 'dpd_device_id',
}

/**
 * Опитування приладів — the card each corrector is dialled by.
 *
 * A corrector is one of three things in this database and never two, so the
 * form picks the kind first and the device second; the payload then carries
 * exactly one target id, which is what the CHECK constraint behind it wants.
 *
 * Two things on this screen are not settings and matter more than the rest:
 * a device nobody has taken is never polled at all, and a device that has
 * never answered has never answered. Both are counted in the notice rather
 * than left to be spotted by scrolling.
 *
 * The adapter and radio fields exist in the API — they were carried over from
 * ask2cfg.xml so the settings migration is mechanical — but no form shows
 * them: nothing uses that channel yet, and thirty controls nobody needs would
 * bury the eight that matter.
 */
export function PollDevicesTab() {
  const qc = useQueryClient()
  const { calcs } = useAdminTopology()

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
          ? 'Заявку прийнято — прилад опитають, щойно агент прийде за планом'
          : 'Заявку скасовано',
        color: res.requested_at ? 'teal' : 'gray',
      })
      qc.invalidateQueries({ queryKey: DEVICES_KEY })
    },
    onError: notifyErr,
  })

  /** Correctors of industry, named by serial: the point they stand at can
   *  change, the device is what gets dialled. */
  const enterpriseDevices = useMemo(() => {
    const out: { value: string; label: string }[] = []
    for (const m of mappings ?? []) {
      const device = currentDevice(m)
      if (!device) continue
      out.push({
        value: String(device.device_id),
        label: `№${device.ser_num} — ${m.enterprise_name ?? ''}`.trim(),
      })
    }
    return out.sort((a, b) => a.label.localeCompare(b.label))
  }, [mappings])

  const agentName = (id: number) =>
    (agents ?? []).find((a) => a.id === id)?.name ?? `#${id}`

  const unassigned = (devices ?? []).filter((d) => d.enabled && d.agent_ids.length === 0)
  const neverPolled = (devices ?? []).filter((d) => d.enabled && !d.last_poll_at)

  const targetOptions = (form: Record<string, unknown>) => {
    const kind = (form.target_kind as PollTargetKind) ?? 'calc'
    if (kind === 'calc') {
      return calcs.map((c) => ({ value: String(c.id), label: c.name || `#${c.id}` }))
    }
    if (kind === 'dpd_line') {
      return (dpdLines ?? []).map((l) => ({ value: String(l.id), label: l.name || `#${l.id}` }))
    }
    return enterpriseDevices
  }

  return (
    <CrudTable<PollDevice>
      title="Опитування приладів"
      description="Як додзвонитися до кожного коректора. Опитує агент на машині оператора — сервер лише зберігає налаштування"
      queryKey={DEVICES_KEY}
      fetchAll={pollingApi.getDevices}
      searchKeys={['target_label', 'phone', 'note']}
      rowLabel={(d) => d.target_label ?? `#${d.id}`}
      create={(v) => {
        const kind = (v.target_kind as PollTargetKind) ?? 'calc'
        return pollingApi.createDevice({
          [TARGET_FIELD[kind]]: Number(v.target_id),
          ...pollDevicePayload(v),
          // Belongs to the corrector, not to the card, and only an enterprise
          // corrector can be absent from DPD at all.
          ...(kind === 'dpd_device' ? { in_dpd: v.in_dpd !== false } : {}),
        })
      }}
      // The target is not editable: moving a card to another corrector would
      // silently re-point everything the poll has already written. Delete and
      // create instead, which at least says what is happening.
      update={(id, v) =>
        pollingApi.updateDevice(id, {
          ...pollDevicePayload(v),
          ...(v.target_kind === 'dpd_device' ? { in_dpd: v.in_dpd !== false } : {}),
        })
      }
      remove={(id) => pollingApi.removeDevice(id)}
      toForm={(d) => ({
        target_kind: d.target_kind,
        target_id: String(
          d.gas_volume_calc_id ?? d.dpd_line_id ?? d.dpd_device_id ?? '',
        ),
        enabled: d.enabled,
        auto_poll: d.auto_poll,
        in_dpd: d.in_dpd ?? true,
        poll_times: (d.poll_times ?? []).join(', '),
        phone: d.phone ?? '',
        protocol_id: d.protocol_id,
        device_address: d.device_address,
        priority: d.priority,
        depth_days: d.depth_days,
        note: d.note ?? '',
      })}
      notice={
        unassigned.length > 0 || neverPolled.length > 0 ? (
          <Alert color="amber" variant="light" icon={<IconAlertTriangle size={16} />}>
            {unassigned.length > 0 && (
              <Text size="sm">
                Приладів без агента: {unassigned.length}. Їх не опитує ніхто —
                прилади обираються в налаштуваннях самого агента.
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
          label: 'Тип цілі',
          type: 'select',
          options: KIND_OPTIONS,
          required: true,
          onlyOn: 'create',
          hideInTable: true,
        },
        {
          key: 'target_id',
          label: 'Прилад',
          type: 'select',
          optionsFor: targetOptions,
          required: true,
          onlyOn: 'create',
          hideInTable: true,
        },
        {
          key: 'target_label',
          label: 'Прилад',
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
        { key: 'phone', label: 'Телефон' },
        {
          // Which Ask2 driver speaks to this device: 1070 Флоутек ВР-2,
          // 1052 КПЛГ, 1054 ВЕГА…
          key: 'protocol_id',
          label: 'Протокол (ID драйвера)',
          type: 'number',
          numeric: true,
        },
        {
          // Goes into the request frame and is checked in the answer — every
          // driver does this, not only Флоутек. For a ЛУМГ corrector it is the
          // number in the hostlib file name, which is our gas_volume_calc.address.
          key: 'device_address',
          label: 'Мережева адреса',
          type: 'number',
          numeric: true,
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
        {
          // A corrector the modem reads and DPD does not serve still needs a
          // row in the register, so without this the DPD refresh would go on
          // asking about it twice a day and getting nothing back.
          key: 'in_dpd',
          label: 'Є в ДПД',
          hideInTable: true,
          renderField: (value, onChange, form) =>
            form.target_kind === 'dpd_device' ? (
              <Switch
                checked={value !== false}
                onChange={(e) => onChange(e.currentTarget.checked)}
                label="Прилад є в системі ДПД"
                description="Знято — опитується лише модемом, ДПД про нього не питають"
              />
            ) : (
              <Text size="xs" c="dimmed">
                Стосується лише коректорів промисловості
              </Text>
            ),
        },
        {
          key: 'dpd_state',
          label: 'ДПД',
          hideInForm: true,
          render: (d) =>
            d.in_dpd === false ? (
              <Badge size="xs" variant="light" color="grape">
                лише GSM
              </Badge>
            ) : (
              <Text size="xs" c="dimmed">
                —
              </Text>
            ),
        },
        { key: 'priority', label: 'Пріоритет', type: 'number', numeric: true, hideInTable: true },
        {
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
