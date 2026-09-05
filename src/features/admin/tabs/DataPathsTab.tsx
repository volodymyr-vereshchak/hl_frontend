import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
  Code,
  Collapse,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import {
  IconChevronRight,
  IconDeviceFloppy,
  IconInfoCircle,
  IconPlus,
  IconRefresh,
  IconScan,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  branchAdminApi,
  lumgAdminApi,
  type ConfigMapping,
  type DataPath,
  type EisCode,
} from '@/api/admin'
import type { Branch, Lumg } from '@/types'
import { useAdminTopology, toOptions } from '../useAdminTopology'
import { AdminTabHeader } from '../AdminTableShell'

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })

// ── ASK.CFG name config, per branch ─────────────────────────────────────────

/**
 * The branch's ASK.CFG is where ГРС/line NAMES come from. Reading it lists the
 * ГРС blocks it contains; each block has to be mapped to a ЛУМГ before
 * "Оновити імена" can rename anything — otherwise the names have nowhere to land.
 */
function ConfigSection({ branch, lumgs }: { branch: Branch; lumgs: Lumg[] }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<{ path: string; active: boolean }>({ path: '', active: true })
  const [mappings, setMappings] = useState<ConfigMapping[] | null>(null)

  const pathQ = useQuery({
    queryKey: ['admin', 'branch-config-path', branch.id],
    queryFn: () => branchAdminApi.getConfigPath(branch.id).catch(() => null),
  })
  const savedMapQ = useQuery({
    queryKey: ['admin', 'branch-config-mappings', branch.id],
    queryFn: () => branchAdminApi.getConfigMappings(branch.id).catch(() => [] as ConfigMapping[]),
  })
  const previewQ = useQuery({
    queryKey: ['admin', 'branch-config-preview', branch.id],
    queryFn: () => branchAdminApi.previewConfig(branch.id),
    enabled: false,
    retry: false,
  })

  const dp = pathQ.data ?? null
  const saved = savedMapQ.data ?? []
  const preview = previewQ.data

  const savePath = useMutation({
    mutationFn: () => branchAdminApi.setConfigPath(branch.id, form),
    onSuccess: () => {
      notifications.show({ message: 'Шлях збережено', color: 'teal' })
      setEditing(false)
      qc.invalidateQueries({ queryKey: ['admin', 'branch-config-path', branch.id] })
    },
    onError: notifyErr,
  })

  const deletePath = useMutation({
    mutationFn: () => branchAdminApi.deleteConfigPath(branch.id),
    onSuccess: () => {
      notifications.show({ message: 'Видалено', color: 'teal' })
      setMappings(null)
      qc.invalidateQueries({ queryKey: ['admin', 'branch-config-path', branch.id] })
    },
    onError: notifyErr,
  })

  const saveMappings = useMutation({
    mutationFn: () => branchAdminApi.setConfigMappings(branch.id, mappings ?? []),
    onSuccess: () => {
      notifications.show({ message: 'Маппінг збережено', color: 'teal' })
      qc.invalidateQueries({ queryKey: ['admin', 'branch-config-mappings', branch.id] })
    },
    onError: notifyErr,
  })

  const updateNames = useMutation({
    mutationFn: () => branchAdminApi.updateNames(branch.id),
    onSuccess: () => notifications.show({ message: 'Імена оновлено', color: 'teal' }),
    onError: notifyErr,
  })

  const loadPreview = async () => {
    const res = await previewQ.refetch()
    if (!res.data) {
      notifications.show({ message: 'Не вдалося прочитати файл', color: 'red' })
      return
    }
    // Keep whatever was already mapped; new blocks start unmapped.
    const byName = new Map(saved.map((m) => [m.gis_name, m.lumg_id]))
    setMappings(
      res.data.map((g) => ({ gis_name: g.gis_name, lumg_id: byName.get(g.gis_name) ?? null })),
    )
  }

  const mappedCount = saved.filter((m) => m.lumg_id != null).length

  return (
    <Paper withBorder radius="md" p="md">
      <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="xs" style={{ letterSpacing: 0.5 }}>
        Конфіг імен (ASK.CFG)
      </Text>

      <Group gap="sm" wrap="wrap" align="center">
        {editing ? (
          <>
            <TextInput
              size="xs"
              style={{ flex: 1, minWidth: 280 }}
              value={form.path}
              onChange={(e) => setForm({ ...form, path: e.currentTarget.value })}
              placeholder="backend/data/askcfgs/ZP/ask.CFG"
            />
            <Switch
              size="xs"
              label="Активний"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.currentTarget.checked })}
            />
            <Button size="compact-xs" onClick={() => savePath.mutate()} loading={savePath.isPending}>
              Зберегти
            </Button>
            <Button size="compact-xs" variant="default" onClick={() => setEditing(false)}>
              Скасувати
            </Button>
          </>
        ) : (
          <>
            {dp?.path ? (
              <Code style={{ flex: 1, fontSize: 12, wordBreak: 'break-all' }}>{dp.path}</Code>
            ) : (
              <Text size="xs" c="dimmed" style={{ flex: 1 }}>
                Шлях не вказано
              </Text>
            )}
            <Button
              size="compact-xs"
              variant="default"
              onClick={() => {
                setForm({ path: dp?.path ?? '', active: dp?.active ?? true })
                setEditing(true)
              }}
            >
              {dp ? 'Редагувати' : 'Додати шлях'}
            </Button>
            {dp && (
              <>
                <Button
                  size="compact-xs"
                  variant="light"
                  onClick={loadPreview}
                  loading={previewQ.isFetching}
                >
                  Переглянути CFG
                </Button>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() =>
                    modals.openConfirmModal({
                      title: 'Видалити шлях',
                      children: <Text size="sm">Видалити шлях до ASK.CFG?</Text>,
                      labels: { confirm: 'Видалити', cancel: 'Скасувати' },
                      confirmProps: { color: 'red' },
                      onConfirm: () => deletePath.mutate(),
                    })
                  }
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </>
            )}
          </>
        )}
      </Group>

      {/* Mapping editor, shown after the file has been read */}
      {mappings && (
        <Box mt="sm">
          <Group justify="space-between" mb={4}>
            <Text size="xs" c="dimmed">
              ГРС у файлі: {mappings.length}
            </Text>
            <Button size="compact-xs" variant="subtle" onClick={() => setMappings(null)}>
              Згорнути
            </Button>
          </Group>
          <ScrollArea.Autosize mah={300} type="auto">
            <Table striped verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>ЛУМГ у CFG</Table.Th>
                  <Table.Th ta="center">Приладів</Table.Th>
                  <Table.Th ta="center">Ліній</Table.Th>
                  <Table.Th w={220}>ЛУМГ у БД</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(preview ?? []).map((gis) => {
                  const m = mappings.find((x) => x.gis_name === gis.gis_name)
                  return (
                    <Table.Tr key={gis.gis_name}>
                      <Table.Td>
                        <Code style={{ fontSize: 12 }}>{gis.gis_name}</Code>
                      </Table.Td>
                      <Table.Td ta="center">{gis.flow_count}</Table.Td>
                      <Table.Td ta="center">{gis.line_count}</Table.Td>
                      <Table.Td>
                        <Select
                          size="xs"
                          placeholder="— не вибрано —"
                          data={toOptions(lumgs)}
                          value={m?.lumg_id != null ? String(m.lumg_id) : null}
                          onChange={(v) =>
                            setMappings((prev) =>
                              (prev ?? []).map((x) =>
                                x.gis_name === gis.gis_name
                                  ? { ...x, lumg_id: v ? Number(v) : null }
                                  : x,
                              ),
                            )
                          }
                          clearable
                          searchable
                        />
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
          <Group gap="xs" mt="xs">
            <Button
              size="xs"
              leftSection={<IconDeviceFloppy size={14} />}
              onClick={() => saveMappings.mutate()}
              loading={saveMappings.isPending}
            >
              Зберегти маппінг
            </Button>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconRefresh size={14} />}
              disabled={mappings.every((m) => m.lumg_id == null)}
              onClick={() => updateNames.mutate()}
              loading={updateNames.isPending}
            >
              Оновити імена
            </Button>
          </Group>
        </Box>
      )}

      {/* Saved-mapping summary when the preview is closed */}
      {!mappings && saved.length > 0 && (
        <Group gap="sm" mt="sm">
          <Text size="xs" c="dimmed">
            Маппінгів: {mappedCount} / {saved.length}
          </Text>
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconRefresh size={13} />}
            onClick={() => updateNames.mutate()}
            loading={updateNames.isPending}
          >
            Оновити імена
          </Button>
        </Group>
      )}
    </Paper>
  )
}

// ── ЛУМГ archive path + ЄІС codes ───────────────────────────────────────────

interface LumgRowProps {
  lumg: Lumg
  dataPath: DataPath | null
  codes: EisCode[]
  /** Codes taken by other ЛУМГ — one code may belong to only one ЛУМГ. */
  usedElsewhere: Set<string>
}

function LumgRow({ lumg, dataPath, codes, usedElsewhere }: LumgRowProps) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ path: '', active: true })
  const [open, setOpen] = useState(false)
  const [manual, setManual] = useState('')
  const [scan, setScan] = useState<string[] | null>(null)
  const [scanSearch, setScanSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'lumg-path', lumg.id] })
    qc.invalidateQueries({ queryKey: ['admin', 'lumg-eis', lumg.id] })
  }

  const savePath = useMutation({
    mutationFn: () => lumgAdminApi.setDataPath(lumg.id, form),
    onSuccess: () => {
      notifications.show({ message: 'Збережено', color: 'teal' })
      setEditing(false)
      invalidate()
    },
    onError: notifyErr,
  })

  const deletePath = useMutation({
    mutationFn: () => lumgAdminApi.deleteDataPath(lumg.id),
    onSuccess: () => {
      notifications.show({ message: 'Видалено', color: 'teal' })
      invalidate()
    },
    onError: notifyErr,
  })

  const addCode = useMutation({
    mutationFn: (code: string) => lumgAdminApi.addEisCode(lumg.id, code),
    onSuccess: () => invalidate(),
    onError: notifyErr,
  })

  const removeCode = useMutation({
    mutationFn: (code: string) => lumgAdminApi.deleteEisCode(lumg.id, code),
    onSuccess: () => invalidate(),
    onError: notifyErr,
  })

  const ownCodes = useMemo(() => new Set(codes.map((c) => c.eis_code)), [codes])

  const handleAddManual = () => {
    const code = manual.trim().toUpperCase()
    if (!code) return
    if (ownCodes.has(code)) {
      notifications.show({ message: `Код ${code} вже додано до цього ЛУМГ`, color: 'red' })
      return
    }
    if (usedElsewhere.has(code)) {
      notifications.show({ message: `Код ${code} вже привʼязаний до іншого ЛУМГ`, color: 'red' })
      return
    }
    addCode.mutate(code, { onSuccess: () => setManual('') })
  }

  const runScan = async () => {
    setScanSearch('')
    try {
      const found = await lumgAdminApi.scanEis(lumg.id)
      // Offer only what is not already claimed anywhere.
      const fresh = (found ?? []).filter((c) => !ownCodes.has(c) && !usedElsewhere.has(c))
      setScan(fresh)
      setSelected(new Set(fresh))
    } catch (e) {
      setScan([])
      notifyErr(e as Error)
    }
  }

  const filteredScan = useMemo(() => {
    if (!scan) return null
    const q = scanSearch.trim().toUpperCase()
    return q ? scan.filter((c) => c.includes(q)) : scan
  }, [scan, scanSearch])

  const addSelected = async () => {
    for (const code of selected) {
      await lumgAdminApi.addEisCode(lumg.id, code).catch(() => null)
    }
    const n = selected.size
    setScan(null)
    invalidate()
    notifications.show({ message: `Додано ${n} кодів`, color: 'teal' })
  }

  return (
    <Paper withBorder radius="md" p="sm">
      <Group gap="sm" wrap="wrap" align="center">
        <Text fw={600} size="sm" w={150}>
          {lumg.name}
        </Text>
        <Badge size="sm" variant="light" color={codes.length > 0 ? 'petrol' : 'gray'} tt="none">
          {codes.length > 0 ? `ЄІС (${codes.length})` : 'Прямий'}
        </Badge>

        {editing ? (
          <>
            <TextInput
              size="xs"
              style={{ flex: 1, minWidth: 220 }}
              value={form.path}
              onChange={(e) => setForm({ ...form, path: e.currentTarget.value })}
              placeholder="hostlibs/ZP"
            />
            <Switch
              size="xs"
              label="Активний"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.currentTarget.checked })}
            />
            <Button size="compact-xs" onClick={() => savePath.mutate()} loading={savePath.isPending}>
              Зберегти
            </Button>
            <Button size="compact-xs" variant="default" onClick={() => setEditing(false)}>
              Скасувати
            </Button>
          </>
        ) : (
          <>
            {dataPath?.path ? (
              <Code style={{ flex: 1, fontSize: 12, wordBreak: 'break-all' }}>{dataPath.path}</Code>
            ) : (
              <Text size="xs" c="dimmed" style={{ flex: 1 }}>
                Шлях не вказано
              </Text>
            )}
            <Button
              size="compact-xs"
              variant="default"
              onClick={() => {
                setForm({ path: dataPath?.path ?? '', active: dataPath?.active ?? true })
                setEditing(true)
              }}
            >
              {dataPath ? 'Редагувати' : 'Додати шлях'}
            </Button>
            {dataPath && (
              <ActionIcon
                variant="subtle"
                color="red"
                onClick={() =>
                  modals.openConfirmModal({
                    title: 'Видалити шлях',
                    children: <Text size="sm">Видалити шлях до архіву «{lumg.name}»?</Text>,
                    labels: { confirm: 'Видалити', cancel: 'Скасувати' },
                    confirmProps: { color: 'red' },
                    onConfirm: () => deletePath.mutate(),
                  })
                }
              >
                <IconTrash size={15} />
              </ActionIcon>
            )}
          </>
        )}
      </Group>

      {/* ЄІС codes */}
      <Button
        size="compact-xs"
        variant="subtle"
        mt={6}
        leftSection={
          <IconChevronRight
            size={13}
            style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
          />
        }
        onClick={() => setOpen((o) => !o)}
      >
        ЄІС коди ({codes.length})
      </Button>

      <Collapse expanded={open}>
        <Box pt="xs">
          {codes.length > 0 ? (
            <Group gap={6} mb="xs">
              {codes.map((c) => (
                <Badge
                  key={c.id}
                  variant="light"
                  color="petrol"
                  size="sm"
                  tt="none"
                  rightSection={
                    <ActionIcon
                      size="xs"
                      variant="transparent"
                      color="red"
                      onClick={() => removeCode.mutate(c.eis_code)}
                    >
                      <IconX size={11} />
                    </ActionIcon>
                  }
                >
                  {c.eis_code}
                </Badge>
              ))}
            </Group>
          ) : (
            <Text size="xs" c="dimmed" mb="xs">
              ЄІС коди не додано — архів читається напряму зі шляху
            </Text>
          )}

          <Group gap="xs" mb="xs">
            <TextInput
              size="xs"
              w={220}
              placeholder="Ввести ЄІС код вручну"
              value={manual}
              onChange={(e) => setManual(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddManual()}
            />
            <Button size="compact-xs" leftSection={<IconPlus size={13} />} onClick={handleAddManual}>
              Додати
            </Button>
            {dataPath && (
              <Button
                size="compact-xs"
                variant="light"
                leftSection={<IconScan size={13} />}
                onClick={runScan}
              >
                Сканувати архів
              </Button>
            )}
          </Group>

          {scan && scan.length > 0 && (
            <Paper withBorder radius="sm" p="xs" bg="var(--hlv-surface-2)">
              <Group gap="xs" mb="xs">
                <Text size="xs" c="dimmed">
                  Знайдено нових папок: {scan.length}
                </Text>
                <TextInput
                  size="xs"
                  style={{ flex: 1 }}
                  leftSection={<IconSearch size={13} />}
                  placeholder="Пошук коду…"
                  value={scanSearch}
                  onChange={(e) => setScanSearch(e.currentTarget.value)}
                />
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => setSelected(new Set(filteredScan ?? []))}
                >
                  Вибрати всі ({filteredScan?.length ?? 0})
                </Button>
                <Button size="compact-xs" variant="subtle" onClick={() => setSelected(new Set())}>
                  Зняти вибір
                </Button>
              </Group>
              <ScrollArea.Autosize mah={200} type="auto">
                <Group gap="xs">
                  {(filteredScan ?? []).map((code) => (
                    <Checkbox
                      key={code}
                      size="xs"
                      label={code}
                      checked={selected.has(code)}
                      onChange={() =>
                        setSelected((prev) => {
                          const s = new Set(prev)
                          if (s.has(code)) s.delete(code)
                          else s.add(code)
                          return s
                        })
                      }
                    />
                  ))}
                  {filteredScan?.length === 0 && (
                    <Text size="xs" c="dimmed">
                      Нічого не знайдено
                    </Text>
                  )}
                </Group>
              </ScrollArea.Autosize>
              <Button size="compact-xs" mt="xs" disabled={selected.size === 0} onClick={addSelected}>
                Додати вибрані ({selected.size})
              </Button>
            </Paper>
          )}
          {scan?.length === 0 && (
            <Text size="xs" c="dimmed">
              Нових папок не знайдено
            </Text>
          )}
        </Box>
      </Collapse>
    </Paper>
  )
}

// ── Tab ─────────────────────────────────────────────────────────────────────

export function DataPathsTab() {
  const { branches, lumgs } = useAdminTopology()
  const [branchId, setBranchId] = useState<string | null>(null)

  const effectiveBranchId = branchId ?? (branches.length ? String(branches[0].id) : null)
  const branch = branches.find((b) => String(b.id) === effectiveBranchId) ?? null
  const branchLumgs = useMemo(
    () => lumgs.filter((l) => String(l.branch_id) === effectiveBranchId),
    [lumgs, effectiveBranchId],
  )

  const pathQueries = useQueries({
    queries: branchLumgs.map((l) => ({
      queryKey: ['admin', 'lumg-path', l.id],
      queryFn: () => lumgAdminApi.getDataPath(l.id).catch(() => null),
    })),
  })
  const eisQueries = useQueries({
    queries: branchLumgs.map((l) => ({
      queryKey: ['admin', 'lumg-eis', l.id],
      queryFn: () => lumgAdminApi.getEisCodes(l.id).catch(() => [] as EisCode[]),
    })),
  })

  const codesByLumg = useMemo(() => {
    const m = new Map<number, EisCode[]>()
    branchLumgs.forEach((l, i) => m.set(l.id, eisQueries[i]?.data ?? []))
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchLumgs, eisQueries.map((q) => q.dataUpdatedAt).join(',')])

  const loading = pathQueries.some((q) => q.isLoading) || eisQueries.some((q) => q.isLoading)

  return (
    <Stack gap="md">
      <AdminTabHeader
        title="Шляхи до даних"
        description={
          <>
            Звідки читаються архіви (ЛУМГ, ЄІС коди) і звідки беруться назви ліній (ASK.CFG). Один ЄІС код може належати лише одному ЛУМГ
          </>
        }
      />

      <Group gap="sm" align="flex-end">
        <Select
          size="xs"
          w={280}
          label="Філія"
          data={toOptions(branches)}
          value={effectiveBranchId}
          onChange={setBranchId}
          searchable
          allowDeselect={false}
        />
        <Text size="xs" c="dimmed" pb={6}>
          ЛУМГ: {branchLumgs.length}
        </Text>
      </Group>

      {branch && <ConfigSection key={branch.id} branch={branch} lumgs={branchLumgs} />}

      <Box>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="xs" style={{ letterSpacing: 0.5 }}>
          Шляхи архівних даних — ЛУМГ
        </Text>

        {branchLumgs.length === 0 ? (
          <Alert variant="light" color="petrol" icon={<IconInfoCircle size={16} />}>
            У цій філії немає ЛУМГ
          </Alert>
        ) : loading ? (
          <Center py={30}>
            <Loader color="petrol" size="sm" />
          </Center>
        ) : (
          <Stack gap="xs">
            {branchLumgs.map((lumg, i) => {
              const own = new Set((codesByLumg.get(lumg.id) ?? []).map((c) => c.eis_code))
              const usedElsewhere = new Set<string>()
              codesByLumg.forEach((codes, id) => {
                if (id === lumg.id) return
                codes.forEach((c) => {
                  if (!own.has(c.eis_code)) usedElsewhere.add(c.eis_code)
                })
              })
              return (
                <LumgRow
                  key={lumg.id}
                  lumg={lumg}
                  dataPath={pathQueries[i]?.data ?? null}
                  codes={codesByLumg.get(lumg.id) ?? []}
                  usedElsewhere={usedElsewhere}
                />
              )
            })}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
