import { useMemo, useState, type ReactNode } from 'react'
import {
  Table,
  Group,
  Button,
  TextInput,
  Modal,
  Stack,
  ActionIcon,
  Text,
  Center,
  Alert,
  NumberInput,
  Checkbox,
  Select,
  Tooltip,
  Box,
  Divider,
  ScrollArea,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import {
  IconPlus,
  IconPencil,
  IconTrash,
  IconSearch,
  IconAlertTriangle,
  IconRefresh,
} from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { numericStyle } from '@/theme/theme'
import { TablePagination } from '@/components/TablePagination'
import { LoadingState } from '@/components/LoadingState'

export interface CrudField<T> {
  key: string
  label: string
  type?: 'text' | 'number' | 'checkbox' | 'select'
  options?: { value: string; label: string }[]
  required?: boolean
  /** Hide from the table body (still editable in the form). */
  hideInTable?: boolean
  /** Hide from the create/edit form (e.g. computed columns). */
  hideInForm?: boolean
  numeric?: boolean
  /** Select whose value must be sent as a number (foreign keys). */
  numericValue?: boolean
  render?: (row: T) => ReactNode
}

export interface CrudTableProps<T extends { id: number }> {
  title: string
  description?: string
  queryKey: unknown[]
  fetchAll: () => Promise<T[]>
  create?: (data: Record<string, unknown>) => Promise<unknown>
  update?: (id: number, data: Record<string, unknown>) => Promise<unknown>
  remove?: (id: number) => Promise<unknown>
  fields: CrudField<T>[]
  /** Field keys searched by the filter box. */
  searchKeys?: string[]
  rowLabel?: (row: T) => string
  extraRowActions?: (row: T) => ReactNode
  /** Controls rendered in the toolbar, e.g. branch/calc filters. */
  toolbarExtra?: ReactNode
  /** Row predicate applied before the search box, for those toolbar filters. */
  filter?: (row: T) => boolean
  /** Values merged into the payload of every create (e.g. a pre-selected branch). */
  createDefaults?: Record<string, unknown>
}

const PAGE_SIZE_DEFAULT = 50

/**
 * Generic admin CRUD table: search, pagination, create/edit modal built from a
 * field spec, and delete confirmation. Powers most reference/entity tabs.
 */
export function CrudTable<T extends { id: number }>({
  title,
  description,
  queryKey,
  fetchAll,
  create,
  update,
  remove,
  fields,
  searchKeys,
  rowLabel,
  extraRowActions,
  toolbarExtra,
  filter,
  createDefaults,
}: CrudTableProps<T>) {
  const qc = useQueryClient()
  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey, queryFn: fetchAll })
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)
  const [opened, { open, close }] = useDisclosure(false)
  const [editing, setEditing] = useState<T | null>(null)
  const [form, setForm] = useState<Record<string, unknown>>({})

  const invalidate = () => qc.invalidateQueries({ queryKey })

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      if (editing && update) return update(editing.id, values)
      if (!editing && create) return create(values)
      throw new Error('Операція недоступна')
    },
    onSuccess: () => {
      notifications.show({ message: 'Збережено', color: 'teal' })
      close()
      invalidate()
    },
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => remove!(id),
    onSuccess: () => {
      notifications.show({ message: 'Видалено', color: 'teal' })
      invalidate()
    },
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red' }),
  })

  const rows = useMemo(() => {
    const all = filter ? (data ?? []).filter(filter) : (data ?? [])
    const q = search.trim().toLowerCase()
    if (!q) return all
    const keys = searchKeys ?? fields.map((f) => f.key)
    return all.filter((row) =>
      keys.some((k) => String((row as Record<string, unknown>)[k] ?? '').toLowerCase().includes(q)),
    )
  }, [data, search, searchKeys, fields, filter])

  const pageRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  )

  const openCreate = () => {
    setEditing(null)
    const init: Record<string, unknown> = {}
    fields.forEach((f) => {
      if (f.type === 'checkbox') init[f.key] = false
    })
    setForm({ ...init, ...createDefaults })
    open()
  }

  const openEdit = (row: T) => {
    setEditing(row)
    const init: Record<string, unknown> = {}
    fields.forEach((f) => {
      init[f.key] = (row as Record<string, unknown>)[f.key]
    })
    setForm(init)
    open()
  }

  const confirmDelete = (row: T) =>
    modals.openConfirmModal({
      title: 'Підтвердіть видалення',
      children: <Text size="sm">Видалити «{rowLabel ? rowLabel(row) : `#${row.id}`}»?</Text>,
      labels: { confirm: 'Видалити', cancel: 'Скасувати' },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(row.id),
    })

  const tableFields = fields.filter((f) => !f.hideInTable)
  const formFields = fields.filter((f) => !f.hideInForm)
  const canEdit = !!update
  const canDelete = !!remove
  const hasActions = canEdit || canDelete || !!extraRowActions

  return (
    <Stack gap="sm" style={{ height: '100%' }}>
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Box>
          <Text fw={600} fz="lg" ff="'Space Grotesk Variable', sans-serif">
            {title}
          </Text>
          {description && (
            <Text size="xs" c="dimmed">
              {description}
            </Text>
          )}
        </Box>
        <Group gap="xs">
          {toolbarExtra}
          <TextInput
            placeholder="Пошук..."
            leftSection={<IconSearch size={15} />}
            value={search}
            onChange={(e) => {
              setSearch(e.currentTarget.value)
              setPage(1)
            }}
            size="xs"
            w={220}
          />
          <Tooltip label="Оновити">
            <ActionIcon variant="default" size="lg" onClick={() => refetch()} loading={isFetching}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          {create && (
            <Button size="xs" leftSection={<IconPlus size={16} />} onClick={openCreate}>
              Додати
            </Button>
          )}
        </Group>
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
                  {tableFields.map((f) => (
                    <Table.Th key={f.key} style={{ textAlign: f.numeric ? 'right' : 'left' }}>
                      {f.label}
                    </Table.Th>
                  ))}
                  {hasActions && <Table.Th w={110} />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pageRows.map((row) => (
                  <Table.Tr key={row.id}>
                    {tableFields.map((f) => {
                      const raw = (row as Record<string, unknown>)[f.key]
                      return (
                        <Table.Td
                          key={f.key}
                          style={{
                            textAlign: f.numeric ? 'right' : 'left',
                            ...(f.numeric ? numericStyle : {}),
                          }}
                        >
                          {f.render
                            ? f.render(row)
                            : f.type === 'checkbox'
                              ? raw
                                ? '✓'
                                : '—'
                              : raw == null || raw === ''
                                ? '—'
                                : String(raw)}
                        </Table.Td>
                      )
                    })}
                    {hasActions && (
                      <Table.Td>
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                          {extraRowActions?.(row)}
                          {canEdit && (
                            <ActionIcon variant="subtle" onClick={() => openEdit(row)} aria-label="Редагувати">
                              <IconPencil size={16} />
                            </ActionIcon>
                          )}
                          {canDelete && (
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              onClick={() => confirmDelete(row)}
                              aria-label="Видалити"
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          )}
                        </Group>
                      </Table.Td>
                    )}
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
        </Box>
      )}

      <Modal opened={opened} onClose={close} title={editing ? 'Редагування' : 'Новий запис'} centered>
        <Stack gap="sm">
          {formFields.map((f) => {
            const value = form[f.key]
            if (f.type === 'checkbox') {
              return (
                <Checkbox
                  key={f.key}
                  label={f.label}
                  checked={!!value}
                  onChange={(e) => setForm({ ...form, [f.key]: e.currentTarget.checked })}
                />
              )
            }
            if (f.type === 'select') {
              return (
                <Select
                  key={f.key}
                  label={f.label}
                  data={f.options ?? []}
                  value={value == null ? null : String(value)}
                  onChange={(v) =>
                    setForm({ ...form, [f.key]: v && f.numericValue ? Number(v) : v })
                  }
                  required={f.required}
                  searchable
                  clearable
                />
              )
            }
            if (f.type === 'number') {
              return (
                <NumberInput
                  key={f.key}
                  label={f.label}
                  value={value == null ? '' : Number(value)}
                  onChange={(v) => setForm({ ...form, [f.key]: v === '' ? null : Number(v) })}
                  required={f.required}
                />
              )
            }
            return (
              <TextInput
                key={f.key}
                label={f.label}
                value={value == null ? '' : String(value)}
                onChange={(e) => setForm({ ...form, [f.key]: e.currentTarget.value })}
                required={f.required}
              />
            )
          })}
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={close}>
              Скасувати
            </Button>
            <Button onClick={() => saveMutation.mutate(form)} loading={saveMutation.isPending}>
              Зберегти
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
