import { useState } from 'react'
import {
  Stack,
  Group,
  Text,
  Select,
  Paper,
  TextInput,
  Button,
  Switch,
  Badge,
  Loader,
  Center,
  ActionIcon,
  Box,
  Collapse,
  Tooltip,
} from '@mantine/core'
import { IconDeviceFloppy, IconTrash, IconChevronRight, IconPlus, IconScan } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { branchAdminApi, lumgAdminApi } from '@/api/admin'
import type { Lumg } from '@/types'

function notifyErr(e: Error) {
  notifications.show({ message: e.message, color: 'red' })
}

/** Per-LUMG archive path + EIS code management. */
function LumgRow({ lumg }: { lumg: Lumg }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState<string | null>(null)
  const [active, setActive] = useState(true)
  const [newCode, setNewCode] = useState('')

  const pathQuery = useQuery({
    queryKey: ['admin', 'data-path', lumg.id],
    queryFn: () => lumgAdminApi.getDataPath(lumg.id).catch(() => null),
    enabled: open,
  })
  const codesQuery = useQuery({
    queryKey: ['admin', 'eis-codes', lumg.id],
    queryFn: () => lumgAdminApi.getEisCodes(lumg.id).catch(() => []),
    enabled: open,
  })

  const current = path ?? pathQuery.data?.path ?? ''
  const isActive = pathQuery.data ? (path === null ? pathQuery.data.active : active) : active

  const save = useMutation({
    mutationFn: () => lumgAdminApi.setDataPath(lumg.id, { path: current, active: isActive }),
    onSuccess: () => {
      notifications.show({ message: 'Шлях збережено', color: 'teal' })
      qc.invalidateQueries({ queryKey: ['admin', 'data-path', lumg.id] })
    },
    onError: notifyErr,
  })

  const removePath = useMutation({
    mutationFn: () => lumgAdminApi.deleteDataPath(lumg.id),
    onSuccess: () => {
      setPath('')
      qc.invalidateQueries({ queryKey: ['admin', 'data-path', lumg.id] })
    },
    onError: notifyErr,
  })

  const addCode = useMutation({
    mutationFn: () => lumgAdminApi.addEisCode(lumg.id, newCode.trim()),
    onSuccess: () => {
      setNewCode('')
      qc.invalidateQueries({ queryKey: ['admin', 'eis-codes', lumg.id] })
    },
    onError: notifyErr,
  })

  const delCode = useMutation({
    mutationFn: (codeId: number) => lumgAdminApi.deleteEisCode(lumg.id, codeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'eis-codes', lumg.id] }),
    onError: notifyErr,
  })

  const scan = useMutation({
    mutationFn: () => lumgAdminApi.scanEis(lumg.id),
    onSuccess: (res) => {
      const n = res?.codes?.length ?? 0
      notifications.show({ message: `Знайдено кодів: ${n}`, color: n ? 'teal' : 'gray' })
    },
    onError: notifyErr,
  })

  const codes = codesQuery.data ?? []

  return (
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" wrap="nowrap">
        <Group gap={6} style={{ cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
          <IconChevronRight
            size={15}
            style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
          />
          <Text fw={600} size="sm">
            {lumg.name}
          </Text>
          {open && codes.length > 0 && (
            <Badge size="xs" variant="light" color="petrol">
              ЄІС ({codes.length})
            </Badge>
          )}
        </Group>
      </Group>

      <Collapse expanded={open}>
        <Stack gap="sm" mt="sm">
          {pathQuery.isLoading ? (
            <Loader size="xs" />
          ) : (
            <Group align="flex-end" gap="xs">
              <TextInput
                label="Шлях до архівів"
                value={current}
                onChange={(e) => setPath(e.currentTarget.value)}
                placeholder="/app/hostlibs/..."
                style={{ flex: 1 }}
                size="xs"
              />
              <Switch
                label="Активний"
                checked={!!isActive}
                onChange={(e) => setActive(e.currentTarget.checked)}
                size="sm"
                mb={6}
              />
              <Button
                size="xs"
                leftSection={<IconDeviceFloppy size={14} />}
                onClick={() => save.mutate()}
                loading={save.isPending}
              >
                Зберегти
              </Button>
              <Button
                size="xs"
                color="red"
                variant="light"
                onClick={() => removePath.mutate()}
                loading={removePath.isPending}
              >
                Очистити
              </Button>
            </Group>
          )}

          <Box>
            <Group justify="space-between" mb={6}>
              <Text size="xs" fw={600} tt="uppercase" c="dimmed">
                Коди ЄІС
              </Text>
              <Tooltip label="Просканувати архів на нерозподілені коди">
                <Button
                  size="compact-xs"
                  variant="light"
                  leftSection={<IconScan size={13} />}
                  onClick={() => scan.mutate()}
                  loading={scan.isPending}
                >
                  Сканувати
                </Button>
              </Tooltip>
            </Group>
            <Group gap={6} mb="xs">
              {codes.length === 0 && (
                <Text size="xs" c="dimmed">
                  Прямий режим (без кодів)
                </Text>
              )}
              {codes.map((c) => (
                <Badge
                  key={c.id}
                  variant="light"
                  color="steel"
                  rightSection={
                    <ActionIcon
                      size="xs"
                      variant="transparent"
                      color="red"
                      onClick={() => delCode.mutate(c.id)}
                    >
                      <IconTrash size={11} />
                    </ActionIcon>
                  }
                >
                  {c.code}
                </Badge>
              ))}
            </Group>
            <Group gap="xs">
              <TextInput
                placeholder="Новий код ЄІС"
                value={newCode}
                onChange={(e) => setNewCode(e.currentTarget.value)}
                size="xs"
                w={220}
              />
              <Button
                size="xs"
                variant="default"
                leftSection={<IconPlus size={13} />}
                onClick={() => addCode.mutate()}
                disabled={!newCode.trim()}
                loading={addCode.isPending}
              >
                Додати
              </Button>
            </Group>
          </Box>
        </Stack>
      </Collapse>
    </Paper>
  )
}

export function DataPathsTab() {
  const [branchId, setBranchId] = useState<string | null>(null)
  const { data: branches } = useQuery({ queryKey: ['admin', 'branches'], queryFn: branchAdminApi.getAll })
  const { data: lumgs, isLoading } = useQuery({ queryKey: ['admin', 'lumgs'], queryFn: lumgAdminApi.getAll })

  const branchLumgs = (lumgs ?? []).filter((l) => !branchId || l.branch_id === Number(branchId))

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap">
        <Box>
          <Text fw={600} fz="lg" ff="'Space Grotesk Variable', sans-serif">
            Шляхи до даних
          </Text>
          <Text size="xs" c="dimmed">
            Розташування архівів по ЛУМГ та коди ЄІС
          </Text>
        </Box>
        <Select
          placeholder="Всі філії"
          data={(branches ?? []).map((b) => ({ value: String(b.id), label: b.name }))}
          value={branchId}
          onChange={setBranchId}
          clearable
          searchable
          size="xs"
          w={260}
        />
      </Group>

      {isLoading ? (
        <Center py={60}>
          <Loader color="petrol" />
        </Center>
      ) : (
        <Stack gap="xs">
          {branchLumgs.map((l) => (
            <LumgRow key={l.id} lumg={l} />
          ))}
        </Stack>
      )}
    </Stack>
  )
}
