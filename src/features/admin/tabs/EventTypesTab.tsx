import { useEffect, useMemo, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Center,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { useDebouncedValue, useDisclosure } from '@mantine/hooks'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import {
  IconAlertTriangle,
  IconDeviceFloppy,
  IconDownload,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { sysTypeApi, editTypeApi, calcTypeAdminApi } from '@/api/admin'
import { TablePagination } from '@/components/TablePagination'
import { numericStyle } from '@/theme/theme'
import { LoadingState } from '@/components/LoadingState'

type Kind = 'sys' | 'edit'

/** Row shape common to both dictionaries (code/name differ per kind). */
interface EventTypeRow {
  id: number
  gas_volume_calc_type_id: number
  sys_type_id?: number
  sys_name?: string
  edit_type_id?: number
  edit_name?: string
}

/** The two dictionaries differ only in the names of their two columns. */
const FIELDS = {
  sys: { code: 'sys_type_id', name: 'sys_name', api: sysTypeApi, title: 'аварії' },
  edit: { code: 'edit_type_id', name: 'edit_name', api: editTypeApi, title: 'зміни' },
} as const

const QUERY_KEY = ['admin', 'event-types']

interface FormState {
  code: number | null
  calcType: string | null
  name: string
}

const EMPTY_FORM: FormState = { code: null, calcType: null, name: '' }

/** «1 запис», «674 записи», «5 записів» — the count is read in a sentence. */
function recordsWord(n: number): string {
  const ten = n % 10
  const hundred = n % 100
  if (ten === 1 && hundred !== 11) return 'запис'
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 'записи'
  return 'записів'
}

/**
 * Sys/edit type dictionaries. Both are large (thousands of rows) and served
 * paged by the backend, so the calculator-type filter and the search run
 * server-side too — filtering only the current page would be misleading. That
 * is also why this does not use CrudTable: it fetches everything at once.
 */
export function EventTypesTab() {
  const qc = useQueryClient()
  const [kind, setKind] = useState<Kind>('sys')
  const [calcType, setCalcType] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(search, 300)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [opened, { open, close }] = useDisclosure(false)
  const [editing, setEditing] = useState<EventTypeRow | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  // Required fields are only marked once Save has been pressed — a form that is
  // red before it has been touched reads as broken.
  const [attempted, setAttempted] = useState(false)

  const spec = FIELDS[kind]

  // Any filter change invalidates the current page number.
  useEffect(() => setPage(1), [kind, calcType, debouncedSearch, pageSize])

  const { data: calcTypes } = useQuery({
    queryKey: ['admin', 'calc-types'],
    queryFn: calcTypeAdminApi.getAll,
  })

  const { data, isLoading, error } = useQuery<{ total: number; items: EventTypeRow[] }>({
    queryKey: [...QUERY_KEY, kind, calcType, debouncedSearch, page, pageSize],
    placeholderData: (prev) => prev,
    queryFn: () => {
      const q = {
        skip: (page - 1) * pageSize,
        limit: pageSize,
        // The dictionaries key on the device type CODE, not the row id.
        calcTypeId: calcType ? Number(calcType) : null,
        search: debouncedSearch.trim(),
      }
      return kind === 'sys' ? sysTypeApi.getPaged(q) : editTypeApi.getPaged(q)
    },
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0

  const calcTypeOptions = useMemo(
    () =>
      (calcTypes ?? []).map((t) => ({
        value: String(t.type_id),
        label: `${t.type_name} (${t.type_id})`,
      })),
    [calcTypes],
  )
  const calcTypeName = useMemo(() => {
    const m = new Map((calcTypes ?? []).map((t) => [t.type_id, t.type_name]))
    return (code: number) => m.get(code) ?? '—'
  }, [calcTypes])

  const invalidate = () => qc.invalidateQueries({ queryKey: QUERY_KEY })

  const saveMutation = useMutation({
    mutationFn: async (values: FormState) => {
      // PATCH carries the whole row: only the name is optional in the update
      // model, the code and the calculator type are required in the body.
      const payload = {
        [spec.code]: values.code,
        gas_volume_calc_type_id: Number(values.calcType),
        [spec.name]: values.name.trim(),
      }
      return editing ? spec.api.update(editing.id, payload) : spec.api.create(payload)
    },
    onSuccess: () => {
      notifications.show({ message: 'Збережено', color: 'teal' })
      close()
      invalidate()
    },
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => spec.api.remove(id),
    onSuccess: () => {
      notifications.show({ message: 'Видалено', color: 'teal' })
      invalidate()
    },
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red' }),
  })

  const openCreate = () => {
    setEditing(null)
    setAttempted(false)
    // Pre-fill the calculator type from the filter: adding several events to
    // one device type is the normal case.
    setForm({ ...EMPTY_FORM, calcType })
    open()
  }

  const openEdit = (row: EventTypeRow) => {
    setEditing(row)
    setAttempted(false)
    setForm({
      code: (row[spec.code] as number) ?? null,
      calcType: String(row.gas_volume_calc_type_id),
      name: (row[spec.name] as string) ?? '',
    })
    open()
  }

  const missing =
    form.code == null || !form.calcType || form.name.trim() === ''

  const submit = () => {
    setAttempted(true)
    if (missing) {
      notifications.show({ message: "Заповніть обов'язкові поля", color: 'red' })
      return
    }
    saveMutation.mutate(form)
  }

  /**
   * Deleting a type is allowed — the archive keeps the bare code and joins the
   * name in at read time, so nothing breaks. But those rows stop being
   * readable, and how many there are is the one thing worth knowing first.
   */
  const confirmDelete = async (row: EventTypeRow) => {
    let used = ''
    try {
      const usage = await spec.api.usage(row.id)
      if (usage.archive_rows > 0) {
        const n = usage.capped
          ? `${usage.archive_rows}+ записів`
          : `${usage.archive_rows} ${recordsWord(usage.archive_rows)}`
        used = `В архіві ${n} з цим кодом. Вони не зникнуть, але замість назви показуватимуть код.`
      }
    } catch {
      // The count is advisory; failing to get it must not block the delete.
      used = 'Не вдалося перевірити, чи є записи архіву з цим кодом.'
    }
    modals.openConfirmModal({
      title: 'Підтвердіть видалення',
      children: (
        <Stack gap={6}>
          <Text size="sm">
            Видалити «{(row[spec.name] as string) || `#${row.id}`}»?
          </Text>
          {used && (
            <Text size="xs" c="dimmed">
              {used}
            </Text>
          )}
        </Stack>
      ),
      labels: { confirm: 'Видалити', cancel: 'Скасувати' },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(row.id),
    })
  }

  return (
    <Stack gap="sm" style={{ height: '100%' }}>
      <Group justify="space-between" wrap="wrap" gap="sm" align="flex-start">
        <Box>
          <Text fw={600} fz="lg" ff="'Space Grotesk Variable', sans-serif">
            Типи подій
          </Text>
          <Text size="xs" c="dimmed">
            Довідники аварій та змін по типах обчислювачів. Після редагування натисніть
            «Зберегти в JSON», інакше назви буде відновлено з файлів під час перезапуску
          </Text>
        </Box>
        <Group gap="xs">
          <EventTypeTransferControls />
          <Button size="xs" leftSection={<IconPlus size={16} />} onClick={openCreate}>
            Додати
          </Button>
        </Group>
      </Group>

      {/* Filters get their own row so nothing is squeezed against the panel edge. */}
      <Group gap="sm" wrap="wrap">
        <SegmentedControl
          size="xs"
          value={kind}
          onChange={(v) => setKind(v as Kind)}
          style={{ flexShrink: 0 }}
          data={[
            { value: 'sys', label: 'Аварії' },
            { value: 'edit', label: 'Зміни' },
          ]}
        />
        <Select
          size="xs"
          w={260}
          placeholder="Всі типи обчислювачів"
          data={calcTypeOptions}
          value={calcType}
          onChange={setCalcType}
          clearable
          searchable
        />
        <TextInput
          size="xs"
          w={260}
          placeholder="Пошук за кодом або назвою"
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
      </Group>

      {error && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          {(error as Error).message}
        </Alert>
      )}

      {isLoading ? (
        <LoadingState />
      ) : (
        <Box style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <ScrollArea className="hlv-table-scroll" style={{ flex: 1 }} type="auto">
            <Table striped highlightOnHover stickyHeader verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th ta="right" w={80}>
                    ID
                  </Table.Th>
                  <Table.Th ta="right" w={110}>
                    Код
                  </Table.Th>
                  <Table.Th w={220}>Тип обчислювача</Table.Th>
                  <Table.Th>Назва</Table.Th>
                  <Table.Th w={90} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((it) => (
                  <Table.Tr key={it.id}>
                    <Table.Td ta="right" style={numericStyle}>
                      {it.id}
                    </Table.Td>
                    <Table.Td ta="right" style={numericStyle}>
                      {it[spec.code] as number}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{calcTypeName(it.gas_volume_calc_type_id)}</Text>
                      <Text size="10px" c="dimmed" style={numericStyle}>
                        {it.gas_volume_calc_type_id}
                      </Text>
                    </Table.Td>
                    <Table.Td>{it[spec.name] as string}</Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <ActionIcon
                          variant="subtle"
                          onClick={() => openEdit(it)}
                          aria-label="Редагувати"
                        >
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() => confirmDelete(it)}
                          aria-label="Видалити"
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {items.length === 0 && (
              <Center py="xl">
                <Text c="dimmed" size="sm">
                  Нічого не знайдено
                </Text>
              </Center>
            )}
          </ScrollArea>
          <Divider />
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            shownLabel={`Записів: ${total.toLocaleString('uk-UA')}`}
          />
        </Box>
      )}

      <Modal
        opened={opened}
        onClose={close}
        title={editing ? `Редагування (${spec.title})` : `Новий запис (${spec.title})`}
        centered
      >
        <Stack gap="sm">
          <NumberInput
            label="Код"
            description="Номер події, яким її позначає обчислювач"
            value={form.code ?? ''}
            onChange={(v) => setForm({ ...form, code: v === '' ? null : Number(v) })}
            required
            error={attempted && form.code == null ? "Обов'язкове поле" : undefined}
          />
          <Select
            label="Тип обчислювача"
            data={calcTypeOptions}
            value={form.calcType}
            onChange={(v) => setForm({ ...form, calcType: v })}
            required
            error={attempted && !form.calcType ? "Обов'язкове поле" : undefined}
            searchable
          />
          <TextInput
            label="Назва"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
            required
            error={attempted && form.name.trim() === '' ? "Обов'язкове поле" : undefined}
          />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={close}>
              Скасувати
            </Button>
            <Button onClick={submit} loading={saveMutation.isPending}>
              Зберегти
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}

/**
 * Moving the dictionaries between installations.
 *
 * They live in the database, but the backend reloads FLOWTYPE.json,
 * SYSNAME.json and EDITNAME.json into it on every start, and those files travel
 * with the code. So «Зберегти в JSON» is not an export — it is what makes an
 * edit made here outlive the next restart, and what carries it to the offline
 * server once the files are committed. «Завантажити з JSON» is the other
 * direction, and is what the offline side runs after receiving them.
 */
function EventTypeTransferControls() {
  const qc = useQueryClient()
  const [force, setForce] = useState(false)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: QUERY_KEY })
    qc.invalidateQueries({ queryKey: ['admin', 'calc-types'] })
  }

  const counts = (res: { exported: { flowtype: number; sysname: number; editname: number } }) =>
    `Типів обчислювачів: ${res.exported.flowtype}, аварій: ${res.exported.sysname}, ` +
    `змін: ${res.exported.editname}`

  const exportJson = useMutation({
    mutationFn: calcTypeAdminApi.exportPreload,
    onSuccess: (res) =>
      notifications.show({
        title: 'Довідники збережено у JSON',
        message:
          `${counts(res)}. Щоб зміни потрапили на сервер, файли треба закомітити разом з кодом`,
        color: 'teal',
        autoClose: 8000,
      }),
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red' }),
  })

  const preload = useMutation({
    mutationFn: () => calcTypeAdminApi.preload(force),
    onSuccess: (res) => {
      notifications.show({
        title: res.wiped ? 'Довідники перезаписано з JSON' : 'Довідники оновлено з JSON',
        message: counts(res),
        color: 'teal',
        autoClose: 6000,
      })
      invalidate()
    },
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red' }),
  })

  const runPreload = () => {
    if (!force) {
      preload.mutate()
      return
    }
    modals.openConfirmModal({
      title: 'Перезаписати довідники подій',
      children: (
        <Text size="sm">
          Довідники аварій і змін буде <b>повністю очищено</b> і завантажено з SYSNAME.json та
          EDITNAME.json. Записи, додані тут і відсутні у файлах, зникнуть назавжди. Типи
          обчислювачів не чіпаються. Продовжити?
        </Text>
      ),
      labels: { confirm: 'Перезаписати', cancel: 'Скасувати' },
      confirmProps: { color: 'red' },
      onConfirm: () => preload.mutate(),
    })
  }

  return (
    <Group gap="xs" wrap="nowrap">
      <Tooltip
        label="Зберегти поточний стан довідників у FLOWTYPE.json, SYSNAME.json і EDITNAME.json — файли, які переносяться на сервер разом з кодом"
        withArrow
        multiline
        w={280}
      >
        <Button
          size="compact-xs"
          variant="default"
          leftSection={<IconDeviceFloppy size={13} />}
          onClick={() => exportJson.mutate()}
          loading={exportJson.isPending}
        >
          Зберегти в JSON
        </Button>
      </Tooltip>
      <Tooltip
        label="Завантажити довідники з JSON у базу: назви оновлюються за парою «код події + код обчислювача», відсутні записи додаються, зайві лишаються"
        withArrow
        multiline
        w={280}
      >
        <Button
          size="compact-xs"
          variant="default"
          leftSection={<IconDownload size={13} />}
          onClick={runPreload}
          loading={preload.isPending}
        >
          Завантажити з JSON
        </Button>
      </Tooltip>
      <Checkbox
        size="xs"
        label="перезаписати"
        checked={force}
        onChange={(e) => setForce(e.currentTarget.checked)}
      />
    </Group>
  )
}
