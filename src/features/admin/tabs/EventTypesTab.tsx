import { useState } from 'react'
import {
  Stack,
  Group,
  Text,
  SegmentedControl,
  Table,
  Loader,
  Center,
  Divider,
  Box,
  ScrollArea,
  Alert,
} from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { sysTypeApi, editTypeApi } from '@/api/admin'
import { TablePagination } from '@/components/TablePagination'
import { numericStyle } from '@/theme/theme'

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
 * paged by the backend, so this tab paginates server-side.
 */
export function EventTypesTab() {
  const [kind, setKind] = useState<Kind>('sys')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const { data, isLoading, error } = useQuery<{ total: number; items: EventTypeRow[] }>({
    queryKey: ['admin', 'event-types', kind, page, pageSize],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const skip = (page - 1) * pageSize
      return kind === 'sys'
        ? await sysTypeApi.getPaged(skip, pageSize)
        : await editTypeApi.getPaged(skip, pageSize)
    },
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0

  return (
    <Stack gap="sm" style={{ height: '100%' }}>
      <Group justify="space-between">
        <Box>
          <Text fw={600} fz="lg" ff="'Space Grotesk Variable', sans-serif">
            Типи подій
          </Text>
          <Text size="xs" c="dimmed">
            Довідники аварій та змін по типах обчислювачів
          </Text>
        </Box>
        <SegmentedControl
          size="xs"
          value={kind}
          onChange={(v) => {
            setKind(v as Kind)
            setPage(1)
          }}
          data={[
            { value: 'sys', label: 'Аварії' },
            { value: 'edit', label: 'Зміни' },
          ]}
        />
      </Group>

      {error && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          {(error as Error).message}
        </Alert>
      )}

      {isLoading ? (
        <Center py={60}>
          <Loader color="petrol" />
        </Center>
      ) : (
        <Box style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <ScrollArea style={{ flex: 1 }} type="auto">
            <Table striped highlightOnHover stickyHeader verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th ta="right" w={80}>
                    ID
                  </Table.Th>
                  <Table.Th ta="right" w={110}>
                    Код
                  </Table.Th>
                  <Table.Th ta="right" w={130}>
                    Тип обч.
                  </Table.Th>
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
                      <Table.Td ta="right" style={numericStyle}>
                        {it.gas_volume_calc_type_id}
                      </Table.Td>
                      <Table.Td>{name}</Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
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
