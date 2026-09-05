import { useState } from 'react'
import {
  Stack,
  Group,
  Text,
  Button,
  Table,
  Badge,
  Box,
  Paper,
  Select,
  TextInput,
  Alert,
  Loader,
} from '@mantine/core'
import { IconRefresh, IconPlayerPlay, IconRotate, IconAlertTriangle } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { updateApi, lumgAdminApi } from '@/api/admin'
import { ApiError } from '@/lib/apiClient'
import { AdminTabHeader } from '../AdminTableShell'

const STATUS_COLOR: Record<string, string> = {
  done: 'teal',
  running: 'blue',
  queued: 'grape',
  pending: 'gray',
  error: 'red',
}

/**
 * Hostlib update job control. Job state is DB-backed on the server (shared by
 * all uvicorn workers), so a 429 means another user already started a run.
 */
export function UpdateTab() {
  const qc = useQueryClient()
  const [directLumg, setDirectLumg] = useState<string | null>(null)
  const [directPath, setDirectPath] = useState('')

  const { data: lumgs } = useQuery({ queryKey: ['admin', 'lumgs'], queryFn: lumgAdminApi.getAll })
  const { data: status, isLoading } = useQuery({
    queryKey: ['admin', 'update-status'],
    queryFn: updateApi.status,
    // Poll while a job is running (matches the old 2s cadence).
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 2000 : false),
  })

  const running = status?.status === 'running'
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'update-status'] })

  const notifyErr = (e: Error) =>
    notifications.show({
      message: e instanceof ApiError && e.status === 429 ? 'Оновлення вже виконується' : e.message,
      color: 'red',
    })

  const updateAll = useMutation({
    mutationFn: updateApi.updateAll,
    onSuccess: () => {
      notifications.show({ message: 'Оновлення запущено', color: 'teal' })
      invalidate()
    },
    onError: notifyErr,
  })

  const updateOne = useMutation({
    mutationFn: (id: number) => updateApi.updateLumg(id),
    onSuccess: () => {
      notifications.show({ message: 'Оновлення ЛУМГ запущено', color: 'teal' })
      invalidate()
    },
    onError: notifyErr,
  })

  const reset = useMutation({
    mutationFn: updateApi.reset,
    onSuccess: () => {
      notifications.show({ message: 'Стан скинуто', color: 'teal' })
      invalidate()
    },
    onError: notifyErr,
  })

  const direct = useMutation({
    mutationFn: () => updateApi.updateDirect(Number(directLumg), directPath),
    onSuccess: () => {
      notifications.show({ message: 'Пряме оновлення запущено', color: 'teal' })
      invalidate()
    },
    onError: notifyErr,
  })

  return (
    <Stack gap="md">
      <AdminTabHeader
        title="Оновлення даних"
        description={
          <>
            Завантаження архівів hostlib у базу
          </>
        }
        actions={
          <>
          <Badge
            size="lg"
            variant="light"
            color={STATUS_COLOR[status?.status ?? 'pending'] ?? 'gray'}
            leftSection={running ? <Loader size={10} color="blue" /> : undefined}
          >
            {status?.status ?? '—'}
          </Badge>
          <Button
            size="xs"
            leftSection={<IconRefresh size={16} />}
            onClick={() => updateAll.mutate()}
            loading={updateAll.isPending}
            disabled={running}
          >
            Оновити всі
          </Button>
          <Button
            size="xs"
            variant="default"
            leftSection={<IconRotate size={16} />}
            onClick={() => reset.mutate()}
            loading={reset.isPending}
          >
            Скинути
          </Button>
          </>
        }
      />

      {status?.error && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          {status.error}
        </Alert>
      )}

      {(status?.started_at || status?.finished_at) && (
        <Text size="xs" c="dimmed">
          Початок: {status.started_at ? new Date(status.started_at).toLocaleString('uk-UA') : '—'}
          {' · '}
          Завершення: {status.finished_at ? new Date(status.finished_at).toLocaleString('uk-UA') : '—'}
        </Text>
      )}

      <Paper withBorder radius="md">
        {isLoading ? (
          <Box p="md">
            <Loader size="sm" color="petrol" />
          </Box>
        ) : (
          <Table striped highlightOnHover verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={70}>ID</Table.Th>
                <Table.Th>ЛУМГ</Table.Th>
                <Table.Th w={140}>Статус</Table.Th>
                <Table.Th w={130} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(lumgs ?? []).map((l) => {
                const st = status?.lumgs?.[String(l.id)]
                return (
                  <Table.Tr key={l.id}>
                    <Table.Td>{l.id}</Table.Td>
                    <Table.Td>{l.name}</Table.Td>
                    <Table.Td>
                      {st ? (
                        <Badge size="sm" variant="light" color={STATUS_COLOR[st] ?? 'gray'}>
                          {st}
                        </Badge>
                      ) : (
                        <Text c="dimmed" size="sm">
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="compact-xs"
                        variant="light"
                        leftSection={<IconPlayerPlay size={13} />}
                        onClick={() => updateOne.mutate(l.id)}
                        disabled={running}
                      >
                        Оновити
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        )}
      </Paper>

      <Paper withBorder radius="md" p="md">
        <Text fw={600} size="sm" mb={4}>
          Пряме оновлення (режим 2)
        </Text>
        <Text size="xs" c="dimmed" mb="sm">
          Читає всі файли з вказаного шляху в один ЛУМГ, ігноруючи коди ЄІС — для довантаження
          історичних архівів.
        </Text>
        <Group align="flex-end" gap="sm">
          <Select
            label="ЛУМГ"
            data={(lumgs ?? []).map((l) => ({ value: String(l.id), label: l.name }))}
            value={directLumg}
            onChange={setDirectLumg}
            searchable
            w={260}
            size="xs"
          />
          <TextInput
            label="Шлях до архіву"
            value={directPath}
            onChange={(e) => setDirectPath(e.currentTarget.value)}
            placeholder="/app/hostlibs/..."
            style={{ flex: 1 }}
            size="xs"
          />
          <Button
            size="xs"
            onClick={() => direct.mutate()}
            loading={direct.isPending}
            disabled={!directLumg || !directPath || running}
          >
            Запустити
          </Button>
        </Group>
      </Paper>
    </Stack>
  )
}
