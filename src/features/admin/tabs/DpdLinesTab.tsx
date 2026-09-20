import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Box,
  Button,
  Center,
  Fieldset,
  Group,
  Input,
  Modal,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { IconPhone } from '@tabler/icons-react'
import { DatePickerInput } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { PRESSURE_UNIT_DEFAULT, UNIT_LABELS } from '@/domain/pressureUnits'
import {
  IconAlertTriangle,
  IconCheck,
  IconPencil,
  IconPlayerPlay,
  IconPlus,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deviceCatalogApi, dpdLineAdminApi, type DpdJobStatus } from '@/api/admin'
import { pollingApi, type PollDevice } from '@/api/polling'
import { CheckboxFilter } from '@/components/CheckboxFilter'
import { PollCronField } from '../PollCronField'
import { phoneError } from './pollDeviceForm'
import type { DpdLine } from '@/types'
import { invalidateTopology } from '@/lib/invalidateTopology'
import { numericStyle } from '@/theme/theme'
import { useAdminTopology, toOptions } from '../useAdminTopology'
import { useAdminNavigation } from '../adminNavigation'
import { LoadingState } from '@/components/LoadingState'
import { AdminTabHeader } from '../AdminTableShell'

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })
const pad = (n: number) => String(n).padStart(2, '0')

const fmtDT = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface DeviceForm {
  ser_num: string
  manufacturer_id: string | null
  corector_type_id: string | null
  ch_num: number
  installed_date: string
  installed_hour: number
}

const EMPTY_DEVICE: DeviceForm = {
  ser_num: '',
  manufacturer_id: null,
  corector_type_id: null,
  ch_num: 0,
  installed_date: '',
  installed_hour: 7,
}

interface FormState {
  name: string
  description: string
  branch_id: string | null
  lumg_id: string | null
  /** Which unit the line's pressure is READ in; the archive converts to it. */
  pressure_unit: string
  devices: DeviceForm[]
  /** The modem at the line. A ДПД line can have one of its own, and it is set
   *  up here for the same reason it is set up on an enterprise card: the
   *  number belongs to the thing being metered, not to the machine dialling. */
  gsm_phone: string
  gsm_password: string
  gsm_agent_ids: string[]
  gsm_auto_poll: boolean
  gsm_poll_cron: string
}

const EMPTY: FormState = {
  name: '',
  description: '',
  branch_id: null,
  lumg_id: null,
  pressure_unit: PRESSURE_UNIT_DEFAULT,
  devices: [],
  gsm_phone: '',
  gsm_password: '11',
  gsm_agent_ids: [],
  gsm_auto_poll: false,
  gsm_poll_cron: '',
}

/**
 * ДПД-лінії. A DPD line has no calculator — it is a chain of correctors, each in
 * force from its own install moment until the next one is installed. That
 * history is the point of this screen: it is what lets a replaced corrector keep
 * one continuous archive, and changing it requires re-initialising the line.
 */
export function DpdLinesTab() {
  const qc = useQueryClient()
  const { branches, lumgs, lumgName, branchName } = useAdminTopology()

  const { data: lines, isLoading } = useQuery({
    queryKey: ['admin', 'dpd-lines'],
    queryFn: dpdLineAdminApi.getAll,
  })
  const { data: manufacturers } = useQuery({
    queryKey: ['admin', 'manufacturers'],
    queryFn: deviceCatalogApi.manufacturers,
  })
  const { data: corectorTypes } = useQuery({
    queryKey: ['admin', 'corrector-types'],
    queryFn: deviceCatalogApi.correctorTypes,
  })

  const [form, setForm] = useState<FormState>(EMPTY)
  const [editId, setEditId] = useState<number | null>(null)
  // The editor is a window over the list rather than a panel above it: a line
  // is a name, a branch, a modem and a history of correctors, and reading that
  // form while the table it belongs to scrolls underneath never worked.
  const [editing, setEditing] = useState(false)
  const [branchFilter, setBranchFilter] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Record<number, DpdJobStatus>>({})
  const timers = useRef<Record<number, ReturnType<typeof setInterval>>>({})

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'dpd-lines'] })
    // The modem is saved in the same form as the line, and that same save is
    // what creates or drops the poll card behind the «подзвонити» button. Its
    // list is cached, so without this the button kept the state it had before
    // the number was typed — or stayed lit for a number that had just been
    // cleared — until the cache aged out on its own.
    qc.invalidateQueries({ queryKey: ['admin', 'poll-devices'] })
    // ДПД lines appear in every tree and report — refresh those names too.
    invalidateTopology(qc)
  }

  // ── Init job polling ──────────────────────────────────────────────────────
  const startPolling = (lineId: number) => {
    if (timers.current[lineId]) return
    timers.current[lineId] = setInterval(async () => {
      const st = await dpdLineAdminApi.initStatus(lineId).catch(() => null)
      if (!st) return
      setJobs((prev) => ({ ...prev, [lineId]: st }))
      if (st.status !== 'running') {
        clearInterval(timers.current[lineId])
        delete timers.current[lineId]
        invalidate()
      }
    }, 2000)
  }

  // Pick up jobs that were already running when the tab opened.
  useEffect(() => {
    if (!lines) return
    let cancelled = false
    ;(async () => {
      for (const line of lines) {
        const st = await dpdLineAdminApi.initStatus(line.id).catch(() => null)
        if (cancelled || !st) continue
        setJobs((prev) => ({ ...prev, [line.id]: st }))
        if (st.status === 'running') startPolling(line.id)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines?.length])

  const captured = timers.current
  useEffect(() => () => Object.values(captured).forEach(clearInterval), [captured])

  // ── Mutations ─────────────────────────────────────────────────────────────
  const save = useMutation({
    mutationFn: (payload: Partial<DpdLine>) =>
      editId ? dpdLineAdminApi.update(editId, payload) : dpdLineAdminApi.create(payload),
    onSuccess: () => {
      notifications.show({
        message: editId
          ? 'Оновлено. Якщо змінилися прилади чи дати — виконайте повторну ініціалізацію'
          : 'Лінію створено — виконайте ініціалізацію, щоб завантажити архіви',
        color: 'teal',
      })
      reset()
      invalidate()
    },
    onError: notifyErr,
  })

  const remove = useMutation({
    mutationFn: (id: number) => dpdLineAdminApi.remove(id),
    onSuccess: () => {
      notifications.show({ message: 'Видалено', color: 'teal' })
      invalidate()
    },
    onError: notifyErr,
  })

  const toggleFlag = useMutation({
    mutationFn: ({ line, field }: { line: DpdLine; field: keyof DpdLine }) =>
      dpdLineAdminApi.update(line.id, {
        name: line.name,
        description: line.description,
        branch_id: line.branch_id,
        lumg_id: line.lumg_id,
        active: line.active,
        include_in_trends: line.include_in_trends,
        include_in_report: line.include_in_report,
        devices: line.devices ?? [],
        [field]: !line[field],
      }),
    onSuccess: invalidate,
    onError: notifyErr,
  })

  const reset = () => {
    setForm(EMPTY)
    setEditId(null)
    setEditing(false)
  }

  const startCreate = () => {
    setForm(EMPTY)
    setEditId(null)
    setEditing(true)
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const branchLumgs = useMemo(
    () => (form.branch_id ? lumgs.filter((l) => String(l.branch_id) === form.branch_id) : lumgs),
    [lumgs, form.branch_id],
  )
  const mfrOfCt = useMemo(() => {
    const m = new Map((corectorTypes ?? []).map((c) => [c.id, c.manufacturer_id]))
    return (id: number) => m.get(id)
  }, [corectorTypes])
  const ctById = useMemo(
    () => new Map((corectorTypes ?? []).map((c) => [c.id, c])),
    [corectorTypes],
  )
  const ctsForMfr = (mfrId: string | null) =>
    (corectorTypes ?? []).filter((c) => String(c.manufacturer_id) === mfrId)

  // Windows follow install order, so the editor sorts by install moment.
  const orderedDevices = useMemo(
    () =>
      form.devices
        .map((d, idx) => ({ ...d, idx }))
        .sort((a, b) =>
          `${a.installed_date}${pad(a.installed_hour)}` < `${b.installed_date}${pad(b.installed_hour)}`
            ? -1
            : 1,
        ),
    [form.devices],
  )

  const setDevice = (idx: number, patch: Partial<DeviceForm>) =>
    setForm((f) => ({
      ...f,
      devices: f.devices.map((d, i) =>
        i !== idx
          ? d
          : // Switching manufacturer invalidates the model choice.
            { ...d, ...patch, ...(patch.manufacturer_id !== undefined ? { corector_type_id: null } : {}) },
      ),
    }))

  //: The poll cards, to find the one that belongs to a line: asking for a
  //: call needs the card, and the line only knows it has a modem.
  const { data: pollCards } = useQuery({
    queryKey: ['admin', 'poll-devices'],
    queryFn: pollingApi.getDevices,
    staleTime: 15_000,
  })
  const cardOfLine = useMemo(() => {
    const m = new Map<number, PollDevice>()
    for (const card of pollCards ?? []) {
      if (card.dpd_line_id != null) m.set(card.dpd_line_id, card)
    }
    return m
  }, [pollCards])

  const askPoll = useMutation({
    // Asked for by line, not by card. The card is an implementation detail of
    // the poll screen, and the one moment somebody presses this button is the
    // moment right after saving a number — when the card exists on the server
    // but may not have reached this tab yet. So it is looked up, and fetched
    // if the cache has not caught up.
    mutationFn: async (lineId: number) => {
      let card = cardOfLine.get(lineId)
      if (!card) {
        const fresh = await qc.fetchQuery({
          queryKey: ['admin', 'poll-devices'],
          queryFn: pollingApi.getDevices,
        })
        card = fresh.find((c) => c.dpd_line_id === lineId)
      }
      if (!card) {
        throw new Error('Для цієї лінії ще немає картки опитування — збережіть номер модема')
      }
      return pollingApi.requestPoll(card.id)
    },
    onSuccess: () => {
      // 202, not "done": the modem is on somebody else's machine and the
      // request is picked up when that agent next asks for its plan.
      notifications.show({
        message: 'Запит прийнято — агент подзвонить, щойно візьме завдання',
        color: 'teal',
      })
      qc.invalidateQueries({ queryKey: ['admin', 'poll-devices'] })
    },
    onError: notifyErr,
  })

  //: The machines that could dial this line, named rather than numbered: this
  //: is a setting, and "2 / 5" does not say which of them calls.
  const { data: agents } = useQuery({
    queryKey: ['admin', 'poll-agents'],
    queryFn: pollingApi.getAgents,
    staleTime: 60_000,
  })
  const agentOptions = useMemo(
    () => (agents ?? []).map((a) => ({ value: String(a.id), label: a.name })),
    [agents],
  )

  //: A password is asked for only where it is asked of the corrector: the
  //: ПК-В dialect of a Флоутек ТМ-2. Every other family ignores it.
  const speaksPkv = useMemo(
    () =>
      form.devices.some((d) => {
        const model = ctById.get(Number(d.corector_type_id))?.model_name ?? ''
        return /ФЛОУТЕК-ТМ-2|FLOUTEK-TM-2|ПК-В/i.test(model)
      }),
    [form.devices, ctById],
  )

  const startEdit = (line: DpdLine) => {
    setEditId(line.id)
    setEditing(true)
    setForm({
      name: line.name,
      description: line.description ?? '',
      branch_id: line.branch_id != null ? String(line.branch_id) : null,
      lumg_id: line.lumg_id != null ? String(line.lumg_id) : null,
      pressure_unit: line.pressure_unit || PRESSURE_UNIT_DEFAULT,
      gsm_phone: line.gsm?.phone ?? '',
      gsm_password: line.gsm?.password || '11',
      gsm_agent_ids: (line.gsm?.agent_ids ?? []).map(String),
      gsm_auto_poll: line.gsm?.auto_poll ?? false,
      gsm_poll_cron: line.gsm?.poll_cron ?? '',
      devices: (line.devices ?? []).map((d) => ({
        ser_num: String(d.ser_num),
        manufacturer_id: String(mfrOfCt(d.corector_type_id) ?? ''),
        corector_type_id: String(d.corector_type_id),
        ch_num: d.ch_num,
        installed_date: d.installed_from.slice(0, 10),
        installed_hour: new Date(d.installed_from).getHours(),
      })),
    })
  }

  // Arrived from the GSM monitor, having clicked a line's name. The list is
  // fetched asynchronously, so this waits for the row instead of giving up on
  // it, and clears the request once taken — otherwise the window would reopen
  // every time the tab is visited afterwards.
  const pendingId = useAdminNavigation((s) => s.dpdLineId)
  const navigationTaken = useAdminNavigation((s) => s.taken)
  useEffect(() => {
    if (pendingId == null) return
    const row = (lines ?? []).find((l) => l.id === pendingId)
    if (!row) return
    startEdit(row)
    navigationTaken()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingId, lines])

  const submit = () => {
    if (!form.name || !form.branch_id) {
      notifications.show({ message: 'Заповніть назву та філію', color: 'red' })
      return
    }
    for (const d of form.devices) {
      if (!d.ser_num || !d.corector_type_id || !d.installed_date) {
        notifications.show({
          message: 'Заповніть серійний номер, модель і дату встановлення кожного приладу',
          color: 'red',
        })
        return
      }
    }
    const existing = editId ? lines?.find((l) => l.id === editId) : null
    save.mutate({
      name: form.name,
      description: form.description || null,
      branch_id: Number(form.branch_id),
      lumg_id: form.lumg_id ? Number(form.lumg_id) : null,
      pressure_unit: form.pressure_unit,
      gsm: {
        phone: form.gsm_phone.trim() || null,
        password: form.gsm_password.trim() || '11',
        agent_ids: form.gsm_agent_ids.map(Number),
        auto_poll: form.gsm_auto_poll,
        poll_cron: form.gsm_poll_cron.trim() || null,
      },
      active: existing ? existing.active : true,
      include_in_trends: existing ? existing.include_in_trends : false,
      include_in_report: existing ? existing.include_in_report : false,
      devices: form.devices.map((d) => ({
        ser_num: Number(d.ser_num),
        corector_type_id: Number(d.corector_type_id),
        ch_num: Number(d.ch_num) || 0,
        installed_from: `${d.installed_date}T${pad(d.installed_hour)}:00:00`,
      })),
    })
  }

  const runInit = (line: DpdLine) =>
    modals.openConfirmModal({
      title: 'Ініціалізація лінії',
      children: (
        <Text size="sm">
          Архіви лінії «{line.name}» буде <b>повністю очищено</b> і перечитано з ДПД по всій історії
          приладів. Продовжити?
        </Text>
      ),
      labels: { confirm: 'Ініціалізувати', cancel: 'Скасувати' },
      confirmProps: { color: 'amber' },
      onConfirm: async () => {
        try {
          await dpdLineAdminApi.init(line.id)
          setJobs((p) => ({ ...p, [line.id]: { status: 'running', kind: 'init' } }))
          startPolling(line.id)
        } catch (e) {
          notifyErr(e as Error)
        }
      },
    })

  const visibleLines = useMemo(
    () => (lines ?? []).filter((l) => !branchFilter || String(l.branch_id) === branchFilter),
    [lines, branchFilter],
  )

  const renderJob = (lineId: number) => {
    const job = jobs[lineId]
    if (!job || job.status === 'idle') return null
    if (job.status === 'running') {
      const pct = job.progress_total
        ? Math.round(((job.progress_done ?? 0) / job.progress_total) * 100)
        : null
      return (
        <Box w={110}>
          <Text size="10px" c="amber.5">
            {job.kind === 'init' ? 'Ініціалізація' : 'Оновлення'}
            {pct !== null ? ` ${pct}%` : '…'}
          </Text>
          <Progress value={pct ?? 100} size="xs" color="amber" animated mt={2} />
        </Box>
      )
    }
    if (job.status === 'error') {
      return (
        <Tooltip label={job.error ?? ''} withArrow multiline w={280}>
          <Group gap={4} c="red.5">
            <IconAlertTriangle size={13} />
            <Text size="10px">Помилка</Text>
          </Group>
        </Tooltip>
      )
    }
    return (
      <Group gap={4} c="teal.5">
        <IconCheck size={13} />
        <Text size="10px">{fmtDT(job.finished_at)}</Text>
      </Group>
    )
  }

  return (
    <Stack gap="md">
      <AdminTabHeader
        title="Лінії ДПД"
        description={
          <>
            Дані читаються з API ДПД по серійних номерах приладів. Кожен прилад діє від своєї дати встановлення до встановлення наступного
          </>
        }
      />

      <Modal
        opened={editing}
        onClose={reset}
        title={editId ? `Лінія ДПД — ${form.name || '—'}` : 'Нова лінія ДПД'}
        size="xl"
      >
        <Stack gap="sm">
          <Group gap="sm" align="flex-end" wrap="wrap">
            <TextInput
              label="Назва"
              size="xs"
              w={220}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
              required
            />
            <TextInput
              label="Опис"
              size="xs"
              style={{ flex: 1, minWidth: 200 }}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.currentTarget.value })}
              placeholder="Необов'язково"
            />
            <Select
              label="Філія"
              size="xs"
              w={200}
              data={toOptions(branches)}
              value={form.branch_id}
              onChange={(v) => setForm({ ...form, branch_id: v, lumg_id: null })}
              searchable
              required
            />
            <Select
              label="ЛУМГ"
              size="xs"
              w={200}
              data={toOptions(branchLumgs)}
              value={form.lumg_id}
              onChange={(v) => setForm({ ...form, lumg_id: v })}
              searchable
              clearable
            />
            {/* Кожен запис архіву несе ту одиницю, яку назвав його коректор, —
                по парку це і МПа, і кгс/см². Тут задається та, в якій лінію
                читають; архів переводить у неї. */}
            <Select
              label="Од. тиску"
              size="xs"
              w={130}
              data={UNIT_LABELS}
              value={form.pressure_unit}
              onChange={(v) => setForm({ ...form, pressure_unit: v || PRESSURE_UNIT_DEFAULT })}
              allowDeselect={false}
            />
          </Group>

          {/* The modem, framed as one thing, exactly as on an enterprise
              card: a ДПД line can carry its own, and setting it up in two
              places would mean the second is the one somebody forgets. */}
          <Fieldset
            legend={
              <Group gap={6} wrap="nowrap">
                <IconPhone size={14} />
                <Text size="sm" fw={600}>
                  GSM-модем
                </Text>
              </Group>
            }
            radius="md"
            p="sm"
          >
            <Group gap="sm" align="flex-start" wrap="wrap">
              <TextInput
                label="Телефон модема"
                size="xs"
                w={220}
                value={form.gsm_phone}
                onChange={(e) => setForm({ ...form, gsm_phone: e.currentTarget.value })}
                placeholder="+380XXXXXXXXX"
                // Caught here as well as on the server: a number saved as
                // "050…" looks right on the screen and fails every night with
                // "no dialtone", which reads exactly like a dead line.
                error={phoneError(form.gsm_phone)}
                description="Порожньо — модема немає, лінію не дзвонимо"
              />
              {speaksPkv && (
                <TextInput
                  label="Пароль приладу"
                  size="xs"
                  w={130}
                  value={form.gsm_password}
                  onChange={(e) => setForm({ ...form, gsm_password: e.currentTarget.value })}
                  description="ПК-В (Флоутек ТМ-2); типово 11"
                  maxLength={14}
                  disabled={!form.gsm_phone.trim()}
                />
              )}
              <Switch
                size="xs"
                label="Опитувати за графіком"
                checked={form.gsm_auto_poll}
                onChange={(e) => setForm({ ...form, gsm_auto_poll: e.currentTarget.checked })}
                disabled={!form.gsm_phone.trim()}
                mt={22}
              />
              <PollCronField
                value={form.gsm_poll_cron}
                onChange={(next) => setForm({ ...form, gsm_poll_cron: next })}
                disabled={!form.gsm_auto_poll || !form.gsm_phone.trim()}
              />
              <Input.Wrapper
                label="Хто дзвонить"
                size="xs"
                description={
                  form.gsm_agent_ids.length > 1
                    ? 'Спільна черга: хто перший звільниться, той і подзвонить'
                    : 'Машина з модемом, якій доручено цю лінію'
                }
                // Not a warning about typing: a number with no machine behind
                // it is a line that is never polled and looks, everywhere
                // else, set up.
                error={
                  !!form.gsm_phone.trim() && form.gsm_agent_ids.length === 0
                    ? 'Нікому не доручено — лінія не опитуватиметься'
                    : undefined
                }
              >
                <div>
                  <CheckboxFilter
                    label="Агенти"
                    options={agentOptions}
                    value={form.gsm_agent_ids}
                    onChange={(ids) => setForm({ ...form, gsm_agent_ids: ids })}
                    disabled={!form.gsm_phone.trim()}
                    emptyLabel="нікому"
                    summary={(picked) =>
                      picked.length <= 2
                        ? picked.map((o) => o.label).join(', ')
                        : `${picked.length} з ${agentOptions.length}`
                    }
                    error={!!form.gsm_phone.trim() && form.gsm_agent_ids.length === 0}
                    width={260}
                  />
                </div>
              </Input.Wrapper>
            </Group>
          </Fieldset>

          <Box>
            <Text size="xs" fw={500}>
              Історія приладів
            </Text>
            <Text size="10px" c="dimmed" mb={6}>
              Кожен прилад діє від своєї дати встановлення до встановлення наступного
            </Text>

            <Stack gap={6}>
              {orderedDevices.length === 0 && (
                <Text size="xs" c="dimmed">
                  Немає приладів — додайте перший
                </Text>
              )}
              {orderedDevices.map((dev, order) => {
                const next = orderedDevices[order + 1]
                const window = dev.installed_date
                  ? `з ${dev.installed_date} ${pad(dev.installed_hour)}:00 ` +
                    (next?.installed_date
                      ? `до ${next.installed_date} ${pad(next.installed_hour)}:00`
                      : '— дотепер')
                  : ''
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
                      w={120}
                      hideControls
                      value={dev.ser_num}
                      onChange={(v) => setDevice(dev.idx, { ser_num: v === '' ? '' : String(v) })}
                    />
                    <Select
                      label="Виробник"
                      size="xs"
                      w={150}
                      data={(manufacturers ?? []).map((m) => ({
                        value: String(m.id),
                        label: m.short_name,
                      }))}
                      value={dev.manufacturer_id}
                      onChange={(v) => setDevice(dev.idx, { manufacturer_id: v })}
                      searchable
                    />
                    <Select
                      label="Модель коректора"
                      size="xs"
                      w={170}
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
                      w={140}
                      valueFormat="DD.MM.YYYY"
                      value={dev.installed_date || null}
                      onChange={(v) => setDevice(dev.idx, { installed_date: v ?? '' })}
                    />
                    <Select
                      label="Година"
                      size="xs"
                      w={90}
                      data={Array.from({ length: 24 }, (_, h) => ({
                        value: String(h),
                        label: `${pad(h)}:00`,
                      }))}
                      value={String(dev.installed_hour)}
                      onChange={(v) => setDevice(dev.idx, { installed_hour: Number(v) })}
                    />
                    <Text size="10px" c="dimmed" style={{ flex: 1 }} pb={8}>
                      {window}
                    </Text>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      mb={4}
                      onClick={() =>
                        setForm((f) => ({ ...f, devices: f.devices.filter((_, i) => i !== dev.idx) }))
                      }
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
              onClick={() => setForm((f) => ({ ...f, devices: [...f.devices, { ...EMPTY_DEVICE }] }))}
            >
              Додати прилад
            </Button>
          </Box>

          <Group gap="sm" justify="flex-end">
            <Button size="xs" variant="default" onClick={reset}>
              Скасувати
            </Button>
            <Button size="xs" onClick={submit} loading={save.isPending}>
              {editId ? 'Зберегти' : 'Створити'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Group justify="space-between">
        <Group gap="sm">
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={startCreate}>
            Додати лінію
          </Button>
          <Text size="sm" c="dimmed">
            Ліній: {visibleLines.length}
          </Text>
        </Group>
        <Select
          size="xs"
          w={220}
          placeholder="Всі філії"
          data={toOptions(branches)}
          value={branchFilter}
          onChange={setBranchFilter}
          clearable
          searchable
        />
      </Group>

      {isLoading ? (
        <LoadingState py={40} />
      ) : (
        <Paper withBorder radius="md">
          <ScrollArea className="hlv-table-scroll" type="auto">
            <Table striped highlightOnHover verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={50}>ID</Table.Th>
                  <Table.Th>Назва</Table.Th>
                  <Table.Th>Філія / ЛУМГ</Table.Th>
                  <Table.Th>Поточний прилад</Table.Th>
                  <Table.Th ta="center">Приладів</Table.Th>
                  <Table.Th ta="center">У звіт</Table.Th>
                  <Table.Th ta="center">У тренди</Table.Th>
                  <Table.Th ta="center">Активна</Table.Th>
                  <Table.Th>Стан</Table.Th>
                  <Table.Th w={110} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visibleLines.map((line) => {
                  const devs = line.devices ?? []
                  const current = devs.length ? devs[devs.length - 1] : null
                  const running = jobs[line.id]?.status === 'running'
                  const card = cardOfLine.get(line.id)
                  // Whether this line has a modem is a fact about the line —
                  // it is edited two fields away from here. Reading it from
                  // the poll screen's list made the icon lag a save behind.
                  const hasModem = !!line.gsm?.phone
                  const waiting = card?.manual_requested_at != null
                  return (
                    <Table.Tr
                      key={line.id}
                      bg={editId === line.id ? 'var(--hlv-surface-2)' : undefined}
                    >
                      <Table.Td c="dimmed">{line.id}</Table.Td>
                      <Table.Td>
                        <Text size="sm">{line.name}</Text>
                        {line.description && (
                          <Text size="10px" c="dimmed">
                            {line.description}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {branchName(line.branch_id)}
                        </Text>
                        <Text size="10px" c="dimmed">
                          {lumgName(line.lumg_id)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {current ? (
                          <>
                            <Text size="xs">
                              <Text span c="petrol" style={numericStyle}>
                                №{current.ser_num}
                              </Text>{' '}
                              {current.model_name}
                            </Text>
                            <Text size="10px" c="dimmed">
                              з {fmtDT(current.installed_from)}
                            </Text>
                          </>
                        ) : (
                          <Text size="xs" c="dimmed">
                            —
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="center">{devs.length}</Table.Td>
                      {(['include_in_report', 'include_in_trends', 'active'] as const).map((f) => (
                        <Table.Td key={f} ta="center">
                          <Switch
                            size="xs"
                            color="petrol"
                            checked={!!line[f]}
                            onChange={() => toggleFlag.mutate({ line, field: f })}
                          />
                        </Table.Td>
                      ))}
                      <Table.Td>{renderJob(line.id)}</Table.Td>
                      <Table.Td>
                        <Group gap={2} justify="flex-end" wrap="nowrap">
                          {/* A call to the modem at the line, as opposed to
                              the init beside it, which reads the same line
                              from the ДПД server. Both fill the archive; this
                              one does it without anybody else's help. */}
                          <Tooltip
                            label={
                              !hasModem
                                ? 'Модем не налаштовано — впишіть номер у картці лінії'
                                : waiting
                                  ? 'Запит уже створено — агент подзвонить, щойно візьме завдання'
                                  : 'Подзвонити на модем лінії зараз'
                            }
                            withArrow
                          >
                            <ActionIcon
                              variant="subtle"
                              color={waiting ? 'amber' : 'petrol'}
                              disabled={!hasModem || waiting}
                              loading={askPoll.isPending && askPoll.variables === line.id}
                              onClick={() => hasModem && askPoll.mutate(line.id)}
                            >
                              <IconPhone size={15} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip
                            label={
                              devs.length === 0
                                ? 'Додайте прилад перед ініціалізацією'
                                : 'Очистити архіви лінії та перечитати з ДПД'
                            }
                            withArrow
                          >
                            <ActionIcon
                              variant="subtle"
                              color="amber"
                              disabled={running || devs.length === 0}
                              onClick={() => runInit(line)}
                            >
                              <IconPlayerPlay size={15} />
                            </ActionIcon>
                          </Tooltip>
                          <ActionIcon variant="subtle" onClick={() => startEdit(line)}>
                            <IconPencil size={16} />
                          </ActionIcon>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            onClick={() =>
                              modals.openConfirmModal({
                                title: 'Видалити лінію ДПД',
                                children: (
                                  <Text size="sm">
                                    Видалити «{line.name}» разом з архівами та історією приладів?
                                  </Text>
                                ),
                                labels: { confirm: 'Видалити', cancel: 'Скасувати' },
                                confirmProps: { color: 'red' },
                                onConfirm: () => remove.mutate(line.id),
                              })
                            }
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
            {visibleLines.length === 0 && (
              <Center py="xl">
                <Text c="dimmed" size="sm">
                  Немає ДПД-ліній — створіть першу кнопкою «Додати лінію»
                </Text>
              </Center>
            )}
          </ScrollArea>
        </Paper>
      )}
    </Stack>
  )
}
