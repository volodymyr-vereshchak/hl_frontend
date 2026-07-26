import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Center,
  Divider,
  Group,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconAlertTriangle, IconSearch } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
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

/**
 * Sys/edit type dictionaries. Both are large (thousands of rows) and served
 * paged by the backend, so the calculator-type filter and the search run
 * server-side too — filtering only the current page would be misleading.
 */
export function EventTypesTab() {
  const [kind, setKind] = useState<Kind>('sys')
  const [calcType, setCalcType] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(search, 300)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  // Any filter change invalidates the current page number.
  useEffect(() => setPage(1), [kind, calcType, debouncedSearch, pageSize])

  const { data: calcTypes } = useQuery({
    queryKey: ['admin', 'calc-types'],
    queryFn: calcTypeAdminApi.getAll,
  })

  const { data, isLoading, error } = useQuery<{ total: number; items: EventTypeRow[] }>({
    queryKey: ['admin', 'event-types', kind, calcType, debouncedSearch, page, pageSize],
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

  return (
    <Stack gap="sm" style={{ height: '100%' }}>
      <Box>
        <Text fw={600} fz="lg" ff="'Space Grotesk Variable', sans-serif">
          Типи подій
        </Text>
        <Text size="xs" c="dimmed">
          Довідники аварій та змін по типах обчислювачів
        </Text>
      </Box>

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
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((it) => {
                  const code = kind === 'sys' ? it.sys_type_id : it.edit_type_id
                  const name = kind === 'sys' ? it.sys_name : it.edit_name
                  return (
                    <Table.Tr key={it.id}>
                      <Table.Td ta="right" style={numericStyle}>
                        {it.id}
                      </Table.Td>
                      <Table.Td ta="right" style={numericStyle}>
                        {code}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{calcTypeName(it.gas_volume_calc_type_id)}</Text>
                        <Text size="10px" c="dimmed" style={numericStyle}>
                          {it.gas_volume_calc_type_id}
                        </Text>
                      </Table.Td>
                      <Table.Td>{name}</Table.Td>
                    </Table.Tr>
                  )
                })}
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
    </Stack>
  )
}
