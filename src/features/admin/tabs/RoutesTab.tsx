import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
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
  IconFlask,
  IconInfoCircle,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { gasRouteAdminApi } from '@/api/admin'
import { LoadingState } from '@/components/LoadingState'
import type { GasRoute, GasRouteMember } from '@/types'
import { useAdminTopology, toOptions } from '../useAdminTopology'

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })

interface FormState {
  number: string
  name: string
  description: string
  branch_id: string | null
  members: GasRouteMember[]
}

const EMPTY: FormState = {
  number: '',
  name: '',
  description: '',
  branch_id: null,
  members: [],
}

/**
 * Маршрути — the lines along which the same gas moves, so their ФХП must
 * agree. A line belongs to at most one route, which is why the picker offers
 * only the lines no other route has claimed.
 *
 * Members carry a per-row flag rather than being plain chips: «потоковий
 * хроматограф» marks the lines the «Звірка ФХП» report treats as the reference.
 */
export function RoutesTab() {
  const qc = useQueryClient()
  const { branches, lines, calcName, branchName, isLoading } = useAdminTopology()

  const [form, setForm] = useState<FormState>(EMPTY)
  const [editId, setEditId] = useState<number | null>(null)
  const [branchFilter, setBranchFilter] = useState<string | null>(null)
  const [pickerOpened, picker] = useDisclosure(false)
  const [pickerSearch, setPickerSearch] = useState('')

  const routes = useQuery({
    queryKey: ['admin', 'gas-routes'],
    queryFn: () => gasRouteAdminApi.getAll(),
  })

  const freeLines = useQuery({
    queryKey: ['admin', 'gas-routes', 'free-lines', form.branch_id, editId],
    queryFn: () =>
      gasRouteAdminApi.freeLines(Number(form.branch_id), editId ?? undefined),
    enabled: form.branch_id !== null && pickerOpened,
  })

  // Routes are not lines downstream — nothing outside admin lists them — so
  // there is no topology to invalidate here.
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'gas-routes'] })

  const save = useMutation({
    mutationFn: (payload: Partial<GasRoute>) =>
      editId ? gasRouteAdminApi.update(editId, payload) : gasRouteAdminApi.create(payload),
    onSuccess: () => {
      invalidate()
      reset()
      notifications.show({ message: 'Збережено', color: 'teal' })
    },
    onError: notifyErr,
  })

  const remove = useMutation({
    mutationFn: (id: number) => gasRouteAdminApi.remove(id),
    onSuccess: () => {
      invalidate()
      notifications.show({ message: 'Видалено', color: 'teal' })
    },
    onError: notifyErr,
  })

  const toggleActive = useMutation({
    mutationFn: ({ route, active }: { route: GasRoute; active: boolean }) =>
      gasRouteAdminApi.update(route.id, {
        number: route.number,
        name: route.name,
        description: route.description,
        branch_id: route.branch_id,
        active,
        members: route.members.map((m) => ({
          line_id: m.line_id,
          is_reference: m.is_reference,
        })),
      }),
    onSuccess: invalidate,
    onError: notifyErr,
  })

  const reset = () => {
    setForm(EMPTY)
    setEditId(null)
  }

  const startEdit = (route: GasRoute) => {
    setEditId(route.id)
    setForm({
      number: route.number,
      name: route.name ?? '',
      description: route.description ?? '',
      branch_id: String(route.branch_id),
      members: route.members.map((m) => ({
        line_id: m.line_id,
        is_reference: m.is_reference,
        line_name: m.line_name,
      })),
    })
  }

  const submit = () => {
    if (!form.number.trim()) {
      notifications.show({ message: 'Вкажіть номер маршруту', color: 'red' })
      return
    }
    if (!form.branch_id) {
      notifications.show({ message: 'Оберіть філію', color: 'red' })
      return
    }
    save.mutate({
      number: form.number.trim(),
      name: form.name.trim() || null,
      description: form.description.trim() || null,
      branch_id: Number(form.branch_id),
      active: true,
      members: form.members.map((m) => ({
        line_id: m.line_id,
        is_reference: m.is_reference,
      })),
    })
  }

  const lineLabel = useMemo(() => {
    const byId = new Map(lines.map((l) => [l.id, l]))
    return (member: GasRouteMember) => {
      const line = byId.get(member.line_id)
      if (!line) return member.line_name ?? `Лінія ${member.line_id}`
      const calc = calcName(line.gas_volume_calc_id)
      return calc === '—' ? line.name : `${calc} · ${line.name}`
    }
  }, [lines, calcName])

  const pickerCandidates = useMemo(() => {
    const taken = new Set(form.members.map((m) => m.line_id))
    const q = pickerSearch.trim().toLowerCase()
    return (freeLines.data ?? [])
      .filter((l) => !taken.has(l.id))
      .filter((l) =>
        !q ||
        String(l.id).includes(q) ||
        l.name.toLowerCase().includes(q) ||
        (l.calc_name ?? '').toLowerCase().includes(q),
      )
  }, [freeLines.data, form.members, pickerSearch])

  const refCount = form.members.filter((m) => m.is_reference).length

  const visibleRoutes = useMemo(() => {
    const all = [...(routes.data ?? [])].sort(
      (a, b) => a.number.localeCompare(b.number, 'uk') || a.id - b.id,
    )
    return branchFilter ? all.filter((r) => r.branch_id === Number(branchFilter)) : all
  }, [routes.data, branchFilter])

  if (isLoading || routes.isLoading) return <LoadingState py={40} />

  return (
    <Stack gap="md">
      <Box>
        <Text fw={600} fz="lg" ff="'Space Grotesk Variable', sans-serif">
          Маршрути
        </Text>
        <Text size="xs" c="dimmed">
          Маршрут — це лінії, якими рухається один і той самий газ, тож їхнє ФХП має збігатися.
          Лінія може входити лише до одного маршруту. Позначені лінії мають потоковий хроматограф
          і є еталоном у звіті «Звірка ФХП»
        </Text>
      </Box>

      {/* Editor */}
      <Paper withBorder radius="md" p="md">
        <Stack gap="sm">
          <Group gap="sm" align="flex-end" wrap="wrap">
            <TextInput
              label="Номер"
              size="xs"
              w={110}
              placeholder="301"
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.currentTarget.value })}
              required
            />
            <TextInput
              label="Назва"
              size="xs"
              w={220}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
              placeholder="Необов'язково"
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
              // Members must come from the route's own branch, so switching it
              // cannot keep the current selection.
              onChange={(v) => setForm({ ...form, branch_id: v, members: [] })}
              searchable
              required
            />
          </Group>

          <Box>
            <Text size="xs" fw={500} mb={4}>
              Лінії маршруту
            </Text>
            <Stack gap={6}>
              {form.members.length === 0 && (
                <Text size="xs" c="dimmed">
                  Немає ліній
                </Text>
              )}
              {form.members.map((member, idx) => (
                <Group
                  key={member.line_id}
                  gap="sm"
                  align="center"
                  wrap="wrap"
                  p="xs"
                  style={{
                    background: 'var(--hlv-surface-2)',
                    border: '1px solid var(--hlv-border)',
                    borderRadius: 8,
                  }}
                >
                  <Text size="xs" c="dimmed" w={28}>
                    {idx + 1}
                  </Text>
                  <Text size="sm" style={{ flex: 1, minWidth: 200 }}>
                    {lineLabel(member)}
                  </Text>
                  <Checkbox
                    size="xs"
                    label="Потоковий хроматограф"
                    checked={member.is_reference}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked
                      setForm((f) => ({
                        ...f,
                        members: f.members.map((m, i) =>
                          i === idx ? { ...m, is_reference: checked } : m,
                        ),
                      }))
                    }}
                  />
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        members: f.members.filter((_, i) => i !== idx),
                      }))
                    }
                  >
                    <IconX size={14} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>

            <Button
              size="compact-xs"
              variant="light"
              mt="xs"
              leftSection={<IconPlus size={13} />}
              disabled={!form.branch_id}
              onClick={() => {
                setPickerSearch('')
                picker.open()
              }}
            >
              Додати лінію
            </Button>

            {form.members.length > 0 && refCount === 0 && (
              <Alert
                mt="xs"
                color="yellow"
                variant="light"
                icon={<IconInfoCircle size={16} />}
                p="xs"
              >
                <Text size="xs">
                  Маршрут без хроматографа — звіт покаже лише значення та розкид між лініями
                </Text>
              </Alert>
            )}
            {refCount > 0 && (
              <Text size="xs" c="dimmed" mt={6}>
                Еталон: {refCount}{' '}
                {refCount === 1 ? 'лінія' : refCount < 5 ? 'лінії' : 'ліній'} з хроматографом
              </Text>
            )}
          </Box>

          <Group gap="xs">
            <Button size="xs" color="petrol" onClick={submit} loading={save.isPending}>
              {editId ? 'Зберегти' : 'Створити'}
            </Button>
            {editId && (
              <Button size="xs" variant="subtle" onClick={reset}>
                Скасувати
              </Button>
            )}
          </Group>
        </Stack>
      </Paper>

      {/* List */}
      <Group gap="sm">
        <Select
          size="xs"
          w={220}
          placeholder="Усі філії"
          data={toOptions(branches)}
          value={branchFilter}
          onChange={setBranchFilter}
          clearable
          searchable
        />
      </Group>

      <Paper withBorder radius="md">
        <ScrollArea className="hlv-table-scroll">
          <Table striped highlightOnHover verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={60}>ID</Table.Th>
                <Table.Th w={80}>№</Table.Th>
                <Table.Th>Назва</Table.Th>
                <Table.Th>Філія</Table.Th>
                <Table.Th w={80}>Ліній</Table.Th>
                <Table.Th w={150}>З хроматографом</Table.Th>
                <Table.Th w={100}>Активний</Table.Th>
                <Table.Th w={90} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visibleRoutes.map((route) => {
                const refs = route.members.filter((m) => m.is_reference)
                return (
                  <Table.Tr key={route.id}>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {route.id}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {route.number}
                      </Text>
                    </Table.Td>
                    <Table.Td>{route.name || '—'}</Table.Td>
                    <Table.Td>{branchName(route.branch_id)}</Table.Td>
                    <Table.Td>{route.members.length}</Table.Td>
                    <Table.Td>
                      {refs.length === 0 ? (
                        <Text size="xs" c="dimmed">
                          немає
                        </Text>
                      ) : (
                        <Tooltip
                          label={refs.map((m) => m.line_name).join(', ')}
                          multiline
                          w={260}
                        >
                          <Badge
                            variant="light"
                            color="petrol"
                            leftSection={<IconFlask size={12} />}
                          >
                            {refs.length}
                          </Badge>
                        </Tooltip>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Switch
                        size="xs"
                        checked={route.active}
                        onChange={(e) =>
                          toggleActive.mutate({
                            route,
                            active: e.currentTarget.checked,
                          })
                        }
                      />
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end">
                        <ActionIcon size="sm" variant="subtle" onClick={() => startEdit(route)}>
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="red"
                          onClick={() =>
                            modals.openConfirmModal({
                              title: `Видалити маршрут № ${route.number}?`,
                              children: (
                                <Text size="sm">
                                  Лінії залишаться, але звірка ФХП по цьому маршруту стане
                                  недоступною
                                </Text>
                              ),
                              labels: { confirm: 'Видалити', cancel: 'Скасувати' },
                              confirmProps: { color: 'red' },
                              onConfirm: () => remove.mutate(route.id),
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
          {visibleRoutes.length === 0 && (
            <Center py="xl">
              <Text c="dimmed" size="sm">
                Немає маршрутів — створіть перший вище
              </Text>
            </Center>
          )}
        </ScrollArea>
      </Paper>

      <Modal
        opened={pickerOpened}
        onClose={picker.close}
        title="Додати лінію до маршруту"
        centered
      >
        <TextInput
          placeholder="Пошук по ID, ГРС або назві…"
          leftSection={<IconSearch size={15} />}
          value={pickerSearch}
          onChange={(e) => setPickerSearch(e.currentTarget.value)}
          data-autofocus
          mb="xs"
        />
        <ScrollArea.Autosize mah={340} type="auto">
          <Stack gap={2}>
            {freeLines.isLoading && <LoadingState py={20} />}
            {!freeLines.isLoading && pickerCandidates.length === 0 && (
              <Text size="xs" c="dimmed" ta="center" py="sm">
                Немає вільних ліній — усі вже входять до інших маршрутів
              </Text>
            )}
            {pickerCandidates.map((line) => (
              <Group
                key={line.id}
                justify="space-between"
                px="xs"
                py={5}
                className="hlv-picker-row"
                style={{ borderRadius: 6, cursor: 'pointer' }}
                onClick={() => {
                  setForm((f) => ({
                    ...f,
                    members: [
                      ...f.members,
                      { line_id: line.id, is_reference: false, line_name: line.name },
                    ],
                  }))
                  setPickerSearch('')
                }}
              >
                <Text size="sm">
                  <Text span c="dimmed" mr={6}>
                    {line.id}
                  </Text>
                  {line.calc_name ? `${line.calc_name} · ${line.name}` : line.name}
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
