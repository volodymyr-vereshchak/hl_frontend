/**
 * A metering point's corrector history — its own window.
 *
 * A point can accumulate a lot of replacements, and editing them inside the
 * enterprise form meant a wall of narrow inputs squeezed under the name and
 * line selects. Here the history gets the whole width: a band that shows what
 * the windows actually are, and one row per corrector under it.
 *
 * The band is the point of the window. Dates in a table do not show that a
 * removal left five days with no device on the point — the archive will simply
 * have nothing there, and that is worth seeing before saving rather than after
 * the report comes out short.
 */
import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconPlus, IconX } from '@tabler/icons-react'
import { useMutation } from '@tanstack/react-query'
import {
  enterpriseMappingApi,
  type CorectorType,
  type EnterpriseMapping,
  type Manufacturer,
} from '@/api/admin'
import { resolveWindows } from '@/domain/deviceHistory'
import { numericStyle } from '@/theme/theme'
import {
  EMPTY_DEVICE,
  EPOCH_YEAR,
  fmtDate,
  fmtDT,
  pad,
  stamp,
  toDeviceForms,
  toDevicePayload,
  type DeviceForm,
} from './deviceHistoryForm'

/**
 * The editor rows in install order, each with the window it will actually get.
 * The window comes from the shared resolver, not from "the next row's date": a
 * removal later than the next install is ignored by the backend (two devices
 * can never both be in force), and the preview has to say the same thing the
 * archive will do.
 */
function useOrderedDevices(devices: DeviceForm[]) {
  return useMemo(() => {
    const rows = devices.map((d, idx) => ({
      ...d,
      idx,
      installedFrom: d.installed_date
        ? `${d.installed_date}T${pad(d.installed_hour)}:00:00`
        : `${EPOCH_YEAR}-01-01T00:00:00`,
      removedAt: d.removed_date ? `${d.removed_date}T${pad(d.removed_hour)}:00:00` : '',
    }))
    return resolveWindows(rows).map((w) => ({ ...w.entry, boundTo: w.to }))
  }, [devices])
}

type Ordered = ReturnType<typeof useOrderedDevices>

// ── Timeline ────────────────────────────────────────────────────────────────
/**
 * The history as a strip of time. Filled = a corrector was fitted, bare track =
 * nobody was, and the one in force now is the only one at full strength.
 *
 * The strip is proportional, but it cannot start where a «від початку» device
 * does: anchoring at the year 2000 would squash every real replacement into a
 * sliver at the right edge. Such a device instead starts at the left edge and
 * fades out of it, meaning "and further back".
 */
function DeviceHistoryTimeline({ ordered }: { ordered: Ordered }) {
  const band = useMemo(() => {
    if (ordered.length === 0) return null
    const now = Date.now()
    const wins = ordered.map((d) => ({
      serial: d.ser_num,
      openStart: !d.installed_date,
      from: new Date(d.installedFrom).getTime(),
      to: d.boundTo ? new Date(d.boundTo).getTime() : null,
      label: `${d.installed_date ? `з ${d.installed_date} ${pad(d.installed_hour)}:00` : 'від початку'} ${
        d.boundTo ? `до ${fmtDT(d.boundTo)}` : '— дотепер'
      }`,
    }))

    const end = Math.max(now, ...wins.map((w) => w.to ?? now))
    const realStarts = wins.filter((w) => !w.openStart).map((w) => w.from)
    // No real install date anywhere — one device standing since forever. A
    // year of track is enough to render it; there is nothing to compare against.
    const first = realStarts.length ? Math.min(...realStarts) : end - 365 * 864e5
    const start = first - Math.max((end - first) * 0.3, 7 * 864e5)
    const span = end - start || 1

    const pct = (t: number) => Math.min(100, Math.max(0, ((t - start) / span) * 100))
    return {
      start,
      end,
      segments: wins.map((w) => {
        const left = pct(w.from)
        return { ...w, left, width: Math.max(1.5, pct(w.to ?? end) - left) }
      }),
    }
  }, [ordered])

  if (!band) return null

  return (
    <Box mb="sm">
      <Box
        style={{
          position: 'relative',
          height: 30,
          borderRadius: 6,
          overflow: 'hidden',
          border: '1px solid var(--hlv-border)',
          // Bare track = no corrector on the point. Hatched rather than plain,
          // so a gap between two windows reads as an absence, not a gap in ink.
          background:
            'repeating-linear-gradient(45deg, var(--hlv-surface-2) 0 6px, transparent 6px 12px)',
        }}
      >
        {band.segments.map((s, i) => (
          <Tooltip key={i} label={`№${s.serial || '—'} · ${s.label}`} withArrow>
            <Box
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${s.left}%`,
                width: `${s.width}%`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                // In force now → full strength; anything past is muted. The
                // colour carries "which one is live", so nothing else has to.
                background:
                  s.to === null
                    ? 'var(--mantine-color-petrol-6)'
                    : 'color-mix(in srgb, var(--mantine-color-petrol-6) 42%, transparent)',
                // A device standing «від початку» runs off the left edge.
                maskImage: s.openStart
                  ? 'linear-gradient(to right, transparent 0, black 26px)'
                  : undefined,
              }}
            >
              {s.width > 11 && (
                <Text size="10px" c={s.to === null ? 'white' : undefined} style={numericStyle}>
                  №{s.serial || '—'}
                </Text>
              )}
            </Box>
          </Tooltip>
        ))}
      </Box>
      <Group justify="space-between" mt={2}>
        <Text size="10px" c="dimmed">
          {band.segments[0]?.openStart ? 'від початку' : fmtDate(new Date(band.start))}
        </Text>
        <Text size="10px" c="dimmed">
          нині
        </Text>
      </Group>
    </Box>
  )
}

// ── Editor rows ─────────────────────────────────────────────────────────────
interface RowsProps {
  devices: DeviceForm[]
  onChange: (devices: DeviceForm[]) => void
  manufacturers: Manufacturer[] | undefined
  corectorTypes: CorectorType[] | undefined
  /** The band only makes sense once replacements exist. */
  withTimeline?: boolean
}

export function DeviceHistoryEditor({
  devices,
  onChange,
  manufacturers,
  corectorTypes,
  withTimeline = true,
}: RowsProps) {
  const ordered = useOrderedDevices(devices)

  const manufacturerOptions = useMemo(
    () =>
      (manufacturers ?? [])
        .map((m) => ({ value: String(m.id), label: m.short_name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [manufacturers],
  )
  const hourOptions = useMemo(
    () => Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${pad(h)}:00` })),
    [],
  )
  const ctsForMfr = (mfrId: string | null) =>
    (corectorTypes ?? []).filter((c) => String(c.manufacturer_id) === mfrId)

  const setDevice = (idx: number, patch: Partial<DeviceForm>) =>
    onChange(
      devices.map((d, i) =>
        i !== idx
          ? d
          : // Switching manufacturer invalidates the model choice.
            {
              ...d,
              ...patch,
              ...(patch.manufacturer_id !== undefined ? { corector_type_id: null } : {}),
            },
      ),
    )

  return (
    <Box>
      {withTimeline && ordered.length > 1 && <DeviceHistoryTimeline ordered={ordered} />}

      <Stack gap={6}>
        {ordered.map((dev, order) => {
          const from = dev.installed_date
            ? `з ${dev.installed_date} ${pad(dev.installed_hour)}:00`
            : 'від початку'
          const to = dev.boundTo ? `до ${fmtDT(dev.boundTo)}` : '— дотепер'
          // A window that closes before the next device arrives is a stretch
          // with nothing fitted — worth saying out loud, since the point will
          // simply have no data for it.
          const next = ordered[order + 1]
          const gap = !!(dev.boundTo && next && dev.boundTo < next.installedFrom)
          return (
            <Group
              key={dev.idx}
              gap="xs"
              align="flex-end"
              wrap="wrap"
              p="xs"
              style={{
                background: 'var(--hlv-surface-2)',
                border: '1px solid var(--hlv-border)',
                borderRadius: 8,
              }}
            >
              <Text size="xs" c="petrol" w={16} ta="center" pb={6}>
                {order + 1}.
              </Text>
              <NumberInput
                label="Серійний №"
                size="xs"
                w={110}
                hideControls
                value={dev.ser_num}
                onChange={(v) => setDevice(dev.idx, { ser_num: v === '' ? '' : String(v) })}
              />
              <Select
                label="Виробник"
                size="xs"
                w={140}
                data={manufacturerOptions}
                value={dev.manufacturer_id}
                onChange={(v) => setDevice(dev.idx, { manufacturer_id: v })}
                searchable
              />
              <Select
                label="Модель коректора"
                size="xs"
                w={160}
                data={ctsForMfr(dev.manufacturer_id).map((c) => ({
                  value: String(c.id),
                  label: c.model_name,
                }))}
                value={dev.corector_type_id}
                onChange={(v) => setDevice(dev.idx, { corector_type_id: v })}
                disabled={!dev.manufacturer_id}
                searchable
              />
              <NumberInput
                label="Канал"
                size="xs"
                w={70}
                min={0}
                max={9}
                value={dev.ch_num}
                onChange={(v) => setDevice(dev.idx, { ch_num: Number(v) || 0 })}
              />
              <DatePickerInput
                label="Встановлено"
                size="xs"
                w={130}
                valueFormat="DD.MM.YYYY"
                placeholder="від початку"
                clearable
                value={dev.installed_date || null}
                onChange={(v) => setDevice(dev.idx, { installed_date: v ?? '' })}
              />
              <Select
                label="Година"
                size="xs"
                w={85}
                data={hourOptions}
                value={String(dev.installed_hour)}
                onChange={(v) => setDevice(dev.idx, { installed_hour: Number(v) })}
                disabled={!dev.installed_date}
              />
              <DatePickerInput
                label="Знято"
                size="xs"
                w={130}
                valueFormat="DD.MM.YYYY"
                placeholder="—"
                clearable
                value={dev.removed_date || null}
                onChange={(v) => setDevice(dev.idx, { removed_date: v ?? '' })}
              />
              <Select
                label="Година"
                size="xs"
                w={85}
                data={hourOptions}
                value={String(dev.removed_hour)}
                onChange={(v) => setDevice(dev.idx, { removed_hour: Number(v) })}
                disabled={!dev.removed_date}
              />
              <Text
                size="10px"
                c={gap ? 'amber.6' : 'dimmed'}
                style={{ flex: 1, minWidth: 140 }}
                pb={8}
              >
                {from} {to}
                {gap && ' · далі без приладу'}
              </Text>
              <ActionIcon
                variant="subtle"
                color="red"
                mb={4}
                onClick={() => onChange(devices.filter((_, i) => i !== dev.idx))}
              >
                <IconX size={15} />
              </ActionIcon>
            </Group>
          )
        })}
      </Stack>

      <Button
        size="compact-xs"
        variant="light"
        mt="xs"
        leftSection={<IconPlus size={13} />}
        onClick={() => onChange([...devices, { ...EMPTY_DEVICE }])}
      >
        Додати прилад
      </Button>
    </Box>
  )
}

// ── Modal ───────────────────────────────────────────────────────────────────
interface ModalProps {
  /** null closes the window; the point is remounted on every open, so the
   * editor always starts from what is actually saved. */
  enterprise: EnterpriseMapping | null
  onClose: () => void
  onSaved: () => void
  manufacturers: Manufacturer[] | undefined
  corectorTypes: CorectorType[] | undefined
}

export function DeviceHistoryModal({
  enterprise,
  onClose,
  onSaved,
  manufacturers,
  corectorTypes,
}: ModalProps) {
  return (
    <Modal
      opened={enterprise !== null}
      onClose={onClose}
      size="90rem"
      title={
        <Group gap="xs">
          <Text fw={600}>Історія приладів</Text>
          <Text c="dimmed">·</Text>
          <Text>{enterprise?.enterprise_name}</Text>
        </Group>
      }
    >
      {enterprise && (
        <HistoryBody
          key={enterprise.id}
          enterprise={enterprise}
          onClose={onClose}
          onSaved={onSaved}
          manufacturers={manufacturers}
          corectorTypes={corectorTypes}
        />
      )}
    </Modal>
  )
}

function HistoryBody({
  enterprise,
  onClose,
  onSaved,
  manufacturers,
  corectorTypes,
}: ModalProps & { enterprise: EnterpriseMapping }) {
  const [devices, setDevices] = useState<DeviceForm[]>(() =>
    toDeviceForms(enterprise.devices, corectorTypes),
  )

  const save = useMutation({
    // Only `devices` is sent: a PATCH without the other fields leaves the
    // point's name, line and flags exactly as the main form left them.
    mutationFn: () =>
      enterpriseMappingApi.update(enterprise.id, { devices: toDevicePayload(devices) }),
    onSuccess: () => {
      notifications.show({ message: 'Історію збережено', color: 'teal' })
      onSaved()
      onClose()
    },
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red' }),
  })

  const submit = () => {
    if (devices.length === 0) {
      notifications.show({ message: 'Додайте хоча б один прилад', color: 'red' })
      return
    }
    if (devices.some((d) => !d.ser_num)) {
      notifications.show({ message: 'Заповніть серійний номер кожного приладу', color: 'red' })
      return
    }
    // Two devices installed at the same moment cannot both be in force; the
    // backend rejects it, but saying so here costs nothing.
    const moments = devices.map((d) => stamp(d.installed_date, d.installed_hour))
    if (new Set(moments).size !== moments.length) {
      notifications.show({
        message: 'Два прилади встановлено в один і той самий момент',
        color: 'red',
      })
      return
    }
    save.mutate()
  }

  return (
    <Stack gap="sm">
      <Alert
        variant="light"
        color="gray"
        icon={<IconAlertTriangle size={16} />}
        p="xs"
        styles={{ message: { fontSize: 12 } }}
      >
        Кожен прилад діє від своєї дати встановлення до наступної. Порожня дата — прилад стоїть від
        початку. «Знято» заповнюють лише тоді, коли прилад зняли раніше, ніж поставили наступний: за
        ці дні даних по точці не буде. Архів залишається за приладом, тож зміна дат лише переставляє
        межі — переопитувати ДПД не потрібно
      </Alert>

      <DeviceHistoryEditor
        devices={devices}
        onChange={setDevices}
        manufacturers={manufacturers}
        corectorTypes={corectorTypes}
      />

      <Group gap="sm" justify="flex-end">
        <Button size="xs" variant="default" onClick={onClose}>
          Скасувати
        </Button>
        <Button size="xs" onClick={submit} loading={save.isPending}>
          Зберегти історію
        </Button>
      </Group>
    </Stack>
  )
}
