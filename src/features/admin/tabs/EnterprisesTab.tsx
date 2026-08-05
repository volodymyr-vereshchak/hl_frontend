import { useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import {
  IconCheck,
  IconDownload,
  IconFileSpreadsheet,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUpload,
  IconX,
} from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  currentEnterpriseDevice,
  deviceCatalogApi,
  dpdLineAdminApi,
  enterpriseMappingApi,
  type EnterpriseMapping,
  type UploadResult,
} from '@/api/admin'
import { TablePagination } from '@/components/TablePagination'
import { resolveWindows } from '@/domain/deviceHistory'
import { invalidateTopology } from '@/lib/invalidateTopology'
import { numericStyle } from '@/theme/theme'
import { useAdminTopology, toOptions } from '../useAdminTopology'
import { LoadingState } from '@/components/LoadingState'

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })

const pad = (n: number) => String(n).padStart(2, '0')

const fmtDT = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** «Стоїть від початку» — points migrated from the pre-history schema. */
const EPOCH_YEAR = 2000

/** One row of the history editor. */
interface DeviceForm {
  ser_num: string
  /** UI only — narrows the corrector-type list, never sent to the API. */
  manufacturer_id: string | null
  corector_type_id: string | null
  ch_num: number
  /** Empty = «від початку»: the whole archive belongs to this corrector. */
  installed_date: string
  installed_hour: number
  /** Only set when the corrector was taken off before the next was fitted. */
  removed_date: string
  removed_hour: number
}

const EMPTY_DEVICE: DeviceForm = {
  ser_num: '',
  manufacturer_id: null,
  corector_type_id: null,
  ch_num: 0,
  installed_date: '',
  installed_hour: 7,
  removed_date: '',
  removed_hour: 7,
}

type FormState = {
  enterprise_name: string
  branch_id: string | null
  /** UI only — narrows the line list, never sent to the API. */
  calc_id: string | null
  line_id: string | null
  devices: DeviceForm[]
  active: boolean
  enabled: boolean
}

const EMPTY: FormState = {
  enterprise_name: '',
  branch_id: null,
  calc_id: null,
  line_id: null,
  devices: [{ ...EMPTY_DEVICE }],
  active: true,
  enabled: true,
}

/**
 * Підприємства — industrial consumers sitting behind a metering line. Their
 * volumes are what the reports subtract to get the населення share, so the
 * corrector (серійний номер + тип + канал) has to be exact: that triple is what
 * the DPD poll asks for.
 */
export function EnterprisesTab() {
  const qc = useQueryClient()
  const { branches, lumgs, calcs, lines, branchName, lumgName, calcIdsOfBranch } =
    useAdminTopology()

  const { data: enterprises, isLoading } = useQuery({
    queryKey: ['admin', 'enterprise-mappings'],
    queryFn: enterpriseMappingApi.getAll,
  })
  const { data: dpdLines } = useQuery({
    queryKey: ['admin', 'dpd-lines'],
    queryFn: () => dpdLineAdminApi.getAll().catch(() => []),
  })
  const { data: manufacturers } = useQuery({
    queryKey: ['admin', 'manufacturers'],
    queryFn: deviceCatalogApi.manufacturers,
  })
  const { data: corectorTypes } = useQuery({
    queryKey: ['admin', 'corrector-types'],
    queryFn: deviceCatalogApi.correctorTypes,
  })

  // Filters
  const [search, setSearch] = useState('')
  const [fBranch, setFBranch] = useState<string | null>(null)
  const [fLumg, setFLumg] = useState<string | null>(null)
  const [fLine, setFLine] = useState<string | null>(null)
  const [fActive, setFActive] = useState<string | null>(null)
  const [fEnabled, setFEnabled] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  // Editing
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [adding, setAdding] = useState(false)

  // Excel
  const [uploadBranch, setUploadBranch] = useState<string | null>(null)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // ── Lookups ───────────────────────────────────────────────────────────────
  /** Line ids never collide across kinds, so one select covers both. */
  const dpdIds = useMemo(() => new Set((dpdLines ?? []).map((d) => d.id)), [dpdLines])
  const lineOptions = useMemo(
    () => [
      ...lines.map((l) => ({ value: String(l.id), label: l.name })),
      ...(dpdLines ?? []).map((d) => ({ value: String(d.id), label: `[ДПД] ${d.name}` })),
    ],
    [lines, dpdLines],
  )
  const lineLabel = useMemo(() => {
    const m = new Map(lineOptions.map((o) => [o.value, o.label]))
    return (id?: number | null) => (id == null ? '—' : (m.get(String(id)) ?? String(id)))
  }, [lineOptions])

  const corectorOptions = useMemo(() => {
    const mfr = new Map((manufacturers ?? []).map((m) => [m.id, m.short_name]))
    return (corectorTypes ?? [])
      .map((ct) => ({
        value: String(ct.id),
        label: `${mfr.get(ct.manufacturer_id) ?? '?'} / ${ct.model_name}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [corectorTypes, manufacturers])
  const corectorLabel = useMemo(() => {
    const m = new Map(corectorOptions.map((o) => [o.value, o.label]))
    return (id?: number | null) => (id == null ? '—' : (m.get(String(id)) ?? String(id)))
  }, [corectorOptions])

  // ── Cascading options for the add/edit form ───────────────────────────────
  // Філія → обчислювач → лінія, виробник → тип коректора. Without this the two
  // long selects listed every line and every corrector in the system.
  const formCalcOptions = useMemo(() => {
    if (!form.branch_id) return toOptions(calcs)
    const ids = new Set(calcIdsOfBranch(Number(form.branch_id)))
    return toOptions(calcs.filter((c) => ids.has(c.id)))
  }, [calcs, form.branch_id, calcIdsOfBranch])

  const formLineOptions = useMemo(() => {
    const branchId = form.branch_id ? Number(form.branch_id) : null
    const calcId = form.calc_id ? Number(form.calc_id) : null
    const branchCalcIds = branchId != null ? new Set(calcIdsOfBranch(branchId)) : null
    const phys = lines.filter((l) => {
      if (calcId != null) return l.gas_volume_calc_id === calcId
      if (branchCalcIds) return l.gas_volume_calc_id != null && branchCalcIds.has(l.gas_volume_calc_id)
      return true
    })
    // ДПД lines hang off the філія/ЛУМГ directly, not off an обчислювач, so
    // picking a specific обчислювач rules them out.
    const dpd = (dpdLines ?? []).filter((d) => {
      if (calcId != null) return false
      if (branchId != null) return d.branch_id === branchId
      return true
    })
    return [
      ...phys.map((l) => ({ value: String(l.id), label: l.name })),
      ...dpd.map((d) => ({ value: String(d.id), label: `[ДПД] ${d.name}` })),
    ]
  }, [lines, dpdLines, form.branch_id, form.calc_id, calcIdsOfBranch])

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

  const calcToLumg = useMemo(() => new Map(calcs.map((c) => [c.id, c.lumg_id])), [calcs])
  const lumgToBranch = useMemo(() => new Map(lumgs.map((l) => [l.id, l.branch_id])), [lumgs])
  const dpdById = useMemo(() => new Map((dpdLines ?? []).map((d) => [d.id, d])), [dpdLines])
  const lineById = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines])

  /** ЛУМГ of an enterprise, resolved through whichever line it points at. */
  const effLumg = (e: EnterpriseMapping): number | null => {
    if (e.dpd_line_id) return dpdById.get(e.dpd_line_id)?.lumg_id ?? null
    const line = e.line_id != null ? lineById.get(e.line_id) : null
    return line?.gas_volume_calc_id != null ? (calcToLumg.get(line.gas_volume_calc_id) ?? null) : null
  }

  /** Branch: an explicit one wins, otherwise it follows line → calc → ЛУМГ. */
  const effBranch = (e: EnterpriseMapping): number | null => {
    if (e.branch_id) return e.branch_id
    if (e.dpd_line_id) return dpdById.get(e.dpd_line_id)?.branch_id ?? null
    const lumgId = effLumg(e)
    return lumgId != null ? (lumgToBranch.get(lumgId) ?? null) : null
  }

  // ── Filtering ─────────────────────────────────────────────────────────────
  const lumgOptions = useMemo(
    () => toOptions(fBranch ? lumgs.filter((l) => String(l.branch_id) === fBranch) : lumgs),
    [lumgs, fBranch],
  )
  const filteredLineOptions = useMemo(() => {
    if (!fLumg) return lineOptions
    const calcIds = new Set(calcs.filter((c) => String(c.lumg_id) === fLumg).map((c) => c.id))
    const ok = new Set<string>()
    lines.forEach((l) => {
      if (l.gas_volume_calc_id != null && calcIds.has(l.gas_volume_calc_id)) ok.add(String(l.id))
    })
    ;(dpdLines ?? []).forEach((d) => {
      if (String(d.lumg_id) === fLumg) ok.add(String(d.id))
    })
    return lineOptions.filter((o) => ok.has(o.value))
  }, [lineOptions, fLumg, calcs, lines, dpdLines])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (enterprises ?? []).filter((e) => {
      // Search hits ANY corrector the point ever had, not just the current
      // one: looking up a serial is how you find where a device used to be.
      if (
        q &&
        !e.enterprise_name.toLowerCase().includes(q) &&
        !(e.devices ?? []).some((d) => String(d.ser_num).includes(q))
      )
        return false
      if (fActive != null && String(e.active) !== fActive) return false
      if (fEnabled != null && String(e.enabled) !== fEnabled) return false
      const lineId = e.line_id ?? e.dpd_line_id ?? null
      if (fLine === 'null' && lineId !== null) return false
      if (fLine && fLine !== 'null' && String(lineId) !== fLine) return false
      if (fLumg && String(effLumg(e)) !== fLumg) return false
      if (fBranch && String(effBranch(e)) !== fBranch) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enterprises, search, fActive, fEnabled, fLine, fLumg, fBranch, dpdById, lineById])

  const pageRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  )

  // ── Mutations ─────────────────────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'enterprise-mappings'] })
    // The poll page reads the same enterprises under its own key.
    invalidateTopology(qc)
  }

  /** One form field holds the line; on save it routes to line_id or dpd_line_id. */
  const splitLine = (raw: string | null) => {
    const id = raw ? Number(raw) : null
    return {
      line_id: id !== null && !dpdIds.has(id) ? id : null,
      dpd_line_id: id !== null && dpdIds.has(id) ? id : null,
    }
  }

  /**
   * An empty install date means «стоїть від початку», so the point's whole
   * archive belongs to this corrector — the state every point had before the
   * history existed. An empty hour means the start of the commercial day, not
   * midnight: with 00:00 the hours before it belong to the previous commercial
   * day and would be handed to the wrong device.
   */
  const stamp = (date: string, hour: number) =>
    date ? `${date}T${pad(hour)}:00:00` : `${EPOCH_YEAR}-01-01T00:00:00`

  const payload = (f: FormState): Partial<EnterpriseMapping> => ({
    enterprise_name: f.enterprise_name,
    branch_id: f.branch_id ? Number(f.branch_id) : null,
    ...splitLine(f.line_id),
    active: f.active,
    enabled: f.enabled,
    devices: f.devices.map((d) => ({
      ser_num: Number(d.ser_num),
      corector_type_id: d.corector_type_id ? Number(d.corector_type_id) : null,
      ch_num: Number(d.ch_num) || 0,
      installed_from: stamp(d.installed_date, d.installed_hour),
      removed_at: d.removed_date ? `${d.removed_date}T${pad(d.removed_hour)}:00:00` : null,
    })),
  })

  const save = useMutation({
    mutationFn: () =>
      editingId
        ? enterpriseMappingApi.update(editingId, payload(form))
        : enterpriseMappingApi.create(payload(form)),
    onSuccess: () => {
      notifications.show({ message: 'Збережено', color: 'teal' })
      cancel()
      invalidate()
    },
    onError: notifyErr,
  })

  const remove = useMutation({
    mutationFn: (id: number) => enterpriseMappingApi.remove(id),
    onSuccess: () => {
      notifications.show({ message: 'Видалено', color: 'teal' })
      invalidate()
    },
    onError: notifyErr,
  })

  const toggleFlag = useMutation({
    mutationFn: ({ e, field }: { e: EnterpriseMapping; field: 'active' | 'enabled' }) =>
      enterpriseMappingApi.update(e.id, { [field]: !e[field] }),
    onSuccess: invalidate,
    onError: notifyErr,
  })

  const cancel = () => {
    setEditingId(null)
    setAdding(false)
    setForm(EMPTY)
  }

  const startEdit = (e: EnterpriseMapping) => {
    setAdding(false)
    setEditingId(e.id)
    // Обчислювач and виробник only steer the selects, so they are back-derived
    // from what the record already points at — otherwise editing would open
    // with both narrowing selects blank and the long lists unfiltered again.
    const calcId = e.line_id != null ? (lineById.get(e.line_id)?.gas_volume_calc_id ?? null) : null
    const mfrOf = (ctId?: number | null) =>
      ctId != null
        ? ((corectorTypes ?? []).find((ct) => ct.id === ctId)?.manufacturer_id ?? null)
        : null
    setForm({
      enterprise_name: e.enterprise_name,
      branch_id: e.branch_id != null ? String(e.branch_id) : null,
      calc_id: calcId != null ? String(calcId) : null,
      line_id: (e.line_id ?? e.dpd_line_id) != null ? String(e.line_id ?? e.dpd_line_id) : null,
      devices: (e.devices ?? []).map((d) => {
        const from = new Date(d.installed_from)
        const removed = d.removed_at ? new Date(d.removed_at) : null
        // The epoch stands for «від початку» and is shown as an empty date,
        // so re-saving an untouched point does not invent an install date.
        const fromEpoch = from.getFullYear() <= EPOCH_YEAR
        return {
          ser_num: String(d.ser_num),
          manufacturer_id: String(mfrOf(d.corector_type_id) ?? ''),
          corector_type_id: d.corector_type_id != null ? String(d.corector_type_id) : null,
          ch_num: d.ch_num,
          installed_date: fromEpoch ? '' : d.installed_from.slice(0, 10),
          installed_hour: fromEpoch ? 7 : from.getHours(),
          removed_date: removed ? d.removed_at!.slice(0, 10) : '',
          removed_hour: removed ? removed.getHours() : 7,
        }
      }),
      active: e.active,
      enabled: e.enabled,
    })
  }

  const setDevice = (idx: number, patch: Partial<DeviceForm>) =>
    setForm((f) => ({
      ...f,
      devices: f.devices.map((d, i) =>
        i !== idx
          ? d
          : // Switching manufacturer invalidates the model choice.
            {
              ...d,
              ...patch,
              ...(patch.manufacturer_id !== undefined ? { corector_type_id: null } : {}),
            },
      ),
    }))

  /**
   * The editor rows in install order, each with the window it will actually
   * get. The window comes from the shared resolver, not from "the next row's
   * date": a removal later than the next install is ignored by the backend
   * (two devices can never both be in force), and the preview has to say the
   * same thing the archive will do.
   */
  const orderedDevices = useMemo(() => {
    const rows = form.devices.map((d, idx) => ({
      ...d,
      idx,
      installedFrom: d.installed_date
        ? `${d.installed_date}T${pad(d.installed_hour)}:00:00`
        : `${EPOCH_YEAR}-01-01T00:00:00`,
      removedAt: d.removed_date ? `${d.removed_date}T${pad(d.removed_hour)}:00:00` : '',
    }))
    return resolveWindows(rows).map((w) => ({ ...w.entry, boundTo: w.to }))
  }, [form.devices])

  const ctsForMfr = (mfrId: string | null) =>
    (corectorTypes ?? []).filter((c) => String(c.manufacturer_id) === mfrId)

  const submit = () => {
    if (!form.enterprise_name) {
      notifications.show({ message: 'Вкажіть назву точки обліку', color: 'red' })
      return
    }
    if (form.devices.length === 0) {
      notifications.show({ message: 'Додайте хоча б один прилад', color: 'red' })
      return
    }
    for (const d of form.devices) {
      if (!d.ser_num) {
        notifications.show({ message: 'Заповніть серійний номер кожного приладу', color: 'red' })
        return
      }
    }
    save.mutate()
  }

  // ── Excel ─────────────────────────────────────────────────────────────────
  const handleUpload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setUploadResult(null)
    try {
      const res = await enterpriseMappingApi.uploadExcel(
        file,
        uploadBranch ? Number(uploadBranch) : undefined,
      )
      setUploadResult(res)
      if (res.imported > 0) invalidate()
    } catch (e) {
      setUploadResult({ imported: 0, errors: [(e as Error).message] })
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  // ── Device history sub-editor ─────────────────────────────────────────────
  const historyEditor = (
    <Box>
      <Text size="xs" fw={500}>
        Історія приладів
      </Text>
      <Text size="10px" c="dimmed" mb={6}>
        Кожен прилад діє від своєї дати встановлення до наступної. Порожня дата — прилад стоїть від
        початку. «Знято» заповнюють лише тоді, коли прилад зняли раніше, ніж поставили наступний:
        за ці дні даних по точці не буде
      </Text>

      <Stack gap={6}>
        {orderedDevices.map((dev, order) => {
          const from = dev.installed_date
            ? `з ${dev.installed_date} ${pad(dev.installed_hour)}:00`
            : 'від початку'
          const to = dev.boundTo ? `до ${fmtDT(dev.boundTo)}` : '— дотепер'
          // A window that closes before the next device arrives is a stretch
          // with nothing fitted — worth saying out loud, since the point will
          // simply have no data for it.
          const next = orderedDevices[order + 1]
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
  )

  // ── Form (shared by add and edit) ─────────────────────────────────────────
  const formRow = (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
      <Group gap="sm" align="flex-end" wrap="wrap">
        <TextInput
          label="Підприємство"
          size="xs"
          w={240}
          value={form.enterprise_name}
          onChange={(e) => setForm({ ...form, enterprise_name: e.currentTarget.value })}
          required
        />
        <Select
          label="Філія"
          size="xs"
          w={180}
          data={toOptions(branches)}
          value={form.branch_id}
          // Changing the філія invalidates whatever обчислювач/лінія was picked
          // under the previous one.
          onChange={(v) => setForm({ ...form, branch_id: v, calc_id: null, line_id: null })}
          placeholder="— з лінії —"
          clearable
          searchable
        />
        <Select
          label="Обчислювач"
          size="xs"
          w={200}
          data={formCalcOptions}
          value={form.calc_id}
          onChange={(v) => setForm({ ...form, calc_id: v, line_id: null })}
          placeholder={form.branch_id ? '— всі —' : '— спершу філія —'}
          clearable
          searchable
        />
        <Select
          label="Лінія"
          size="xs"
          w={220}
          data={formLineOptions}
          value={form.line_id}
          onChange={(v) => setForm({ ...form, line_id: v })}
          placeholder="— не привʼязано —"
          clearable
          searchable
        />
        <Switch
          size="xs"
          label="Активний"
          checked={form.active}
          onChange={(e) => setForm({ ...form, active: e.currentTarget.checked })}
          mb={6}
        />
        <Switch
          size="xs"
          label="Увімкнений"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.currentTarget.checked })}
          mb={6}
        />
      </Group>

      {historyEditor}

      <Group gap="sm">
        <Button size="xs" onClick={submit} loading={save.isPending}>
          Зберегти
        </Button>
        <Button size="xs" variant="default" onClick={cancel}>
          Скасувати
        </Button>
      </Group>
      </Stack>
    </Paper>
  )

  return (
    <Stack gap="md">
      <Box>
        <Text fw={600} fz="lg" ff="'Space Grotesk Variable', sans-serif">
          Підприємства
        </Text>
        <Text size="xs" c="dimmed">
          Промислові споживачі за лініями. Їхні обсяги віднімаються від загальних, щоб отримати
          побутове споживання
        </Text>
      </Box>

      {/* Excel */}
      <Paper withBorder radius="md" p="sm">
        <Group gap="sm" wrap="wrap" align="center">
          <Text size="xs" c="dimmed" fw={600}>
            Excel
          </Text>
          <Button
            size="compact-xs"
            variant="default"
            leftSection={<IconDownload size={13} />}
            onClick={() => enterpriseMappingApi.downloadTemplate()}
          >
            Шаблон
          </Button>
          <Button
            size="compact-xs"
            variant="default"
            leftSection={<IconFileSpreadsheet size={13} />}
            onClick={() => enterpriseMappingApi.downloadExport()}
          >
            Експорт
          </Button>
          <Divider orientation="vertical" />
          <Select
            size="xs"
            w={200}
            placeholder="Філія для імпорту"
            data={toOptions(branches)}
            value={uploadBranch}
            onChange={setUploadBranch}
            clearable
            searchable
          />
          <Tooltip label="Оберіть філію перед імпортом" disabled={!!uploadBranch} withArrow>
            <Button
              size="compact-xs"
              leftSection={<IconUpload size={13} />}
              disabled={!uploadBranch || uploading}
              loading={uploading}
              onClick={() => fileInput.current?.click()}
            >
              Імпортувати
            </Button>
          </Tooltip>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(e) => handleUpload(e.currentTarget.files?.[0])}
          />
          {uploadResult && (
            <Group gap={6}>
              {uploadResult.imported > 0 && (
                <Group gap={4} c="teal.5">
                  <IconCheck size={13} />
                  <Text size="xs">Імпортовано: {uploadResult.imported}</Text>
                </Group>
              )}
              {!!uploadResult.errors?.length && (
                <Tooltip label={uploadResult.errors.join('\n')} multiline w={340} withArrow>
                  <Text size="xs" c="red.5" style={{ cursor: 'help' }}>
                    {uploadResult.errors.length} попереджень
                  </Text>
                </Tooltip>
              )}
            </Group>
          )}
        </Group>
      </Paper>

      {/* Filters */}
      <Group gap="sm" wrap="wrap" align="flex-end">
        <TextInput
          size="xs"
          w={220}
          label="Пошук"
          placeholder="Назва або серійний №"
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value)
            setPage(1)
          }}
        />
        <Select
          size="xs"
          w={180}
          label="Філія"
          placeholder="Всі"
          data={toOptions(branches)}
          value={fBranch}
          onChange={(v) => {
            setFBranch(v)
            setFLumg(null)
            setFLine(null)
            setPage(1)
          }}
          clearable
          searchable
        />
        <Select
          size="xs"
          w={180}
          label="ЛУМГ"
          placeholder="Всі"
          data={lumgOptions}
          value={fLumg}
          onChange={(v) => {
            setFLumg(v)
            setFLine(null)
            setPage(1)
          }}
          clearable
          searchable
        />
        <Select
          size="xs"
          w={200}
          label="Лінія"
          placeholder="Всі"
          data={[{ value: 'null', label: '— без лінії —' }, ...filteredLineOptions]}
          value={fLine}
          onChange={(v) => {
            setFLine(v)
            setPage(1)
          }}
          clearable
          searchable
        />
        <Select
          size="xs"
          w={130}
          label="Активний"
          placeholder="Всі"
          data={[
            { value: 'true', label: 'Так' },
            { value: 'false', label: 'Ні' },
          ]}
          value={fActive}
          onChange={setFActive}
          clearable
        />
        <Select
          size="xs"
          w={130}
          label="Увімкнений"
          placeholder="Всі"
          data={[
            { value: 'true', label: 'Так' },
            { value: 'false', label: 'Ні' },
          ]}
          value={fEnabled}
          onChange={setFEnabled}
          clearable
        />
        <Button
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={() => {
            setEditingId(null)
            setForm({ ...EMPTY, branch_id: fBranch })
            setAdding(true)
          }}
          ml="auto"
        >
          Додати
        </Button>
      </Group>

      {(adding || editingId != null) && formRow}

      {isLoading ? (
        <LoadingState py={40} />
      ) : (
        <Paper withBorder radius="md">
          <ScrollArea className="hlv-table-scroll" type="auto">
            <Table striped highlightOnHover stickyHeader verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Підприємство</Table.Th>
                  <Table.Th>Філія</Table.Th>
                  <Table.Th>ЛУМГ</Table.Th>
                  <Table.Th>Лінія</Table.Th>
                  <Table.Th>Поточний прилад</Table.Th>
                  <Table.Th ta="center">Приладів</Table.Th>
                  <Table.Th ta="center">Канал</Table.Th>
                  <Table.Th ta="center">Активний</Table.Th>
                  <Table.Th ta="center">Увімкнений</Table.Th>
                  <Table.Th w={80} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pageRows.map((e) => (
                  <Table.Tr key={e.id} bg={editingId === e.id ? 'var(--hlv-surface-2)' : undefined}>
                    <Table.Td>{e.enterprise_name}</Table.Td>
                    <Table.Td c="dimmed">{branchName(effBranch(e))}</Table.Td>
                    <Table.Td c="dimmed">{lumgName(effLumg(e))}</Table.Td>
                    <Table.Td>
                      {e.dpd_line_id ? (
                        <Badge size="xs" variant="light" color="grape" tt="none" mr={4}>
                          ДПД
                        </Badge>
                      ) : null}
                      {lineLabel(e.line_id ?? e.dpd_line_id)}
                    </Table.Td>
                    <Table.Td>
                      {(() => {
                        const current = currentEnterpriseDevice(e)
                        if (!current)
                          return (
                            <Text size="xs" c="dimmed">
                              —
                            </Text>
                          )
                        return (
                          <>
                            <Text size="xs">
                              <Text span c="petrol" style={numericStyle}>
                                №{current.ser_num}
                              </Text>{' '}
                              {corectorLabel(current.corector_type_id)}
                            </Text>
                            {/* The epoch means «стоїть від початку» — showing
                                01.01.2000 would look like a real install. */}
                            {new Date(current.installed_from).getFullYear() > EPOCH_YEAR && (
                              <Text size="10px" c="dimmed">
                                з {fmtDT(current.installed_from)}
                              </Text>
                            )}
                          </>
                        )
                      })()}
                    </Table.Td>
                    <Table.Td ta="center" style={numericStyle}>
                      {(e.devices ?? []).length}
                    </Table.Td>
                    <Table.Td ta="center" style={numericStyle}>
                      {currentEnterpriseDevice(e)?.ch_num ?? '—'}
                    </Table.Td>
                    {(['active', 'enabled'] as const).map((f) => (
                      <Table.Td key={f} ta="center">
                        <Switch
                          size="xs"
                          color="petrol"
                          checked={!!e[f]}
                          onChange={() => toggleFlag.mutate({ e, field: f })}
                        />
                      </Table.Td>
                    ))}
                    <Table.Td>
                      <Group gap={2} justify="flex-end" wrap="nowrap">
                        <ActionIcon variant="subtle" onClick={() => startEdit(e)}>
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() =>
                            modals.openConfirmModal({
                              title: 'Видалити підприємство',
                              children: <Text size="sm">Видалити «{e.enterprise_name}»?</Text>,
                              labels: { confirm: 'Видалити', cancel: 'Скасувати' },
                              confirmProps: { color: 'red' },
                              onConfirm: () => remove.mutate(e.id),
                            })
                          }
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {pageRows.length === 0 && (
              <Center py="xl">
                <Text c="dimmed" size="sm">
                  Немає записів
                </Text>
              </Center>
            )}
          </ScrollArea>
          {rows.length > pageSize && (
            <>
              <Divider />
              <TablePagination
                page={page}
                pageSize={pageSize}
                total={rows.length}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                shownLabel={`Записів: ${rows.length}`}
              />
            </>
          )}
        </Paper>
      )}
    </Stack>
  )
}
