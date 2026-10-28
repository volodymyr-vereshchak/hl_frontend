import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  Paper,
  PasswordInput,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleDashed,
  IconCloudDownload,
  IconInfoCircle,
  IconMinus,
  IconRefresh,
  IconSettings,
  IconX,
} from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  systemUpdateApi,
  watchUpdate,
  WatchError,
  type RepoConfig,
  type RepoKind,
  type UpdateCheck,
  type UpdateJob,
  type UpdateJobSummary,
  type UpdateStep,
  type UpdaterStatus,
} from '@/api/systemUpdate'
import { AdminTabHeader } from '../AdminTableShell'
import {
  REPO_KINDS,
  REPO_LABEL,
  RESULT_META,
  formatDate,
  pendingCommits,
  updateBlocker,
  updateTarget,
} from './systemUpdateState'

const STATUS_KEY = ['admin', 'system-update', 'status']
const HISTORY_KEY = ['admin', 'system-update', 'history']
const WATCH_STORAGE = 'hlv-system-update-watch'
const RELOAD_SECONDS = 5

interface Watch {
  jobId: string
  token: string
  /** Set once the page was reloaded for this job, so it is not reloaded again. */
  reloaded?: boolean
}

function readWatch(): Watch | null {
  try {
    const raw = sessionStorage.getItem(WATCH_STORAGE)
    return raw ? (JSON.parse(raw) as Watch) : null
  } catch {
    return null
  }
}

function writeWatch(watch: Watch | null) {
  try {
    if (watch) sessionStorage.setItem(WATCH_STORAGE, JSON.stringify(watch))
    else sessionStorage.removeItem(WATCH_STORAGE)
  } catch {
    /* private mode — the progress is then lost on reload, nothing worse */
  }
}

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })

/**
 * «Версія програми» — updating the application from GitHub with one button.
 *
 * The work is done by the updater container next to the app: it fetches,
 * backs up the database, rebuilds what changed, restarts and checks — and
 * returns to the previous version if the new one does not come up. This tab
 * only asks and watches. The watch survives a page reload (sessionStorage),
 * because the reload is how a finished update hands over the new frontend.
 */
export function SystemUpdateTab() {
  const qc = useQueryClient()
  const [watch, setWatchState] = useState<Watch | null>(readWatch)
  const setWatch = (w: Watch | null) => {
    writeWatch(w)
    setWatchState(w)
  }
  const [logJobId, setLogJobId] = useState<string | null>(null)

  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: systemUpdateApi.status,
    // Somebody else's update in progress is followed through the backend.
    refetchInterval: (q) => (q.state.data?.busy && !watch ? 3000 : false),
    retry: false,
  })
  const history = useQuery({
    queryKey: HISTORY_KEY,
    queryFn: systemUpdateApi.history,
    retry: false,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: STATUS_KEY })
    qc.invalidateQueries({ queryKey: HISTORY_KEY })
  }

  const check = useMutation({
    mutationFn: systemUpdateApi.check,
    onSuccess: (result) => {
      qc.setQueryData<UpdaterStatus>(STATUS_KEY, (old) => (old ? { ...old, check: result } : old))
      const n = pendingCommits(result)
      notifications.show({
        message: n ? `Знайдено нових змін: ${n}` : 'Встановлено останню версію',
        color: 'teal',
      })
    },
    onError: notifyErr,
  })

  const start = useMutation({
    mutationFn: (c: UpdateCheck) => systemUpdateApi.start(updateTarget(c)),
    onSuccess: (started) => setWatch({ jobId: started.job_id, token: started.watch_token }),
    onError: notifyErr,
  })

  const data = status.data
  // Only the server's copy: it drops a check made before the installed commit
  // or the branch moved, and a result kept here would outlive that — offering
  // an update to what is already running.
  const lastCheck = data?.check ?? null
  const busy = !!data?.busy || !!watch
  const blocker = updateBlocker(lastCheck, busy)

  const confirmStart = (c: UpdateCheck) =>
    modals.openConfirmModal({
      title: 'Оновити програму?',
      children: <ConfirmText check={c} />,
      labels: { confirm: 'Оновити', cancel: 'Скасувати' },
      onConfirm: () => start.mutate(c),
    })

  return (
    <Stack gap="md">
      <AdminTabHeader
        title="Версія програми"
        description="Оновлення з GitHub: копія бази, перезбирання, перезапуск, повернення попередньої версії при збої"
        actions={
          <>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconRefresh size={16} />}
              onClick={() => check.mutate()}
              loading={check.isPending}
              disabled={busy || !data}
            >
              Перевірити оновлення
            </Button>
            <Tooltip label={blocker} disabled={!blocker}>
              <Button
                size="xs"
                leftSection={<IconCloudDownload size={16} />}
                onClick={() => lastCheck && confirmStart(lastCheck)}
                loading={start.isPending}
                disabled={!!blocker || check.isPending}
              >
                Оновити
              </Button>
            </Tooltip>
          </>
        }
      />

      {status.error && !watch && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          {status.error.message}
        </Alert>
      )}

      {watch && (
        <WatchPanel
          watch={watch}
          onReloaded={() => setWatch({ ...watch, reloaded: true })}
          onClose={() => {
            setWatch(null)
            refresh()
          }}
        />
      )}

      {!watch && data?.busy && data.job && <ForeignJob job={data.job} />}

      {data && (
        <>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            {REPO_KINDS.map((kind) => (
              <RepoCard key={kind} kind={kind} status={data} check={lastCheck} />
            ))}
          </SimpleGrid>

          {lastCheck && <CheckFindings check={lastCheck} />}
          {lastCheck && pendingCommits(lastCheck) > 0 && <WhatsNew check={lastCheck} />}

          <RepoSettings status={data} disabled={busy} onSaved={refresh} />
        </>
      )}

      {status.isLoading && <Loader size="sm" color="petrol" />}

      <HistoryTable jobs={history.data ?? []} loading={history.isLoading} onOpen={setLogJobId} />
      <JobLogModal jobId={logJobId} onClose={() => setLogJobId(null)} />
    </Stack>
  )
}

function ConfirmText({ check }: { check: UpdateCheck }) {
  const parts = REPO_KINDS.filter((k) => (check.repos[k]?.ahead ?? 0) > 0).map(
    (k) => `${REPO_LABEL[k].toLowerCase()} — ${check.repos[k]!.ahead} змін`,
  )
  return (
    <Stack gap={6}>
      <Text size="sm">Буде встановлено: {parts.join(', ')}.</Text>
      {check.repos.backend?.ahead ? (
        <Text size="sm">
          Перед заміною буде зроблено копію бази, планувальник зупиниться на час оновлення.
        </Text>
      ) : null}
      {check.repos.backend?.migrations && (
        <Text size="sm" c="yellow.7">
          Оновлення змінює структуру бази. При збої її буде повернуто автоматично.
        </Text>
      )}
      <Text size="sm">
        Програма буде недоступна 1–2 хвилини. Цю сторінку закривати не потрібно.
      </Text>
    </Stack>
  )
}

function RepoCard({
  kind,
  status,
  check,
}: {
  kind: RepoKind
  status: UpdaterStatus
  check: UpdateCheck | null
}) {
  const installed = status.installed[kind]
  const repo = check?.repos[kind]
  const ahead = repo?.ahead ?? 0
  const stale =
    kind === 'backend' &&
    status.running_backend &&
    installed.sha &&
    status.running_backend !== installed.sha

  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" mb="xs">
        <Text fw={600}>{REPO_LABEL[kind]}</Text>
        {repo?.error ? (
          <Badge color="red" variant="light">
            помилка
          </Badge>
        ) : repo ? (
          ahead > 0 ? (
            <Badge color="blue" variant="light">
              нових змін: {ahead}
            </Badge>
          ) : (
            <Badge color="teal" variant="light">
              остання версія
            </Badge>
          )
        ) : (
          <Badge color="gray" variant="light">
            не перевірено
          </Badge>
        )}
      </Group>
      <Stack gap={4}>
        <CommitLine
          title="Встановлено"
          sha={installed.short}
          subject={installed.subject}
          date={installed.date}
        />
        {repo?.remote && (
          <CommitLine
            title={`У ${repo.branch}`}
            sha={repo.remote.short}
            subject={repo.remote.subject}
            date={repo.remote.date}
          />
        )}
        {installed.error && (
          <Text size="xs" c="red">
            {installed.error}
          </Text>
        )}
        {stale && (
          <Text size="xs" c="yellow.7">
            Працює {status.running_backend!.slice(0, 8)} — код на диску новіший, бекенд не
            перезапущено
          </Text>
        )}
        <Text size="xs" c="dimmed">
          {status.config.repos[kind]?.url}
        </Text>
      </Stack>
    </Paper>
  )
}

function CommitLine({
  title,
  sha,
  subject,
  date,
}: {
  title: string
  sha?: string
  subject?: string
  date?: string
}) {
  return (
    <Group gap="xs" wrap="nowrap" align="baseline">
      <Text size="xs" c="dimmed" w={90} style={{ flexShrink: 0 }}>
        {title}
      </Text>
      <Code>{sha ?? '—'}</Code>
      <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }} title={subject}>
        {subject}
      </Text>
      <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
        {formatDate(date)}
      </Text>
    </Group>
  )
}

function CheckFindings({ check }: { check: UpdateCheck }) {
  if (!check.problems.length && !check.notes.length) return null
  return (
    <Stack gap="xs">
      {check.problems.map((p) => (
        <Alert key={p} color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          {p}
        </Alert>
      ))}
      {check.notes.map((n) => (
        <Alert key={n} color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
          {n}
        </Alert>
      ))}
      <Text size="xs" c="dimmed">
        Перевірено {formatDate(check.checked_at)}
      </Text>
    </Stack>
  )
}

function WhatsNew({ check }: { check: UpdateCheck }) {
  return (
    <Paper withBorder radius="md" p="md">
      <Text fw={600} mb="xs">
        Що нового
      </Text>
      <Stack gap="sm">
        {REPO_KINDS.filter((k) => (check.repos[k]?.commits?.length ?? 0) > 0).map((kind) => {
          const repo = check.repos[kind]!
          return (
            <Box key={kind}>
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4}>
                {REPO_LABEL[kind]}
                {repo.ahead! > repo.commits!.length &&
                  ` (показано ${repo.commits!.length} з ${repo.ahead})`}
              </Text>
              <Stack gap={2}>
                {repo.commits!.map((c) => (
                  <Group key={c.sha} gap="xs" wrap="nowrap" align="baseline">
                    <Text size="xs" c="dimmed" w={130} style={{ flexShrink: 0 }}>
                      {formatDate(c.date)}
                    </Text>
                    <Text size="sm" style={{ flex: 1, minWidth: 0 }}>
                      {c.subject}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </Box>
          )
        })}
      </Stack>
    </Paper>
  )
}

function RepoSettings({
  status,
  disabled,
  onSaved,
}: {
  status: UpdaterStatus
  disabled: boolean
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [repos, setRepos] = useState<Record<RepoKind, RepoConfig>>(status.config.repos)
  const [token, setToken] = useState('')

  useEffect(() => {
    if (!open) {
      setRepos(status.config.repos)
      setToken('')
    }
  }, [open, status.config.repos])

  const save = useMutation({
    mutationFn: (clearToken: boolean) =>
      systemUpdateApi.saveConfig(repos, clearToken ? '' : token.trim() || null),
    onSuccess: () => {
      notifications.show({ message: 'Налаштування збережено', color: 'teal' })
      setOpen(false)
      onSaved()
    },
    onError: notifyErr,
  })

  const edit = (kind: RepoKind, field: keyof RepoConfig, value: string) =>
    setRepos((r) => ({ ...r, [kind]: { ...r[kind], [field]: value } }))

  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between">
        <Box>
          <Text fw={600}>Репозиторій</Text>
          <Text size="xs" c="dimmed">
            Звідки береться код. Токен потрібен лише для приватного репозиторію
            {status.config.token_set ? ' — збережено' : ''}.
          </Text>
        </Box>
        {!open && (
          <Button
            size="xs"
            variant="default"
            leftSection={<IconSettings size={16} />}
            onClick={() => setOpen(true)}
            disabled={disabled}
          >
            Змінити
          </Button>
        )}
      </Group>
      {open && (
        <Stack gap="sm" mt="md">
          {REPO_KINDS.map((kind) => (
            <Group key={kind} gap="sm" align="flex-end" wrap="nowrap">
              <TextInput
                label={`${REPO_LABEL[kind]}: адреса`}
                value={repos[kind].url}
                onChange={(e) => edit(kind, 'url', e.currentTarget.value)}
                placeholder="https://github.com/…/….git"
                size="xs"
                style={{ flex: 1 }}
              />
              <TextInput
                label="Гілка"
                value={repos[kind].branch}
                onChange={(e) => edit(kind, 'branch', e.currentTarget.value)}
                size="xs"
                w={140}
              />
            </Group>
          ))}
          <PasswordInput
            label="Токен доступу (GitHub, лише читання)"
            value={token}
            onChange={(e) => setToken(e.currentTarget.value)}
            placeholder={
              status.config.token_set
                ? 'збережено — залиште порожнім, щоб не змінювати'
                : 'не потрібен для публічного репозиторію'
            }
            size="xs"
            autoComplete="off"
          />
          <Group justify="space-between">
            {status.config.token_set ? (
              <Anchor size="xs" c="red" component="button" onClick={() => save.mutate(true)}>
                Видалити збережений токен
              </Anchor>
            ) : (
              <span />
            )}
            <Group gap="xs">
              <Button size="xs" variant="default" onClick={() => setOpen(false)}>
                Скасувати
              </Button>
              <Button size="xs" onClick={() => save.mutate(false)} loading={save.isPending}>
                Зберегти
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Paper>
  )
}

/**
 * The progress of the update this browser started. Read from the updater
 * through nginx; a failed read while the containers are being replaced is
 * expected and only means "ask again".
 */
function WatchPanel({
  watch,
  onReloaded,
  onClose,
}: {
  watch: Watch
  onReloaded: () => void
  onClose: () => void
}) {
  const progress = useQuery({
    queryKey: ['admin', 'system-update', 'watch', watch.jobId],
    queryFn: () => watchUpdate(watch.jobId, watch.token),
    retry: false,
    refetchIntervalInBackground: true,
    refetchInterval: (q) => {
      if (q.state.data?.status === 'finished') return false
      // The updater has forgotten this job (restarted, or it finished long ago).
      if (q.state.error instanceof WatchError && q.state.error.status === 404) return false
      return 2000
    },
  })

  const job = progress.data
  const lost = progress.error instanceof WatchError && progress.error.status === 404
  const unreachable = !!progress.error && !lost

  // A finished update reloads the page: the new frontend is only picked up by
  // loading it, and the old one may not speak to the new backend correctly.
  const [countdown, setCountdown] = useState<number | null>(null)
  const reloadArmed = useRef(false)
  const onReloadedRef = useRef(onReloaded)
  onReloadedRef.current = onReloaded
  useEffect(() => {
    if (job?.result !== 'updated' || watch.reloaded || reloadArmed.current) return
    reloadArmed.current = true
    setCountdown(RELOAD_SECONDS)
  }, [job?.result, watch.reloaded])
  useEffect(() => {
    if (countdown === null) return
    if (countdown <= 0) {
      onReloadedRef.current()
      window.location.reload()
      return
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const meta = job?.result ? RESULT_META[job.result] : null

  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <Text fw={600}>Оновлення {job ? formatDate(job.started_at) : ''}</Text>
          {meta ? (
            <Badge color={meta.color} variant="light">
              {meta.label}
            </Badge>
          ) : (
            <Badge color="blue" variant="light" leftSection={<Loader size={10} color="blue" />}>
              виконується
            </Badge>
          )}
        </Group>
        {(job?.status === 'finished' || lost) && countdown === null && (
          <Button size="xs" variant="default" onClick={onClose}>
            Закрити
          </Button>
        )}
      </Group>

      {unreachable && job?.status !== 'finished' && (
        <Text size="sm" c="dimmed" mb="sm">
          Програма перезапускається — зв’язок відновиться за кілька секунд…
        </Text>
      )}
      {lost && (
        <Alert color="yellow" variant="light" mb="sm">
          Хід цього оновлення більше недоступний. Результат — в історії нижче.
        </Alert>
      )}
      {job?.message && job.status === 'finished' && (
        <Alert color={meta?.color ?? 'gray'} variant="light" mb="sm">
          {job.message}
        </Alert>
      )}
      {job?.warnings.map((w) => (
        <Alert
          key={w}
          color="yellow"
          variant="light"
          mb="sm"
          icon={<IconAlertTriangle size={16} />}
        >
          {w}
        </Alert>
      ))}
      {countdown !== null && (
        <Group gap="sm" mb="sm">
          <Text size="sm">Сторінку буде перезавантажено за {countdown} с</Text>
          <Button size="compact-xs" onClick={() => setCountdown(0)}>
            Зараз
          </Button>
        </Group>
      )}

      {job && <JobSteps steps={job.steps} />}
      {job && <JobLog lines={job.log} follow={job.status === 'running'} />}
      {!job && !progress.error && <Loader size="sm" />}
    </Paper>
  )
}

/** An update somebody else started, followed through the backend. */
function ForeignJob({ job }: { job: UpdateJob }) {
  return (
    <Paper withBorder radius="md" p="md">
      <Text fw={600} mb="sm">
        Оновлення запустив {job.started_by || '—'} о {formatDate(job.started_at)}
      </Text>
      <JobSteps steps={job.steps} />
    </Paper>
  )
}

const STEP_ICON: Record<UpdateStep['state'], React.ReactNode> = {
  pending: (
    <ThemeIcon size={20} radius="xl" variant="light" color="gray">
      <IconCircleDashed size={13} />
    </ThemeIcon>
  ),
  running: <Loader size={20} color="blue" />,
  done: (
    <ThemeIcon size={20} radius="xl" variant="light" color="teal">
      <IconCheck size={13} />
    </ThemeIcon>
  ),
  failed: (
    <ThemeIcon size={20} radius="xl" variant="light" color="red">
      <IconX size={13} />
    </ThemeIcon>
  ),
  skipped: (
    <ThemeIcon size={20} radius="xl" variant="light" color="gray">
      <IconMinus size={13} />
    </ThemeIcon>
  ),
}

function JobSteps({ steps }: { steps: UpdateStep[] }) {
  return (
    <Stack gap={6} mb="sm">
      {steps.map((s, i) => (
        <Group key={s.id} gap="sm" wrap="nowrap">
          {STEP_ICON[s.state]}
          <Text
            size="sm"
            fw={s.state === 'running' ? 600 : 400}
            c={s.state === 'skipped' ? 'dimmed' : undefined}
          >
            {s.id === 'rollback' ? s.label : `${i + 1}. ${s.label}`}
          </Text>
          {s.note && (
            <Text size="xs" c="dimmed" truncate>
              {s.note}
            </Text>
          )}
        </Group>
      ))}
    </Stack>
  )
}

function JobLog({ lines, follow }: { lines: string[]; follow: boolean }) {
  const viewport = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = viewport.current
    if (!box || !follow) return
    const distance = box.scrollHeight - box.scrollTop - box.clientHeight
    if (distance < 120) box.scrollTo({ top: box.scrollHeight })
  }, [lines.length, follow])
  if (!lines.length) return null
  return (
    <ScrollArea h={280} type="auto" viewportRef={viewport}>
      <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
        {lines.join('\n')}
      </Code>
    </ScrollArea>
  )
}

function HistoryTable({
  jobs,
  loading,
  onOpen,
}: {
  jobs: UpdateJobSummary[]
  loading: boolean
  onOpen: (id: string) => void
}) {
  if (loading) return null
  if (!jobs.length) return null
  return (
    <Paper withBorder radius="md">
      <Text fw={600} p="md" pb={0}>
        Історія оновлень
      </Text>
      <Table striped verticalSpacing={6} mt="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={170}>Дата</Table.Th>
            <Table.Th w={140}>Хто</Table.Th>
            <Table.Th w={190}>Результат</Table.Th>
            <Table.Th>Зміни</Table.Th>
            <Table.Th w={90} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {jobs.map((j) => {
            const meta = j.result ? RESULT_META[j.result] : null
            const moved = REPO_KINDS.filter(
              (k) => j.target[k] && j.from[k] && j.target[k] !== j.from[k],
            )
            return (
              <Table.Tr key={j.id}>
                <Table.Td>{formatDate(j.started_at)}</Table.Td>
                <Table.Td>{j.started_by || '—'}</Table.Td>
                <Table.Td>
                  {meta ? (
                    <Tooltip label={j.message} disabled={!j.message} multiline w={360}>
                      <Badge color={meta.color} variant="light">
                        {meta.label}
                      </Badge>
                    </Tooltip>
                  ) : (
                    <Badge color="blue" variant="light">
                      виконується
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {moved.length
                      ? moved
                          .map(
                            (k) =>
                              `${REPO_LABEL[k]} ${j.from[k]!.slice(0, 8)} → ${j.target[k]!.slice(0, 8)}`,
                          )
                          .join('; ')
                      : '—'}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Button size="compact-xs" variant="light" onClick={() => onOpen(j.id)}>
                    Журнал
                  </Button>
                </Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
    </Paper>
  )
}

function JobLogModal({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'system-update', 'job', jobId],
    queryFn: () => systemUpdateApi.job(jobId!),
    enabled: jobId != null,
  })
  const meta = data?.result ? RESULT_META[data.result] : null
  return (
    <Modal opened={jobId != null} onClose={onClose} title={`Оновлення ${jobId ?? ''}`} size="xl">
      {isLoading && <Loader size="sm" />}
      {error && <Alert color="red">{error.message}</Alert>}
      {data && (
        <Stack gap="sm">
          {meta && data.message && (
            <Alert color={meta.color} variant="light">
              {data.message}
            </Alert>
          )}
          <JobSteps steps={data.steps} />
          <JobLog lines={data.log} follow={false} />
        </Stack>
      )}
    </Modal>
  )
}
