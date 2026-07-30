import { useEffect, useState } from 'react'
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Code,
  Group,
  MultiSelect,
  NumberInput,
  Paper,
  PasswordInput,
  Progress,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconDeviceFloppy, IconRefresh, IconTrash } from '@tabler/icons-react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  branchAdminApi,
  dpdCredentialApi,
  enterpriseArchiveApi,
  type ArchiveRefreshStatus,
  type DpdCredential,
} from '@/api/admin'
import type { Branch } from '@/types'

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })

/** 00:00 … 23:00 — the schedule is set in whole hours. */
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)

/**
 * Options for the schedule picker. A stored time that is not a whole hour (set
 * through DPD_REFRESH_TIMES in the env file, e.g. 10:30) is kept as its own
 * option — opening the form must not silently drop it.
 */
const scheduleOptions = (times: string[]) =>
  [...new Set([...HOUR_OPTIONS, ...times])].sort()

/** Shared DPD data cache: one refresh job covering all branches. */
function ArchiveControls() {
  const qc = useQueryClient()
  const [polling, setPolling] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState(false)
  const [draftTimes, setDraftTimes] = useState<string[]>([])

  const { data: job } = useQuery<ArchiveRefreshStatus | null>({
    queryKey: ['admin', 'dpd-archive-status'],
    queryFn: () => enterpriseArchiveApi.status().catch(() => null),
    refetchInterval: polling ? 2000 : false,
  })

  useEffect(() => {
    setPolling(job?.status === 'running')
  }, [job?.status])

  const refresh = useMutation({
    mutationFn: enterpriseArchiveApi.refresh,
    onSuccess: () => {
      notifications.show({ message: 'Оновлення запущено', color: 'teal' })
      setPolling(true)
      qc.invalidateQueries({ queryKey: ['admin', 'dpd-archive-status'] })
    },
    onError: () =>
      notifications.show({
        message: 'Не вдалося запустити (можливо, вже виконується)',
        color: 'red',
      }),
  })

  const clear = useMutation({
    mutationFn: enterpriseArchiveApi.clearCache,
    onSuccess: () => notifications.show({ message: 'Архів очищено', color: 'teal' }),
    onError: notifyErr,
  })

  const times = job?.refresh_times ?? []

  const saveSchedule = useMutation({
    mutationFn: () => enterpriseArchiveApi.setSchedule(draftTimes),
    onSuccess: () => {
      notifications.show({ message: 'Графік збережено', color: 'teal' })
      setEditingSchedule(false)
      qc.invalidateQueries({ queryKey: ['admin', 'dpd-archive-status'] })
    },
    onError: notifyErr,
  })

  const running = job?.status === 'running'
  // The job counts each device twice (daily + hourly pass) — report devices.
  const done = Math.floor((job?.progress_done ?? 0) / 2)
  const total = Math.ceil((job?.progress_total ?? 0) / 2)

  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Box style={{ flex: 1, minWidth: 240 }}>
          <Text fw={600} size="sm">
            Архів даних ДПД
          </Text>
          <Text size="xs" c="dimmed">
            Оновлюється автоматично {times.length ? `о ${times.join(', ')}` : 'за розкладом'} —
            останні 30 днів по всіх підприємствах{' '}
            <Anchor
              component="button"
              type="button"
              size="xs"
              onClick={() => {
                setDraftTimes(times)
                setEditingSchedule(true)
              }}
            >
              Змінити години
            </Anchor>
          </Text>
        </Box>
        <Group gap="xs">
          <Button
            size="xs"
            leftSection={<IconRefresh size={14} />}
            onClick={() => refresh.mutate()}
            disabled={running}
            loading={refresh.isPending}
          >
            {running ? 'Виконується…' : 'Оновити зараз'}
          </Button>
          <Button
            size="xs"
            color="red"
            variant="light"
            leftSection={<IconTrash size={14} />}
            disabled={running}
            onClick={() =>
              modals.openConfirmModal({
                title: 'Очистити архів ДПД',
                children: (
                  <Text size="sm">
                    Дані буде завантажено заново при наступному оновленні. Продовжити?
                  </Text>
                ),
                labels: { confirm: 'Очистити', cancel: 'Скасувати' },
                confirmProps: { color: 'red' },
                onConfirm: () => clear.mutate(),
              })
            }
          >
            Очистити архів
          </Button>
        </Group>
      </Group>

      {editingSchedule && (
        <Group gap="sm" mt="sm" align="flex-end" wrap="wrap">
          <MultiSelect
            label="Години оновлення"
            description="Скільки завгодно годин. Зміни діють протягом ~2 хв, перезапуск не потрібен"
            size="xs"
            style={{ flex: 1, minWidth: 280, maxWidth: 460 }}
            data={scheduleOptions(times)}
            value={draftTimes}
            onChange={setDraftTimes}
            searchable
            hidePickedOptions
            clearable
            placeholder={draftTimes.length ? '' : 'Оберіть години'}
          />
          <Button
            size="xs"
            leftSection={<IconDeviceFloppy size={14} />}
            onClick={() => saveSchedule.mutate()}
            loading={saveSchedule.isPending}
            disabled={!draftTimes.length}
          >
            Зберегти
          </Button>
          <Button size="xs" variant="default" onClick={() => setEditingSchedule(false)}>
            Скасувати
          </Button>
        </Group>
      )}

      {running && total > 0 && (
        <Box mt="sm">
          <Progress value={(done / total) * 100} size="sm" color="amber" animated />
          <Text size="10px" c="dimmed" mt={2}>
            {done} / {total} приладів
          </Text>
        </Box>
      )}
      {!running && job?.finished_at && (
        <Text size="xs" c={job.status === 'error' ? 'red.5' : 'dimmed'} mt="sm">
          Останнє оновлення: {new Date(job.finished_at).toLocaleString('uk-UA')}
          {job.status === 'error' && job.error ? ` — помилка: ${job.error}` : ''}
        </Text>
      )}
    </Paper>
  )
}

/** One branch card: its own endpoints, login and password. */
function BranchCard({ branch, cred }: { branch: Branch; cred: DpdCredential | null }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<DpdCredential>({})

  const startEdit = () => {
    setForm({
      username: cred?.username ?? '',
      password: '',
      api_base_url: cred?.api_base_url ?? '',
      auth_url: cred?.auth_url ?? '',
      timeout_sec: cred?.timeout_sec ?? 30,
    })
    setEditing(true)
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'dpd-cred', branch.id] })

  const save = useMutation({
    mutationFn: () => {
      const payload: DpdCredential = {
        username: form.username,
        api_base_url: form.api_base_url,
        auth_url: form.auth_url,
        timeout_sec: Number(form.timeout_sec) || 30,
      }
      // An empty password means "keep the current one" — never send a blank.
      if (form.password) payload.password = form.password
      return dpdCredentialApi.upsert(branch.id, payload)
    },
    onSuccess: () => {
      notifications.show({ message: 'Збережено', color: 'teal' })
      setEditing(false)
      invalidate()
    },
    onError: notifyErr,
  })

  const remove = useMutation({
    mutationFn: () => dpdCredentialApi.remove(branch.id),
    onSuccess: () => {
      notifications.show({ message: 'Видалено', color: 'teal' })
      invalidate()
    },
    onError: notifyErr,
  })

  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="sm" style={{ flex: 1, minWidth: 240 }}>
          <Text fw={600} size="sm">
            {branch.name}
          </Text>
          {cred ? (
            <>
              <Badge variant="light" color="petrol" size="sm" tt="none">
                {cred.username}
              </Badge>
              {cred.api_base_url && <Code style={{ fontSize: 11 }}>{cred.api_base_url}</Code>}
            </>
          ) : (
            <Text size="xs" c="dimmed">
              Не налаштовано
            </Text>
          )}
        </Group>
        {!editing && (
          <Group gap="xs">
            <Button size="compact-xs" variant="default" onClick={startEdit}>
              {cred ? 'Редагувати' : 'Додати'}
            </Button>
            {cred && (
              <Button
                size="compact-xs"
                color="red"
                variant="light"
                onClick={() =>
                  modals.openConfirmModal({
                    title: 'Видалити доступ',
                    children: (
                      <Text size="sm">Видалити облікові дані ДПД для «{branch.name}»?</Text>
                    ),
                    labels: { confirm: 'Видалити', cancel: 'Скасувати' },
                    confirmProps: { color: 'red' },
                    onConfirm: () => remove.mutate(),
                  })
                }
              >
                Видалити
              </Button>
            )}
          </Group>
        )}
      </Group>

      {editing && (
        <Stack gap="sm" mt="sm">
          <Group gap="sm" grow align="flex-start">
            <TextInput
              label="API base URL"
              size="xs"
              value={form.api_base_url ?? ''}
              onChange={(e) => setForm({ ...form, api_base_url: e.currentTarget.value })}
              placeholder="https://dpd.example.com/api"
            />
            <TextInput
              label="Auth URL"
              size="xs"
              value={form.auth_url ?? ''}
              onChange={(e) => setForm({ ...form, auth_url: e.currentTarget.value })}
              placeholder="https://dpd.example.com/auth/token"
            />
          </Group>
          <Group gap="sm" align="flex-end">
            <TextInput
              label="Логін"
              size="xs"
              w={220}
              value={form.username ?? ''}
              onChange={(e) => setForm({ ...form, username: e.currentTarget.value })}
            />
            <PasswordInput
              label={cred ? 'Новий пароль (необовʼязково)' : 'Пароль'}
              size="xs"
              w={220}
              value={form.password ?? ''}
              onChange={(e) => setForm({ ...form, password: e.currentTarget.value })}
              placeholder={cred ? 'не змінювати' : ''}
            />
            <NumberInput
              label="Таймаут, с"
              size="xs"
              w={120}
              min={1}
              max={600}
              value={form.timeout_sec ?? 30}
              onChange={(v) => setForm({ ...form, timeout_sec: Number(v) || 30 })}
            />
          </Group>
          {!cred && !form.password && (
            <Alert color="amber" variant="light" py={6}>
              <Text size="xs">Пароль обовʼязковий для нового запису</Text>
            </Alert>
          )}
          <Group gap="xs">
            <Button
              size="xs"
              leftSection={<IconDeviceFloppy size={14} />}
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!form.username || (!cred && !form.password)}
            >
              Зберегти
            </Button>
            <Button size="xs" variant="default" onClick={() => setEditing(false)}>
              Скасувати
            </Button>
          </Group>
        </Stack>
      )}
    </Paper>
  )
}

/** Доступ до ДПД — per-branch endpoints and credentials plus the shared cache. */
export function DpdCredentialsTab() {
  const { data: branches } = useQuery({
    queryKey: ['admin', 'branches'],
    queryFn: branchAdminApi.getAll,
  })

  const credQueries = useQueries({
    queries: (branches ?? []).map((b) => ({
      queryKey: ['admin', 'dpd-cred', b.id],
      queryFn: () => dpdCredentialApi.get(b.id).catch(() => null),
    })),
  })

  return (
    <Stack gap="md">
      <Box>
        <Text fw={600} fz="lg" ff="'Space Grotesk Variable', sans-serif">
          Доступ до ДПД
        </Text>
        <Text size="xs" c="dimmed">
          Кожна філія має власні адреси API та власні облікові дані
        </Text>
      </Box>

      <ArchiveControls />

      {(branches ?? []).map((b, i) => (
        <BranchCard key={b.id} branch={b} cred={credQueries[i]?.data ?? null} />
      ))}
    </Stack>
  )
}
