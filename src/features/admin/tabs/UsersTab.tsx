import { useState } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Code,
  Group,
  Modal,
  MultiSelect,
  Paper,
  PasswordInput,
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
  IconAlertTriangle,
  IconKey,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { branchAdminApi, userApi, type AdminUser, type UserWrite } from '@/api/admin'
import { LoadingState } from '@/components/LoadingState'
import { copyText } from '@/lib/clipboard'
import type { UserRole } from '@/types'
import { toOptions } from '../useAdminTopology'

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })

interface FormState {
  username: string
  display_name: string
  role: UserRole
  active: boolean
  branch_ids: string[]
  password: string
}

const EMPTY: FormState = {
  username: '',
  display_name: '',
  role: 'viewer',
  active: true,
  branch_ids: [],
  password: '',
}

/**
 * Користувачі. Branch access is the reason this is not a plain CrudTable: it is
 * a many-to-many list, and the API is asymmetric — it READS `allowed_branch_ids`
 * and WRITES `branch_ids`.
 *
 * An empty list means every branch, which is why the table says so explicitly
 * rather than showing a blank cell.
 */
export function UsersTab() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [opened, { open, close }] = useDisclosure(false)
  // A generated password is shown once and never again — keep it on screen
  // until it is dismissed.
  const [newPassword, setNewPassword] = useState<{ login: string; password: string } | null>(null)

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: userApi.getAll,
  })
  const { data: branches } = useQuery({
    queryKey: ['admin', 'branches'],
    queryFn: branchAdminApi.getAll,
  })
  const { data: authMode } = useQuery({
    queryKey: ['admin', 'auth-mode'],
    queryFn: userApi.getMode,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'users'] })

  const payload = (f: FormState): UserWrite => ({
    display_name: f.display_name || null,
    role: f.role,
    branch_ids: f.branch_ids.map(Number),
  })

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        return userApi.update(editing.id, { ...payload(form), active: form.active })
      }
      const created = await userApi.create({
        ...payload(form),
        username: form.username.trim(),
        // Leave it out and the server generates one.
        ...(form.password ? { password: form.password } : {}),
      })
      setNewPassword({ login: created.user.username, password: created.password })
      return created
    },
    onSuccess: () => {
      notifications.show({ message: 'Збережено', color: 'teal' })
      close()
      invalidate()
    },
    onError: notifyErr,
  })

  const remove = useMutation({
    mutationFn: (id: number) => userApi.remove(id),
    onSuccess: () => {
      notifications.show({ message: 'Видалено', color: 'teal' })
      invalidate()
    },
    onError: notifyErr,
  })

  const resetPassword = useMutation({
    mutationFn: (u: AdminUser) => userApi.resetPassword(u.id).then((r) => ({ u, ...r })),
    onSuccess: ({ u, password }) => setNewPassword({ login: u.username, password }),
    onError: notifyErr,
  })

  const toggleActive = useMutation({
    mutationFn: (u: AdminUser) => userApi.update(u.id, { active: !u.active }),
    onSuccess: invalidate,
    onError: notifyErr,
  })

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY)
    open()
  }

  const openEdit = (u: AdminUser) => {
    setEditing(u)
    setForm({
      username: u.username,
      display_name: u.display_name ?? '',
      role: u.role,
      active: u.active,
      branch_ids: (u.allowed_branch_ids ?? []).map(String),
      password: '',
    })
    open()
  }

  const branchName = (id: number) => (branches ?? []).find((b) => b.id === id)?.name ?? `#${id}`

  // Domain accounts on a server with domain login switched off cannot sign in
  // at all — and nothing says so until someone tries. Sessions already open
  // keep running to their expiry, so the breakage arrives days late and one
  // user at a time, which is exactly when nobody connects it to the switch.
  const domainStranded =
    authMode?.ldap_enabled === false && (users ?? []).some((u) => u.has_password === false)

  const q = search.trim().toLowerCase()
  const rows = (users ?? []).filter(
    (u) =>
      !q ||
      u.username.toLowerCase().includes(q) ||
      (u.display_name ?? '').toLowerCase().includes(q),
  )

  return (
    <Stack gap="sm" style={{ height: '100%' }}>
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Box>
          <Text fw={600} fz="lg" ff="'Space Grotesk Variable', sans-serif">
            Користувачі
          </Text>
          <Text size="xs" c="dimmed">
            Облікові записи, ролі та доступ до філій
          </Text>
        </Box>
        <Group gap="xs">
          <TextInput
            placeholder="Пошук..."
            leftSection={<IconSearch size={15} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            size="xs"
            w={220}
          />
          <Button size="xs" leftSection={<IconPlus size={16} />} onClick={openCreate}>
            Додати
          </Button>
        </Group>
      </Group>

      {domainStranded && (
        <Alert
          color="red"
          variant="light"
          icon={<IconAlertTriangle size={16} />}
          title="Доменна авторизація вимкнена на сервері"
        >
          <Text size="sm">
            Облікові записи з позначкою «домен» увійти не зможуть — їхній пароль зберігається в
            Active Directory, а звертатися до неї сервер зараз не буде. Ті, хто був у системі,
            доступ уже втратили: сервер не приймає їхні сеанси, відкриті до вимкнення.
          </Text>
          <Text size="sm" mt={6}>
            Видати їм локальний пароль не можна: він лишився б чинним і після повернення доменної
            авторизації, тобто пережив би і зміну доменного пароля, і блокування облікового запису в
            домені. Або увімкніть доменну авторизацію назад, або видаліть ці записи й створіть
            натомість локальні.
          </Text>
          {authMode?.auto_login && (
            <Text size="sm" mt={6} fw={600}>
              Увага: увімкнено автоматичний вхід. Ці користувачі не побачать помилки — їх мовчки
              пустить під спільним обліковим записом за замовчуванням, з чужими правами на філії.
            </Text>
          )}
        </Alert>
      )}

      {newPassword && (
        <Alert
          color="amber"
          variant="light"
          withCloseButton
          onClose={() => setNewPassword(null)}
          title="Пароль показується один раз"
        >
          <Group gap="xs">
            <Text size="sm">{newPassword.login}</Text>
            <Code style={{ fontSize: 14 }}>{newPassword.password}</Code>
            <Button
              size="compact-xs"
              variant="light"
              onClick={() =>
                void copyText(newPassword.password).then((ok) => {
                  if (!ok) {
                    notifications.show({
                      color: 'red',
                      message: 'Не вдалося скопіювати в буфер обміну',
                    })
                  }
                })
              }
            >
              Копіювати
            </Button>
          </Group>
        </Alert>
      )}

      {isLoading ? (
        <LoadingState />
      ) : (
        <Paper withBorder radius="md" style={{ flex: 1, minHeight: 0 }}>
          <ScrollArea className="hlv-table-scroll" style={{ height: '100%' }} type="auto">
            <Table striped highlightOnHover stickyHeader verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={70}>ID</Table.Th>
                  <Table.Th>Логін</Table.Th>
                  <Table.Th>Імʼя</Table.Th>
                  <Table.Th w={140}>Роль</Table.Th>
                  <Table.Th>Доступ до філій</Table.Th>
                  <Table.Th w={90} ta="center">
                    Активний
                  </Table.Th>
                  <Table.Th w={110} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((u) => {
                  const allowed = u.allowed_branch_ids ?? []
                  // No password of ours = provisioned by a domain login. Older
                  // API builds omit the field; treat that as a local account,
                  // which is what every account was before domain login existed.
                  const domainAccount = u.has_password === false
                  return (
                    <Table.Tr key={u.id}>
                      <Table.Td c="dimmed">{u.id}</Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Text size="sm">{u.username}</Text>
                          {domainAccount && (
                            <Tooltip
                              label={
                                domainStranded
                                  ? 'Доменна авторизація вимкнена — цей запис увійти не зможе'
                                  : 'Вхід за доменними обліковими даними (Active Directory)'
                              }
                              withArrow
                            >
                              <Badge
                                variant={domainStranded ? 'light' : 'default'}
                                color={domainStranded ? 'red' : undefined}
                                size="xs"
                                tt="none"
                              >
                                домен
                              </Badge>
                            </Tooltip>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>{u.display_name || '—'}</Table.Td>
                      <Table.Td>
                        <Badge
                          variant="light"
                          color={u.role === 'admin' ? 'amber' : 'petrol'}
                          size="sm"
                          tt="none"
                        >
                          {u.role === 'admin' ? 'Адміністратор' : 'Спостерігач'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        {allowed.length === 0 ? (
                          <Text size="xs" c="dimmed">
                            усі філії
                          </Text>
                        ) : (
                          <Group gap={4}>
                            {allowed.map((id) => (
                              <Badge key={id} variant="default" size="xs" tt="none">
                                {branchName(id)}
                              </Badge>
                            ))}
                          </Group>
                        )}
                      </Table.Td>
                      <Table.Td ta="center">
                        <Switch
                          size="xs"
                          color="petrol"
                          checked={u.active}
                          onChange={() => toggleActive.mutate(u)}
                        />
                      </Table.Td>
                      <Table.Td>
                        <Group gap={2} justify="flex-end" wrap="nowrap">
                          <Tooltip
                            label={
                              domainAccount
                                ? 'Пароль зберігається в домені (Active Directory) — змінюється засобами домену'
                                : 'Згенерувати новий пароль'
                            }
                            withArrow
                          >
                            {/* Kept in place, inert, rather than dropped: the
                                gap would read as a missing feature instead of
                                an answer to "why can I not reset this one?".
                                `data-disabled` and not `disabled` — a truly
                                disabled control swallows the pointer events the
                                tooltip needs, so the explanation would never
                                appear. */}
                            <ActionIcon
                              variant="subtle"
                              color="amber"
                              data-disabled={domainAccount || undefined}
                              onClick={() =>
                                domainAccount
                                  ? undefined
                                  : modals.openConfirmModal({
                                      title: 'Скидання пароля',
                                      children: (
                                        <Text size="sm">
                                          Згенерувати новий пароль для «{u.username}»? Старий
                                          перестане діяти, і поточний сеанс користувача завершиться.
                                        </Text>
                                      ),
                                      labels: { confirm: 'Скинути', cancel: 'Скасувати' },
                                      confirmProps: { color: 'amber' },
                                      onConfirm: () => resetPassword.mutate(u),
                                    })
                              }
                            >
                              <IconKey size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <ActionIcon variant="subtle" onClick={() => openEdit(u)}>
                            <IconPencil size={16} />
                          </ActionIcon>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            onClick={() =>
                              modals.openConfirmModal({
                                title: 'Видалити користувача',
                                children: <Text size="sm">Видалити «{u.username}»?</Text>,
                                labels: { confirm: 'Видалити', cancel: 'Скасувати' },
                                confirmProps: { color: 'red' },
                                onConfirm: () => remove.mutate(u.id),
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
            {rows.length === 0 && (
              <Center py="xl">
                <Text c="dimmed" size="sm">
                  Немає записів
                </Text>
              </Center>
            )}
          </ScrollArea>
        </Paper>
      )}

      <Modal
        opened={opened}
        onClose={close}
        title={editing ? `Користувач ${editing.username}` : 'Новий користувач'}
        centered
      >
        <Stack gap="sm">
          {!editing && (
            <TextInput
              label="Логін"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.currentTarget.value })}
              required
              data-autofocus
            />
          )}
          <TextInput
            label="Імʼя"
            placeholder="Показується у шапці замість логіна"
            value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.currentTarget.value })}
          />
          <Select
            label="Роль"
            data={[
              { value: 'viewer', label: 'Спостерігач' },
              { value: 'admin', label: 'Адміністратор' },
            ]}
            value={form.role}
            onChange={(v) => setForm({ ...form, role: (v as UserRole) ?? 'viewer' })}
            allowDeselect={false}
          />
          <MultiSelect
            label="Доступ до філій"
            description="Порожньо — доступ до всіх філій"
            placeholder={form.branch_ids.length ? undefined : 'Усі філії'}
            data={toOptions(branches ?? [])}
            value={form.branch_ids}
            onChange={(v) => setForm({ ...form, branch_ids: v })}
            searchable
            clearable
          />
          {!editing && (
            <PasswordInput
              label="Пароль"
              description="Залиште порожнім — буде згенеровано автоматично"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.currentTarget.value })}
            />
          )}
          {editing && (
            <Switch
              label="Активний"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.currentTarget.checked })}
            />
          )}
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={close}>
              Скасувати
            </Button>
            <Button
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!editing && !form.username.trim()}
            >
              Зберегти
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
