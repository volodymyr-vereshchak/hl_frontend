import { useMemo } from 'react'
import { Alert, Badge, Button, Group, Text, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconPlayerPlay } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dpdLineAdminApi } from '@/api/admin'
import { currentDevice, enterpriseApi } from '@/api/enterprise'
import { pollingApi, type PollDevice, type PollTargetKind } from '@/api/polling'
import { CrudTable } from '../CrudTable'
import { pollDevicePayload } from './pollDeviceForm'

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })

const DEVICES_KEY = ['admin', 'poll-devices']

const KIND_OPTIONS = [
  { value: 'dpd_device', label: 'Коректор підприємства' },
  { value: 'dpd_line', label: 'Лінія ДПД' },
]

const KIND_LABEL: Record<PollTargetKind, string> = {
  dpd_device: 'Промисловість',
  dpd_line: 'Лінія ДПД',
}

/** The column the target id lands in, per kind. */
const TARGET_FIELD: Record<PollTargetKind, string> = {
  dpd_device: 'dpd_device_id',
  dpd_line: 'dpd_line_id',
}

/**
 * Опитування модемом — a phone number bound to the corrector it reaches.
 *
 * The serial is the whole point of a card: it is what the modem expects to
 * hear back, and a reply from any other device is refused rather than written.
 * So a replacement is recorded here by repointing the card — same phone, new
 * serial, and the poll follows the new device from that moment. The metering
 * point's own history stays continuous in Підприємства; this screen has no
 * opinion about it.
 *
 * Which is why the list says whether the corrector a card names is still
 * fitted. A replacement entered at the point and not here leaves the modem
 * dialling a device that is gone — and nothing else on any screen would say so.
 *
 * ЛУМГ correctors are not here: Ask2 keeps polling those and writing its
 * hostlib files.
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

  /**
   * The correctors fitted at metering points right now, by serial. Searching
   * by serial is how this list is used: the operator is holding a device with
   * a number on it, not a point name.
   */
  const correctors = useMemo(() => {
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
  const stale = (devices ?? []).filter((d) => d.enabled && !d.still_installed)
  const neverPolled = (devices ?? []).filter((d) => d.enabled && !d.last_poll_at)

  const targetOptions = (form: Record<string, unknown>) => {
    const kind = (form.target_kind as PollTargetKind) ?? 'dpd_device'
    if (kind === 'dpd_line') {
      return (dpdLines ?? []).map((l) => ({ value: String(l.id), label: l.name || `#${l.id}` }))
    }
    return correctors
  }

  return (
    <CrudTable<PollDevice>
      title="Опитування модемом"
      description="Номер телефону і коректор, який має відповісти. Опитує агент на машині оператора"
      queryKey={DEVICES_KEY}
      fetchAll={pollingApi.getDevices}
      searchKeys={['target_label', 'phone', 'note']}
      rowLabel={(d) =>
        [d.ser_num ? `№${d.ser_num}` : `#${d.id}`, d.target_label]
          .filter(Boolean)
          .join(' — ')
      }
      create={(v) => {
        const kind = (v.target_kind as PollTargetKind) ?? 'dpd_device'
        return pollingApi.createDevice({
          [TARGET_FIELD[kind]]: Number(v.target_id),
          ...pollDevicePayload(v),
        })
      }}
      update={(id, v) =>
        pollingApi.updateDevice(id, {
          ...pollDevicePayload(v),
          // Repointing at another serial is how a replacement is recorded —
          // the one foreign key on this screen that is meant to be edited.
          ...(v.target_kind === 'dpd_device' && v.target_id
            ? { dpd_device_id: Number(v.target_id) }
            : {}),
        })
      }
      // Deleting a card stops the modem polling that corrector; it touches
      // neither the point's history nor anything already in the archive.
      remove={(id) => pollingApi.removeDevice(id)}
      toForm={(d) => ({
        target_kind: d.target_kind,
        target_id: String(d.dpd_device_id ?? d.dpd_line_id ?? ''),
        enabled: d.enabled,
        auto_poll: d.auto_poll,
        poll_times: (d.poll_times ?? []).join(', '),
        phone: d.phone ?? '',
        protocol_id: d.protocol_id,
        device_address: d.device_address,
        priority: d.priority,
        depth_days: d.depth_days,
        note: d.note ?? '',
      })}
      notice={
        unassigned.length + stale.length + neverPolled.length > 0 ? (
          <Alert color="amber" variant="light" icon={<IconAlertTriangle size={16} />}>
            {stale.length > 0 && (
              <Text size="sm">
                Коректор знято, а номер не перенесено: {stale.length}. Модем
                дзвонить приладу, якого вже немає — оберіть у картці новий
                серійний номер.
              </Text>
            )}
            {unassigned.length > 0 && (
              <Text size="sm">
                Без агента: {unassigned.length}. Їх не опитує ніхто — прилади
                обираються в налаштуваннях самого агента.
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
          label: 'Тип',
          type: 'select',
          options: KIND_OPTIONS,
          required: true,
          onlyOn: 'create',
          hideInTable: true,
        },
        {
          // Editable on purpose: choosing another serial here IS how a
          // replacement is recorded, and the phone stays with the card.
          key: 'target_id',
          label: 'Коректор (за серійним номером)',
          type: 'select',
          optionsFor: targetOptions,
          required: true,
          hideInTable: true,
        },
        {
          key: 'ser_num',
          label: 'Коректор',
          hideInForm: true,
          render: (d) => (
            <Group gap={6} wrap="nowrap">
              <Text size="sm">{d.ser_num ? `№${d.ser_num}` : '—'}</Text>
              {!d.still_installed && (
                <Tooltip
                  label="Цей коректор уже знято з точки — перенесіть номер на новий"
                  withArrow
                >
                  <Badge size="xs" variant="light" color="red">
                    знято
                  </Badge>
                </Tooltip>
              )}
            </Group>
          ),
        },
        {
          key: 'target_label',
          label: 'Де стоїть',
          hideInForm: true,
          render: (d) => (
            <Group gap={6} wrap="nowrap">
              <Text size="sm">{d.target_label ?? '—'}</Text>
              <Badge size="xs" variant="light" color="gray">
                {KIND_LABEL[d.target_kind]}
              </Badge>
            </Group>
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
