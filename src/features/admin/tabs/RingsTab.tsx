import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Modal,
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
import { useDisclosure } from '@mantine/hooks'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import {
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dpdLineAdminApi, virtualLineAdminApi } from '@/api/admin'
import { invalidateTopology } from '@/lib/invalidateTopology'
import type { VirtualLine } from '@/types'
import { useAdminTopology, toOptions } from '../useAdminTopology'
import { LoadingState } from '@/components/LoadingState'

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })

interface FormState {
  name: string
  description: string
  branch_id: string | null
  lumg_id: string | null
  physical_line_ids: number[]
}

const EMPTY: FormState = {
  name: '',
  description: '',
  branch_id: null,
  lumg_id: null,
  physical_line_ids: [],
}

/**
 * Кільця — a ring is a named sum of several real lines. Its whole point is the
 * member list, so the editor is a form with a line picker rather than a plain
 * CRUD row. Rings behave like lines downstream: archives, reports, trends and
 * the night report all see them.
 */
export function RingsTab() {
  const qc = useQueryClient()
  const { branches, lumgs, calcs, lines, lumgName, branchName } = useAdminTopology()

  const { data: rings, isLoading } = useQuery({
    queryKey: ['admin', 'virtual-lines'],
    queryFn: virtualLineAdminApi.getAll,
  })
  const { data: dpdLines } = useQuery({
    queryKey: ['admin', 'dpd-lines'],
    queryFn: () => dpdLineAdminApi.getAll().catch(() => []),
  })

  const [form, setForm] = useState<FormState>(EMPTY)
  const [editId, setEditId] = useState<number | null>(null)
  const [branchFilter, setBranchFilter] = useState<string | null>(null)
  const [pickerOpened, picker] = useDisclosure(false)
  const [pickerSearch, setPickerSearch] = useState('')

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'virtual-lines'] })
    // Rings are lines everywhere else — the trees must pick the change up now.
    invalidateTopology(qc)
  }

  const save = useMutation({
    mutationFn: (payload: Partial<VirtualLine>) =>
      editId ? virtualLineAdminApi.update(editId, payload) : virtualLineAdminApi.create(payload),
    onSuccess: () => {
      notifications.show({ message: editId ? 'Оновлено' : 'Кільце створено', color: 'teal' })
      reset()
      invalidate()
    },
    onError: notifyErr,
  })

  const remove = useMutation({
    mutationFn: (id: number) => virtualLineAdminApi.remove(id),
    onSuccess: () => {
      notifications.show({ message: 'Видалено', color: 'teal' })
      invalidate()
    },
    onError: notifyErr,
  })

  // Flags flip in place; the API wants the whole object back.
  const toggleFlag = useMutation({
    mutationFn: ({ ring, field }: { ring: VirtualLine; field: keyof VirtualLine }) =>
      virtualLineAdminApi.update(ring.id, {
        name: ring.name,
        description: ring.description,
        branch_id: ring.branch_id,
        lumg_id: ring.lumg_id,
        active: ring.active,
        include_in_trends: ring.include_in_trends,
        include_in_report: ring.include_in_report,
        physical_line_ids: ring.physical_line_ids ?? [],
        [field]: !ring[field],
      }),
    onSuccess: invalidate,
    onError: notifyErr,
  })

  const reset = () => {
    setForm(EMPTY)
    setEditId(null)
    setPickerSearch('')
  }

  const branchLumgs = useMemo(
    () => (form.branch_id ? lumgs.filter((l) => String(l.branch_id) === form.branch_id) : lumgs),
    [lumgs, form.branch_id],
  )

  /** DPD lines are pickable members too — they are shown with a [ДПД] prefix. */
  const memberCandidates = useMemo(() => {
    const dpd = (dpdLines ?? []).map((d) => ({
      id: d.id,
      name: `[ДПД] ${d.name}`,
      isDpd: true,
      lumg_id: d.lumg_id,
      branch_id: d.branch_id,
      gas_volume_calc_id: null as number | null,
    }))
    const phys = lines.map((l) => ({
      id: l.id,
      name: l.name,
      isDpd: false,
      lumg_id: null as number | null,
      branch_id: null as number | null,
      gas_volume_calc_id: l.gas_volume_calc_id ?? null,
    }))
    return [...phys, ...dpd]
  }, [lines, dpdLines])

  const nameOfMember = useMemo(() => {
    const m = new Map(memberCandidates.map((c) => [c.id + (c.isDpd ? 1e9 : 0), c.name]))
    return (id: number) => m.get(id) ?? m.get(id + 1e9) ?? String(id)
  }, [memberCandidates])

  // Only members of the selected ЛУМГ are offered — a ring never spans ЛУМГ.
  const availableMembers = useMemo(() => {
    const lumgId = form.lumg_id ? Number(form.lumg_id) : null
    const branchId = form.branch_id ? Number(form.branch_id) : null
    const lumgCalcIds = lumgId
      ? new Set(calcs.filter((c) => c.lumg_id === lumgId).map((c) => c.id))
      : null
    const q = pickerSearch.trim().toLowerCase()
    return memberCandidates.filter((c) => {
      if (form.physical_line_ids.includes(c.id)) return false
      if (c.isDpd) {
        const byLumg = lumgId != null && c.lumg_id === lumgId
        const byBranch = c.lumg_id == null && branchId != null && c.branch_id === branchId
        if (!byLumg && !byBranch) return false
      } else if (lumgCalcIds && (c.gas_volume_calc_id == null || !lumgCalcIds.has(c.gas_volume_calc_id))) {
        return false
      }
      if (!q) return true
      return String(c.id).includes(q) || c.name.toLowerCase().includes(q)
    })
  }, [memberCandidates, form, calcs, pickerSearch])

  const startEdit = (ring: VirtualLine) => {
    setEditId(ring.id)
    setForm({
      name: ring.name,
      description: ring.description ?? '',
      branch_id: ring.branch_id != null ? String(ring.branch_id) : null,
      lumg_id: ring.lumg_id != null ? String(ring.lumg_id) : null,
      physical_line_ids: ring.physical_line_ids ?? [],
    })
  }

  const submit = () => {
    if (!form.name || !form.branch_id || !form.lumg_id) {
      notifications.show({ message: 'Заповніть назву, філію та ЛУМГ', color: 'red' })
      return
    }
    const existing = editId ? rings?.find((r) => r.id === editId) : null
    save.mutate({
      name: form.name,
      description: form.description || null,
      branch_id: Number(form.branch_id),
      lumg_id: Number(form.lumg_id),
      active: existing ? existing.active : true,
      include_in_trends: existing ? existing.include_in_trends : false,
      include_in_report: existing ? existing.include_in_report : false,
      physical_line_ids: form.physical_line_ids,
    })
  }

  // Sorted by id, and deliberately not by anything that a switch can change:
  // the list used to reshuffle on every toggle, because the endpoint returned
  // rows in heap order and an UPDATE moves the touched row to the end.
  const visibleRings = useMemo(
    () =>
      (rings ?? [])
        .filter((r) => !branchFilter || String(r.branch_id) === branchFilter)
        .slice()
        .sort((a, b) => a.id - b.id),
    [rings, branchFilter],
  )

  return (
    <Stack gap="md">
      <Box>
        <Text fw={600} fz="lg" ff="'Space Grotesk Variable', sans-serif">
          Кільця
        </Text>
        <Text size="xs" c="dimmed">
          Кільце підсумовує обрані лінії й далі поводиться як звичайна лінія — видиме в архівах,
          звітах, трендах і нічних витратах
        </Text>
      </Box>

      {/* Editor */}
      <Paper withBorder radius="md" p="md">
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
              required
            />
          </Group>

          <Box>
            <Text size="xs" fw={500} mb={4}>
              Лінії кільця
            </Text>
            <Group
              gap={6}
              p="xs"
              style={{
                minHeight: 40,
                background: 'var(--hlv-surface-2)',
                border: '1px solid var(--hlv-border)',
                borderRadius: 8,
              }}
            >
              {form.physical_line_ids.length === 0 && (
                <Text size="xs" c="dimmed">
                  Немає ліній
                </Text>
              )}
              {form.physical_line_ids.map((id) => (
                <Badge
                  key={id}
                  variant="light"
                  color="petrol"
                  size="lg"
                  tt="none"
                  rightSection={
                    <ActionIcon
                      size="xs"
                      variant="transparent"
                      color="red"
                      onClick={() =>
                        setForm({
                          ...form,
                          physical_line_ids: form.physical_line_ids.filter((x) => x !== id),
                        })
                      }
                    >
                      <IconX size={12} />
                    </ActionIcon>
                  }
                >
                  {nameOfMember(id)}
                </Badge>
              ))}
              <Tooltip
                label="Спочатку оберіть філію та ЛУМГ"
                disabled={!!form.branch_id && !!form.lumg_id}
                withArrow
              >
                <Button
                  size="compact-xs"
                  variant="light"
                  leftSection={<IconPlus size={13} />}
                  disabled={!form.branch_id || !form.lumg_id}
                  onClick={() => {
                    setPickerSearch('')
                    picker.open()
                  }}
                >
                  Додати
                </Button>
              </Tooltip>
            </Group>
          </Box>

          <Group gap="sm">
            <Button size="xs" onClick={submit} loading={save.isPending}>
              {editId ? 'Зберегти' : 'Створити'}
            </Button>
            {editId && (
              <Button size="xs" variant="default" onClick={reset}>
                Скасувати
              </Button>
            )}
          </Group>
        </Stack>
      </Paper>

      {/* List */}
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Кілець: {visibleRings.length}
        </Text>
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
                  <Table.Th>Філія</Table.Th>
                  <Table.Th>ЛУМГ</Table.Th>
                  <Table.Th ta="center">Ліній</Table.Th>
                  {/* No "У звіт": nothing reads include_in_report for a ring.
                      The overview builds from physical and DPD lines only, and
                      the night report takes every ring regardless — so the
                      switch promised a setting that did not exist. */}
                  <Table.Th ta="center">У тренди</Table.Th>
                  <Table.Th ta="center">Активне</Table.Th>
                  <Table.Th w={80} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visibleRings.map((ring) => (
                  <Table.Tr key={ring.id} bg={editId === ring.id ? 'var(--hlv-surface-2)' : undefined}>
                    <Table.Td c="dimmed">{ring.id}</Table.Td>
                    <Table.Td>
                      <Text size="sm">{ring.name}</Text>
                      {ring.description && (
                        <Text size="10px" c="dimmed">
                          {ring.description}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td c="dimmed">{branchName(ring.branch_id)}</Table.Td>
                    <Table.Td c="dimmed">{lumgName(ring.lumg_id)}</Table.Td>
                    <Table.Td ta="center">{(ring.physical_line_ids ?? []).length}</Table.Td>
                    {(['include_in_trends', 'active'] as const).map((field) => (
                      <Table.Td key={field} ta="center">
                        <Switch
                          size="xs"
                          color="petrol"
                          checked={!!ring[field]}
                          onChange={() => toggleFlag.mutate({ ring, field })}
                          styles={{ track: { cursor: 'pointer' } }}
                        />
                      </Table.Td>
                    ))}
                    <Table.Td>
                      <Group gap={2} justify="flex-end" wrap="nowrap">
                        <ActionIcon variant="subtle" onClick={() => startEdit(ring)}>
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() =>
                            modals.openConfirmModal({
                              title: 'Видалити кільце',
                              children: <Text size="sm">Видалити «{ring.name}»?</Text>,
                              labels: { confirm: 'Видалити', cancel: 'Скасувати' },
                              confirmProps: { color: 'red' },
                              onConfirm: () => remove.mutate(ring.id),
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
            {visibleRings.length === 0 && (
              <Center py="xl">
                <Text c="dimmed" size="sm">
                  Немає кілець — створіть перше вище
                </Text>
              </Center>
            )}
          </ScrollArea>
        </Paper>
      )}

      <Modal opened={pickerOpened} onClose={picker.close} title="Додати лінію до кільця" centered>
        <TextInput
          placeholder="Пошук по ID або назві…"
          leftSection={<IconSearch size={15} />}
          value={pickerSearch}
          onChange={(e) => setPickerSearch(e.currentTarget.value)}
          data-autofocus
          mb="xs"
        />
        <ScrollArea.Autosize mah={340} type="auto">
          <Stack gap={2}>
            {availableMembers.length === 0 && (
              <Text size="xs" c="dimmed" ta="center" py="sm">
                Нічого не знайдено
              </Text>
            )}
            {availableMembers.map((c) => (
              <Group
                key={`${c.isDpd ? 'd' : 'p'}-${c.id}`}
                justify="space-between"
                px="xs"
                py={5}
                className="hlv-picker-row"
                style={{ borderRadius: 6, cursor: 'pointer' }}
                onClick={() => {
                  setForm((f) => ({ ...f, physical_line_ids: [...f.physical_line_ids, c.id] }))
                  setPickerSearch('')
                }}
              >
                <Text size="sm">
                  <Text span c="dimmed" mr={6}>
                    {c.id}
                  </Text>
                  {c.name}
                </Text>
                <IconPlus size={14} />
              </Group>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      </Modal>
    </Stack>
  )
}
