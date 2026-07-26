import { useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Group,
  Loader,
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
} from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deviceCatalogApi,
  dpdLineAdminApi,
  enterpriseMappingApi,
  type EnterpriseMapping,
  type UploadResult,
} from '@/api/admin'
import { TablePagination } from '@/components/TablePagination'
import { numericStyle } from '@/theme/theme'
import { useAdminTopology, toOptions } from '../useAdminTopology'

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })

type FormState = {
  enterprise_name: string
  branch_id: string | null
  line_id: string | null
  ser_num: string
  corector_type_id: string | null
  ch_num: string
  active: boolean
  enabled: boolean
}

const EMPTY: FormState = {
  enterprise_name: '',
  branch_id: null,
  line_id: null,
  ser_num: '',
  corector_type_id: null,
  ch_num: '0',
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
  const { branches, lumgs, calcs, lines, branchName, lumgName } = useAdminTopology()

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
      if (q && !e.enterprise_name.toLowerCase().includes(q) && !String(e.ser_num).includes(q))
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
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'enterprise-mappings'] })

  /** One form field holds the line; on save it routes to line_id or dpd_line_id. */
  const splitLine = (raw: string | null) => {
    const id = raw ? Number(raw) : null
    return {
      line_id: id !== null && !dpdIds.has(id) ? id : null,
      dpd_line_id: id !== null && dpdIds.has(id) ? id : null,
    }
  }

  const payload = (f: FormState): Partial<EnterpriseMapping> => ({
    enterprise_name: f.enterprise_name,
    branch_id: f.branch_id ? Number(f.branch_id) : null,
    ...splitLine(f.line_id),
    ser_num: Number(f.ser_num),
    corector_type_id: f.corector_type_id ? Number(f.corector_type_id) : null,
    ch_num: Number(f.ch_num) || 0,
    active: f.active,
    enabled: f.enabled,
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
    setForm({
      enterprise_name: e.enterprise_name,
      branch_id: e.branch_id != null ? String(e.branch_id) : null,
      line_id: (e.line_id ?? e.dpd_line_id) != null ? String(e.line_id ?? e.dpd_line_id) : null,
      ser_num: String(e.ser_num ?? ''),
      corector_type_id: e.corector_type_id != null ? String(e.corector_type_id) : null,
      ch_num: String(e.ch_num ?? 0),
      active: e.active,
      enabled: e.enabled,
    })
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

  // ── Form (shared by add and edit) ─────────────────────────────────────────
  const formRow = (
    <Paper withBorder radius="md" p="md">
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
          onChange={(v) => setForm({ ...form, branch_id: v })}
          placeholder="— з лінії —"
          clearable
          searchable
        />
        <Select
          label="Лінія"
          size="xs"
          w={220}
          data={lineOptions}
          value={form.line_id}
          onChange={(v) => setForm({ ...form, line_id: v })}
          placeholder="— не привʼязано —"
          clearable
          searchable
        />
        <NumberInput
          label="Серійний №"
          size="xs"
          w={120}
          hideControls
          value={form.ser_num}
          onChange={(v) => setForm({ ...form, ser_num: v === '' ? '' : String(v) })}
          required
        />
        <Select
          label="Тип коректора"
          size="xs"
          w={220}
          data={corectorOptions}
          value={form.corector_type_id}
          onChange={(v) => setForm({ ...form, corector_type_id: v })}
          clearable
          searchable
        />
        <NumberInput
          label="Канал"
          size="xs"
          w={80}
          min={0}
          max={9}
          value={Number(form.ch_num)}
          onChange={(v) => setForm({ ...form, ch_num: String(v ?? 0) })}
        />
        <Switch
          size="xs"
          label="Активне"
          checked={form.active}
          onChange={(e) => setForm({ ...form, active: e.currentTarget.checked })}
          mb={6}
        />
        <Switch
          size="xs"
          label="Опитувати"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.currentTarget.checked })}
          mb={6}
        />
        <Button
          size="xs"
          onClick={() => save.mutate()}
          loading={save.isPending}
          disabled={!form.enterprise_name || !form.ser_num}
        >
          Зберегти
        </Button>
        <Button size="xs" variant="default" onClick={cancel}>
          Скасувати
        </Button>
      </Group>
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
          label="Активне"
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
          label="Опитувати"
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
        <Center py={40}>
          <Loader color="petrol" />
        </Center>
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
                  <Table.Th ta="right">Сер. №</Table.Th>
                  <Table.Th>Тип коректора</Table.Th>
                  <Table.Th ta="center">Канал</Table.Th>
                  <Table.Th ta="center">Активне</Table.Th>
                  <Table.Th ta="center">Опитувати</Table.Th>
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
                    <Table.Td ta="right" style={numericStyle}>
                      {e.ser_num}
                    </Table.Td>
                    <Table.Td c="dimmed">{corectorLabel(e.corector_type_id)}</Table.Td>
                    <Table.Td ta="center" style={numericStyle}>
                      {e.ch_num}
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
