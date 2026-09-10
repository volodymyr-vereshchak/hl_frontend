import { useMemo } from 'react'
import {
  Alert,
  Badge,
  Button,
  Group,
  NumberInput,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconPlayerPlay } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dpdLineAdminApi } from '@/api/admin'
import { currentDevice, enterpriseApi } from '@/api/enterprise'
import { pollingApi, type PollDevice, type PollTargetKind } from '@/api/polling'
import { CrudTable } from '../CrudTable'
import { PollTimesField } from '../PollTimesField'
import {
  PRIORITY_OPTIONS,
  phoneError,
  pollDevicePayload,
} from './pollDeviceForm'

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
      // CrudTable starts every checkbox unticked, so without these a card
      // added without touching them was created switched off — and nothing
      // on screen said so.
      createDefaults={{ enabled: true, auto_poll: true, priority: '0' }}
      toForm={(d) => ({
        target_kind: d.target_kind,
        target_id: String(d.dpd_device_id ?? d.dpd_line_id ?? ''),
        // Read-only, but the form needs it to decide whether the address is a
        // question worth asking.
        address_matters: d.address_matters,
        enabled: d.enabled,
        auto_poll: d.auto_poll,
        poll_times: d.poll_times ?? [],
        phone: d.phone ?? '',
        device_address: d.device_address,
        priority: String(d.priority),
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
        {
          key: 'phone',
          label: 'Телефон',
          required: true,
          renderField: (value, onChange) => (
            <TextInput
              value={String(value ?? '')}
              onChange={(e) => onChange(e.currentTarget.value)}
              placeholder="+380XXXXXXXXX"
              error={phoneError(value)}
              description="Український номер; вводиться як завгодно, зберігається як +380…"
            />
          ),
        },
        {
          // Not asked for: it comes from the corrector's model, set once in
          // Типи коректорів. Shown because an empty one means this model has
          // no Ask2 driver at all and the card can never be polled.
          key: 'protocol_id',
          label: 'Драйвер',
          hideInForm: true,
          render: (d) =>
            d.protocol_id == null ? (
              <Tooltip
                label="Для цієї моделі немає драйвера Ask2 — модемом її не опитати"
                withArrow
              >
                <Badge size="xs" variant="light" color="red">
                  немає
                </Badge>
              </Tooltip>
            ) : (
              <Text size="xs">{d.protocol_id}</Text>
            ),
        },
        {
          // Asked for only where it is a real choice: several Floutek
          // correctors share one line and answer on their own addresses.
          // Every other driver sends the address and checks it in the reply
          // too, but it is always 1 there — so the server fills it in, and a
          // box nobody needed to touch cannot collect a typo that reads as a
          // dead meter.
          key: 'device_address',
          label: 'Мережева адреса',
          type: 'number',
          numeric: true,
          hideInTable: true,
          renderField: (value, onChange, form) =>
            form.address_matters ? (
              <NumberInput
                value={typeof value === 'number' ? value : undefined}
                onChange={(next) => onChange(next === '' ? null : Number(next))}
                min={0}
                max={255}
                description="Кілька Флоутеків на одній лінії відповідають за своїми адресами"
              />
            ) : (
              <Text size="xs" c="dimmed">
                Для цього драйвера адреса завжди 1 — задається автоматично
              </Text>
            ),
        },
        {
          key: 'enabled',
          label: 'Картка діє',
          type: 'checkbox',
          render: (d) =>
            d.enabled ? (
              <Text size="xs">так</Text>
            ) : (
              <Badge size="xs" variant="light" color="gray">
                вимкнена
              </Badge>
            ),
        },
        {
          // Two different questions, which is why they are two boxes: a card
          // can be off entirely, or on but polled only when somebody asks.
          // This one comes BEFORE the hours it governs — with it off, the
          // hours mean nothing, and the field below says so by being disabled.
          key: 'auto_poll',
          label: 'Опитувати автоматично',
          type: 'checkbox',
          render: (d) => (
            <Text size="xs" c={d.auto_poll ? undefined : 'dimmed'}>
              {d.auto_poll ? 'за розкладом' : 'лише вручну'}
            </Text>
          ),
        },
        {
          key: 'poll_times',
          label: 'О котрій опитувати',
          renderField: (value, onChange, form) => (
            <PollTimesField
              value={Array.isArray(value) ? (value as string[]) : []}
              onChange={onChange}
              disabled={form.auto_poll === false}
            />
          ),
          render: (d) =>
            !d.auto_poll ? (
              <Text size="xs" c="dimmed">
                —
              </Text>
            ) : d.poll_times?.length ? (
              d.poll_times.join(', ')
            ) : (
              <Text size="xs" c="dimmed">
                загальні
              </Text>
            ),
        },
        {
          // A queue order compared by eye, so a short list rather than a free
          // number: "priority 900" says nothing about where it sits.
          key: 'priority',
          label: 'Пріоритет',
          type: 'select',
          options: PRIORITY_OPTIONS,
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
              <Tooltip
                label="Жоден агент не взяв цей прилад — його ніхто не опитує"
                withArrow
              >
                <Badge size="xs" variant="light" color="amber">
                  не призначено
                </Badge>
              </Tooltip>
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
