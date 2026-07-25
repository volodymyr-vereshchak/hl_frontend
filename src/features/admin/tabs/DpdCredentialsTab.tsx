import { useEffect, useState } from 'react'
import {
  Stack,
  Group,
  Text,
  Paper,
  TextInput,
  NumberInput,
  Button,
  Select,
  PasswordInput,
  Box,
  Alert,
} from '@mantine/core'
import { IconDeviceFloppy, IconInfoCircle, IconTrash } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { branchAdminApi, dpdConfigApi, dpdCredentialApi } from '@/api/admin'

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })

/** Global DPD API config + per-branch credentials. */
export function DpdCredentialsTab() {
  const qc = useQueryClient()
  const [branchId, setBranchId] = useState<string | null>(null)
  const [apiBase, setApiBase] = useState('')
  const [authUrl, setAuthUrl] = useState('')
  const [timeout, setTimeoutSec] = useState<number | ''>(600)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const { data: branches } = useQuery({ queryKey: ['admin', 'branches'], queryFn: branchAdminApi.getAll })
  const { data: config } = useQuery({
    queryKey: ['admin', 'dpd-config'],
    queryFn: () => dpdConfigApi.get().catch(() => ({}) as Record<string, never>),
  })
  const { data: cred } = useQuery({
    queryKey: ['admin', 'dpd-cred', branchId],
    queryFn: () => dpdCredentialApi.get(Number(branchId)).catch(() => null),
    enabled: !!branchId,
  })

  useEffect(() => {
    if (config) {
      setApiBase(config.api_base_url ?? '')
      setAuthUrl(config.auth_url ?? '')
      setTimeoutSec(config.timeout_sec ?? 600)
    }
  }, [config])

  useEffect(() => {
    setUsername(cred?.username ?? '')
    setPassword('')
  }, [cred])

  const saveConfig = useMutation({
    mutationFn: () =>
      dpdConfigApi.upsert({
        api_base_url: apiBase,
        auth_url: authUrl,
        timeout_sec: timeout === '' ? undefined : Number(timeout),
      }),
    onSuccess: () => {
      notifications.show({ message: 'Конфігурацію збережено', color: 'teal' })
      qc.invalidateQueries({ queryKey: ['admin', 'dpd-config'] })
    },
    onError: notifyErr,
  })

  const saveCred = useMutation({
    mutationFn: () => dpdCredentialApi.upsert(Number(branchId), { username, password }),
    onSuccess: () => {
      notifications.show({ message: 'Облікові дані збережено', color: 'teal' })
      setPassword('')
      qc.invalidateQueries({ queryKey: ['admin', 'dpd-cred', branchId] })
    },
    onError: notifyErr,
  })

  const removeCred = useMutation({
    mutationFn: () => dpdCredentialApi.remove(Number(branchId)),
    onSuccess: () => {
      notifications.show({ message: 'Облікові дані видалено', color: 'teal' })
      setUsername('')
      setPassword('')
      qc.invalidateQueries({ queryKey: ['admin', 'dpd-cred', branchId] })
    },
    onError: notifyErr,
  })

  return (
    <Stack gap="md">
      <Box>
        <Text fw={600} fz="lg" ff="'Space Grotesk Variable', sans-serif">
          Доступ до ДПД
        </Text>
        <Text size="xs" c="dimmed">
          Глобальні налаштування API та облікові дані по філіях
        </Text>
      </Box>

      <Paper withBorder radius="md" p="md">
        <Text fw={600} size="sm" mb="sm">
          Глобальна конфігурація
        </Text>
        <Stack gap="sm">
          <TextInput
            label="API base URL"
            value={apiBase}
            onChange={(e) => setApiBase(e.currentTarget.value)}
            size="xs"
          />
          <TextInput
            label="Auth URL"
            value={authUrl}
            onChange={(e) => setAuthUrl(e.currentTarget.value)}
            size="xs"
          />
          <NumberInput
            label="Таймаут, с"
            value={timeout}
            onChange={(v) => setTimeoutSec(v === '' ? '' : Number(v))}
            size="xs"
            w={180}
          />
          <Group>
            <Button
              size="xs"
              leftSection={<IconDeviceFloppy size={14} />}
              onClick={() => saveConfig.mutate()}
              loading={saveConfig.isPending}
            >
              Зберегти
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Paper withBorder radius="md" p="md">
        <Text fw={600} size="sm" mb="sm">
          Облікові дані філії
        </Text>
        <Stack gap="sm">
          <Select
            label="Філія"
            placeholder="Оберіть філію"
            data={(branches ?? []).map((b) => ({ value: String(b.id), label: b.name }))}
            value={branchId}
            onChange={setBranchId}
            searchable
            size="xs"
            w={320}
          />
          {branchId ? (
            <>
              <TextInput
                label="Користувач"
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
                size="xs"
                w={320}
              />
              <PasswordInput
                label="Пароль"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                placeholder={cred ? '•••••• (не змінювати)' : ''}
                size="xs"
                w={320}
              />
              <Group>
                <Button
                  size="xs"
                  leftSection={<IconDeviceFloppy size={14} />}
                  onClick={() => saveCred.mutate()}
                  loading={saveCred.isPending}
                  disabled={!username}
                >
                  Зберегти
                </Button>
                <Button
                  size="xs"
                  color="red"
                  variant="light"
                  leftSection={<IconTrash size={14} />}
                  onClick={() => removeCred.mutate()}
                  loading={removeCred.isPending}
                >
                  Видалити
                </Button>
              </Group>
            </>
          ) : (
            <Alert variant="light" color="petrol" icon={<IconInfoCircle size={16} />}>
              Оберіть філію, щоб керувати обліковими даними
            </Alert>
          )}
        </Stack>
      </Paper>
    </Stack>
  )
}
