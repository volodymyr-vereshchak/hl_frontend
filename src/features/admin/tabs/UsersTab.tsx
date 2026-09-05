import { useState } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  Group,
  MultiSelect,
  PasswordInput,
  Switch,
  Text,
  Tooltip,
} from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconKey } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { branchAdminApi, userApi, type AdminUser, type UserWrite } from '@/api/admin'
import { copyText } from '@/lib/clipboard'
import { toOptions } from '../useAdminTopology'
import { CrudTable } from '../CrudTable'

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })

const USERS_KEY = ['admin', 'users']

/** What `userApi.create` answers with — the password is in it and nowhere else. */
type CreatedUser = Awaited<ReturnType<typeof userApi.create>>

const ROLE_OPTIONS = [
  { value: 'viewer', label: 'Спостерігач' },
  { value: 'admin', label: 'Адміністратор' },
]

/**
 * Користувачі. Built on CrudTable, which it could not use before: branch access
 * is a many-to-many list with no place in a text/number/checkbox/select field
 * spec, and the API is asymmetric — it READS `allowed_branch_ids` and WRITES
 * `branch_ids`. `renderField`, `toForm`, `toPayload` and `onlyOn` are what
 * closed that gap.
 *
 * An empty branch list means every branch, which is why the table says so
 * explicitly rather than showing a blank cell.
 */
export function UsersTab() {
  const qc = useQueryClient()
  // A generated password is shown once and never again — keep it on screen
  // until it is dismissed.
  const [newPassword, setNewPassword] = useState<{ login: string; password: string } | null>(null)

  const { data: branches } = useQuery({
    queryKey: ['admin', 'branches'],
    queryFn: branchAdminApi.getAll,
  })
  const { data: users } = useQuery({ queryKey: USERS_KEY, queryFn: userApi.getAll })
  const { data: authMode } = useQuery({
    queryKey: ['admin', 'auth-mode'],
    queryFn: userApi.getMode,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: USERS_KEY })
  const branchName = (id: number) => (branches ?? []).find((b) => b.id === id)?.name ?? `#${id}`

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

  // No password of ours = provisioned by a domain login. Older API builds omit
  // the field; treat that as a local account, which is what every account was
  // before domain login existed.
  const isDomain = (u: AdminUser) => u.has_password === false

  // Domain accounts on a server with domain login switched off cannot sign in
  // at all — and nothing says so until someone tries. Sessions already open
  // keep running to their expiry, so the breakage arrives days late and one
  // user at a time, which is exactly when nobody connects it to the switch.
  const domainStranded = authMode?.ldap_enabled === false && (users ?? []).some(isDomain)

  return (
    <CrudTable<AdminUser, CreatedUser>
      title="Користувачі"
      description="Облікові записи, ролі та доступ до філій"
      queryKey={USERS_KEY}
      fetchAll={userApi.getAll}
      searchKeys={['username', 'display_name']}
      rowLabel={(u) => u.username}
      // Each picks its own fields rather than spreading the payload: a spread
      // would send `password: ''` when the box was left blank — the server
      // would set an empty password instead of generating one — and would put
      // a username and a password into every EDIT, which is not what editing a
      // user is allowed to do.
      create={(v) =>
        userApi.create({
          username: String(v.username ?? '').trim(),
          display_name: (v.display_name as string | null) ?? null,
          role: v.role as UserWrite['role'],
          branch_ids: (v.branch_ids as number[]) ?? [],
          // Left out entirely when blank, which is what makes the server
          // generate one.
          ...(v.password ? { password: String(v.password) } : {}),
        })
      }
      update={(id, v) =>
        userApi.update(id, {
          display_name: (v.display_name as string | null) ?? null,
          role: v.role as UserWrite['role'],
          branch_ids: (v.branch_ids as number[]) ?? [],
          active: !!v.active,
        })
      }
      remove={(id) => userApi.remove(id)}
      onCreated={(created) =>
        setNewPassword({ login: created.user.username, password: created.password })
      }
      // Row → form: the read shape names branch access differently from the
      // write shape, which is why this tab could not be a plain CrudTable.
      toForm={(u) => ({
        username: u.username,
        display_name: u.display_name ?? '',
        role: u.role,
        active: u.active,
        branch_ids: (u.allowed_branch_ids ?? []).map(String),
        password: '',
      })}
      // The one transformation both share: the picker works in strings, the
      // API in ids. Everything else each of them takes from here by name.
      toPayload={(v) => ({
        ...v,
        display_name: (v.display_name as string) || null,
        branch_ids: ((v.branch_ids as string[]) ?? []).map(Number),
      })}
      notice={
        <>
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
                Видати їм локальний пароль не можна: він лишився б чинним і після повернення
                доменної авторизації, тобто пережив би і зміну доменного пароля, і блокування
                облікового запису в домені. Або увімкніть доменну авторизацію назад, або видаліть ці
                записи й створіть натомість локальні.
              </Text>
              {authMode?.auto_login && (
                <Text size="sm" mt={6} fw={600}>
                  Увага: увімкнено автоматичний вхід. Ці користувачі не побачать помилки — їх мовчки
                  пустить під спільним обліковим записом за замовчуванням, з чужими правами на
                  філії.
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
        </>
      }
      extraRowActions={(u) => (
        <Tooltip
          label={
            isDomain(u)
              ? 'Пароль зберігається в домені (Active Directory) — змінюється засобами домену'
              : 'Згенерувати новий пароль'
          }
          withArrow
        >
          {/* Kept in place, inert, rather than dropped: the gap would read as a
              missing feature instead of an answer to "why can I not reset this
              one?". `data-disabled` and not `disabled` — a truly disabled
              control swallows the pointer events the tooltip needs, so the
              explanation would never appear. */}
          <ActionIcon
            variant="subtle"
            color="amber"
            data-disabled={isDomain(u) || undefined}
            onClick={() =>
              isDomain(u)
                ? undefined
                : modals.openConfirmModal({
                    title: 'Скидання пароля',
                    children: (
                      <Text size="sm">
                        Згенерувати новий пароль для «{u.username}»? Старий перестане діяти, і
                        поточний сеанс користувача завершиться.
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
      )}
      fields={[
        {
          key: 'id',
          label: 'ID',
          hideInForm: true,
          render: (u) => <Text c="dimmed">{u.id}</Text>,
        },
        {
          key: 'username',
          label: 'Логін',
          required: true,
          // Chosen once; afterwards it identifies the account everywhere.
          onlyOn: 'create',
          render: (u) => (
            <Group gap={6} wrap="nowrap">
              <Text size="sm">{u.username}</Text>
              {isDomain(u) && (
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
          ),
        },
        {
          key: 'display_name',
          label: 'Імʼя',
          render: (u) => <>{u.display_name || '—'}</>,
        },
        {
          key: 'role',
          label: 'Роль',
          type: 'select',
          options: ROLE_OPTIONS,
          render: (u) => (
            <Badge
              variant="light"
              color={u.role === 'admin' ? 'amber' : 'petrol'}
              size="sm"
              tt="none"
            >
              {u.role === 'admin' ? 'Адміністратор' : 'Спостерігач'}
            </Badge>
          ),
        },
        {
          key: 'branch_ids',
          label: 'Доступ до філій',
          renderField: (value, onChange) => (
            <MultiSelect
              label="Доступ до філій"
              description="Порожньо — доступ до всіх філій"
              placeholder={(value as string[])?.length ? undefined : 'Усі філії'}
              data={toOptions(branches ?? [])}
              value={(value as string[]) ?? []}
              onChange={onChange}
              searchable
              clearable
            />
          ),
          render: (u) => {
            const allowed = u.allowed_branch_ids ?? []
            return allowed.length === 0 ? (
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
            )
          },
        },
        {
          key: 'password',
          label: 'Пароль',
          onlyOn: 'create',
          hideInTable: true,
          renderField: (value, onChange) => (
            <PasswordInput
              label="Пароль"
              description="Залиште порожнім — буде згенеровано автоматично"
              value={(value as string) ?? ''}
              onChange={(e) => onChange(e.currentTarget.value)}
            />
          ),
        },
        {
          key: 'active',
          label: 'Активний',
          type: 'checkbox',
          onlyOn: 'edit',
          render: (u) => (
            <Switch
              size="xs"
              color="petrol"
              checked={u.active}
              onChange={() => toggleActive.mutate(u)}
            />
          ),
        },
      ]}
    />
  )
}
