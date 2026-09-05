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
import { invalidateTopology } from '@/lib/invalidateTopology'
import { numericStyle } from '@/theme/theme'
import { TablePagination } from '@/components/TablePagination'
import { LoadingState } from '@/components/LoadingState'
import { isFieldMissing, missingFieldLabels } from './crudValidation'

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
  /**
   * Options computed from the form as it stands, for a select that depends on
   * another one — філія → обчислювач → лінія. Wins over `options`.
   */
  optionsFor?: (form: Record<string, unknown>) => { value: string; label: string }[]
  /**
   * Draw this field yourself. The escape hatch for anything the four built-in
   * types cannot express — a member list, a branch-access picker, a nested
   * sub-form — without which a tab needing ONE such field had to reimplement
   * the whole table to get it.
   */
  renderField?: (
    value: unknown,
    onChange: (next: unknown) => void,
    form: Record<string, unknown>,
  ) => ReactNode
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
  /**
   * Row order. Defaults to `id`, which is what the admin panel needs: several
   * of these endpoints return rows in Postgres heap order, so editing a row
   * moved it to the end of the list and everything below it shifted up.
   */
  sortBy?: (row: T) => number | string
  /**
   * Row → form values, when the form is not simply the row's own fields.
   * Defaults to copying each field key across.
   */
  toForm?: (row: T) => Record<string, unknown>
  /**
   * Form values → request body, when the API does not read and write the same
   * shape. UsersTab is the case that forced this: it READS `allowed_branch_ids`
   * and WRITES `branch_ids`, so a symmetric table could never save it.
   */
  toPayload?: (values: Record<string, unknown>) => Record<string, unknown>
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
  sortBy = (row) => row.id,
  toForm,
  toPayload,
}: CrudTableProps<T>) {
  const qc = useQueryClient()
  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey, queryFn: fetchAll })
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)
  const [opened, { open, close }] = useDisclosure(false)
  const [editing, setEditing] = useState<T | null>(null)
  const [form, setForm] = useState<Record<string, unknown>>({})
  // Required fields are only marked once Save has been pressed: an asterisk is
  // enough before that, and a form that is red before it has been touched reads
  // as broken.
  const [attempted, setAttempted] = useState(false)

  // The tab's own list, plus every screen that shows these names — a renamed
  // line has to reach the archive tree without a reload.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey })
    invalidateTopology(qc)
  }

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
    let all = filter ? (data ?? []).filter(filter) : (data ?? [])
    const q = search.trim().toLowerCase()
    if (q) {
      const keys = searchKeys ?? fields.map((f) => f.key)
      all = all.filter((row) =>
        keys.some((k) => String((row as Record<string, unknown>)[k] ?? '').toLowerCase().includes(q)),
      )
    }
    return [...all].sort((a, b) => {
      const x = sortBy(a)
      const y = sortBy(b)
      return typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y))
    })
  }, [data, search, searchKeys, fields, filter, sortBy])

  const pageRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  )

  const openCreate = () => {
    setEditing(null)
    setAttempted(false)
    const init: Record<string, unknown> = {}
    fields.forEach((f) => {
      if (f.type === 'checkbox') init[f.key] = false
    })
    setForm({ ...init, ...createDefaults })
    open()
  }

  const openEdit = (row: T) => {
    setEditing(row)
    setAttempted(false)
    let init: Record<string, unknown> = {}
    if (toForm) {
      init = toForm(row)
    } else {
      fields.forEach((f) => {
        init[f.key] = (row as Record<string, unknown>)[f.key]
      })
    }
    setForm(init)
    open()
  }

  // A required field left empty is not sent at all, and the API answers with a
  // validation error naming a column the person never saw. Caught here, on the
  // field itself; the rule and its exceptions live in crudValidation.
  const isMissing = (f: CrudField<T>) => isFieldMissing(f, form)
  const missingLabels = missingFieldLabels(fields, form)

  const submit = () => {
    setAttempted(true)
    if (missingLabels.length > 0) {
      notifications.show({
        message: `Заповніть обов'язкові поля: ${missingLabels.join(', ')}`,
        color: 'red',
      })
      return
    }
    saveMutation.mutate(toPayload ? toPayload(form) : form)
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
            const error = attempted && isMissing(f) ? "Обов'язкове поле" : undefined
            // A custom field draws itself. It still takes part in the required
            // check above, so a member list left empty is caught like any
            // other field rather than by the API.
            if (f.renderField) {
              return (
                <Box key={f.key}>
                  {f.renderField(value, (next) => setForm({ ...form, [f.key]: next }), form)}
                  {error && (
                    <Text size="xs" c="red" mt={4}>
                      {error}
                    </Text>
                  )}
                </Box>
              )
            }
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
                  data={f.optionsFor ? f.optionsFor(form) : (f.options ?? [])}
                  value={value == null ? null : String(value)}
                  onChange={(v) =>
                    setForm({ ...form, [f.key]: v && f.numericValue ? Number(v) : v })
                  }
                  required={f.required}
                  error={error}
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
                  error={error}
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
                error={error}
              />
            )
          })}
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
