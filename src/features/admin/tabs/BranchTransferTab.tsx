import { useRef, useState } from 'react'
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  List,
  Paper,
  Select,
  Stack,
  Table,
  Text,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import {
  IconAlertTriangle,
  IconCheck,
  IconDownload,
  IconPackageExport,
  IconUpload,
} from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { branchTransferApi, type BranchImportReport, type BranchImportTarget } from '@/api/admin'
import { useAdminTopology, toOptions } from '../useAdminTopology'

/** Table name → what an administrator calls it. */
const TABLE_LABELS: Record<string, string> = {
  grmu_branch: 'Філія',
  branch_data_path: 'Шлях до даних філії',
  grmu_branch_dpd_credential: 'Доступ ДПД',
  lumg: 'ЛУМГ',
  lumg_data_path: 'Шляхи ЛУМГ',
  lumg_eis_code: 'ЄІС-коди',
  gas_volume_calc: 'Обчислювачі',
  gas_volume_line: 'Лінії',
  dpd_line: 'Лінії ДПД',
  dpd_line_device: 'Коректори ліній ДПД',
  virtual_line: 'Кільця',
  virtual_line_member: 'Лінії в кільцях',
  gas_route: 'Маршрути',
  gas_route_member: 'Лінії в маршрутах',
  dpd_device: 'Коректори',
  enterprise: 'Підприємства',
  enterprise_device: 'Історія коректорів',
  grmu_branch_device_mapping: 'Маппінг приладів',
}

const label = (table: string) => TABLE_LABELS[table] ?? table

const MATCHED_BY: Record<BranchImportReport['matched_by'], string> = {
  chosen: 'обрана вручну',
  uid: 'знайдена за ідентифікатором перенесення',
  name: 'знайдена за назвою',
  new: 'буде створена',
}

/** `Select` value standing for "не оновлювати наявне, а завести нове". */
const CREATE_NEW = 'new'

const notifyErr = (e: Error) => notifications.show({ message: e.message, color: 'red' })

/** Turn the two pickers into what the endpoint expects. */
function buildTarget(
  branchValue: string | null,
  lumgMap: Record<string, string>,
): BranchImportTarget {
  const mapped = Object.entries(lumgMap).filter(([, v]) => v && v !== CREATE_NEW)
  return {
    createNew: branchValue === CREATE_NEW,
    targetBranchId: branchValue && branchValue !== CREATE_NEW ? Number(branchValue) : undefined,
    lumgMap: Object.fromEntries(mapped.map(([k, v]) => [k, Number(v)])),
  }
}

export function BranchTransferTab() {
  const qc = useQueryClient()
  const { branches } = useAdminTopology()
  const [exportBranch, setExportBranch] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [report, setReport] = useState<BranchImportReport | null>(null)
  /** null until the first preview answers it, then the administrator's choice. */
  const [target, setTarget] = useState<string | null>(null)
  const [lumgMap, setLumgMap] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const preview = async (
    picked: File,
    branchValue: string | null,
    map: Record<string, string>,
    apply = false,
  ) => {
    setBusy(true)
    try {
      const result = await branchTransferApi.upload(
        picked,
        !apply,
        // The first preview asks nothing — it lets the file match itself, and
        // its answer becomes the preselected choice below.
        branchValue === null ? {} : buildTarget(branchValue, map),
      )
      setReport(result)
      if (branchValue === null) {
        setTarget(result.branch_id != null ? String(result.branch_id) : CREATE_NEW)
      }
      if (result.applied) {
        // Every admin screen reads some part of what just changed.
        qc.invalidateQueries({ queryKey: ['admin'] })
        notifications.show({
          title: `Філію «${result.branch_name}» завантажено`,
          message: 'Конфігурацію застосовано',
          color: 'teal',
        })
      }
    } catch (e) {
      setReport(null)
      notifyErr(e as Error)
    } finally {
      setBusy(false)
    }
  }

  const pick = (picked: File | undefined) => {
    if (!picked) return
    setFile(picked)
    setReport(null)
    setTarget(null)
    setLumgMap({})
    void preview(picked, null, {})
    // Let the same file be picked again after an apply.
    if (fileInput.current) fileInput.current.value = ''
  }

  const changeTarget = (value: string | null) => {
    setTarget(value)
    // A different branch has different ЛУМГ — the old mapping means nothing.
    setLumgMap({})
    if (file) void preview(file, value, {})
  }

  const changeLumg = (fileName: string, value: string | null) => {
    const next = { ...lumgMap, [fileName]: value ?? CREATE_NEW }
    setLumgMap(next)
    if (file) void preview(file, target, next)
  }

  return (
    <Stack gap="md">
      <Box>
        <Text fw={600} fz="lg" ff="'Space Grotesk Variable', sans-serif">
          Перенесення філії
        </Text>
        <Text size="xs" c="dimmed">
          Вивантаження налаштованої філії одним файлом і завантаження його на іншому сервері
        </Text>
      </Box>

      {/* ── Вивантаження ─────────────────────────────────────────────────── */}
      <Paper withBorder radius="md" p="md">
        <Stack gap="sm">
          <Group gap="sm" align="flex-end" wrap="wrap">
            <Select
              size="xs"
              w={260}
              label="Філія"
              placeholder="Оберіть філію"
              data={toOptions(branches)}
              value={exportBranch}
              onChange={setExportBranch}
              searchable
            />
            <Button
              size="compact-sm"
              leftSection={<IconPackageExport size={14} />}
              disabled={!exportBranch}
              onClick={() => exportBranch && branchTransferApi.download(Number(exportBranch))}
            >
              Вивантажити конфігурацію
            </Button>
          </Group>

          <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
            <Text size="sm">
              Файл містить <b>пароль до ДПД у відкритому вигляді</b> — поводьтеся з ним як із
              паролем: не надсилайте поштою і не залишайте в теці «Завантаження».
            </Text>
          </Alert>

          <Text size="xs" c="dimmed">
            У файлі: ЛУМГ, шляхи до даних і ЄІС-коди, обчислювачі, лінії з усіма прапорцями, кільця,
            маршрути ФХП, лінії ДПД, підприємства з історією коректорів і доступ до ДПД.{' '}
            <b>Архіви не переносяться</b> — на новому сервері вони наберуться самі з ДПД. Довідники
            (виробники, моделі коректорів, типи обчислювачів і подій) теж не входять: вони їдуть
            разом із кодом у <code>preload_db</code>.
          </Text>
        </Stack>
      </Paper>

      {/* ── Завантаження ─────────────────────────────────────────────────── */}
      <Paper withBorder radius="md" p="md">
        <Stack gap="sm">
          <Group gap="sm" wrap="wrap" align="center">
            <Button
              size="compact-sm"
              variant="default"
              leftSection={<IconUpload size={14} />}
              loading={busy && !report}
              onClick={() => fileInput.current?.click()}
            >
              Обрати файл конфігурації
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => pick(e.currentTarget.files?.[0])}
            />
            {file && (
              <Text size="xs" c="dimmed">
                {file.name}
              </Text>
            )}
          </Group>

          <Text size="xs" c="dimmed">
            Спершу показується, що саме зміниться. Завантаження лише додає й оновлює — те, що є тут
            і відсутнє у файлі, буде перелічено, але не видалено.
          </Text>

          {report && (
            <Stack gap="sm">
              <Divider />

              <Select
                size="xs"
                w={340}
                label="Оновити філію"
                description="Якщо філію тут названо інакше — оберіть її, інакше з'явиться друга"
                data={[
                  ...toOptions(branches),
                  { value: CREATE_NEW, label: '— створити нову філію —' },
                ]}
                value={target}
                onChange={changeTarget}
                disabled={busy}
                searchable
                allowDeselect={false}
              />

              {report.new_lumgs.length > 0 && report.unmatched_lumgs.length > 0 && (
                <LumgMapping report={report} value={lumgMap} busy={busy} onChange={changeLumg} />
              )}

              <ImportReportView
                report={report}
                busy={busy}
                onApply={() => file && preview(file, target, lumgMap, true)}
              />
            </Stack>
          )}
        </Stack>
      </Paper>
    </Stack>
  )
}

/**
 * A ЛУМГ renamed at the branch matches nothing here, so it would arrive as a
 * second ЛУМГ with a second copy of every обчислювач and лінія under it, while
 * the originals keep the archive. This is where that is said out loud and
 * turned into a choice.
 */
function LumgMapping({
  report,
  value,
  busy,
  onChange,
}: {
  report: BranchImportReport
  value: Record<string, string>
  busy: boolean
  onChange: (fileName: string, value: string | null) => void
}) {
  const options = [
    ...report.unmatched_lumgs.map((l) => ({ value: String(l.id), label: l.name })),
    { value: CREATE_NEW, label: '— створити новий —' },
  ]

  return (
    <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
      <Text size="sm" fw={600} mb={6}>
        Ці ЛУМГ є у файлі, але не на цьому сервері
      </Text>
      <Text size="xs" mb={8}>
        Якщо це перейменування — оберіть, який наявний ЛУМГ оновити. Інакше буде створено новий, а
        разом з ним копії всіх його обчислювачів і ліній; архіви лишаться під старим.
      </Text>
      <Stack gap={6}>
        {report.new_lumgs.map((name) => (
          <Group key={name} gap="sm" wrap="nowrap">
            <Text size="xs" w={200} truncate>
              {name}
            </Text>
            <Select
              size="xs"
              w={240}
              data={options}
              value={value[name] ?? CREATE_NEW}
              onChange={(v) => onChange(name, v)}
              disabled={busy}
              allowDeselect={false}
            />
          </Group>
        ))}
      </Stack>
    </Alert>
  )
}

function ImportReportView({
  report,
  busy,
  onApply,
}: {
  report: BranchImportReport
  busy: boolean
  onApply: () => void
}) {
  const tables = [...new Set([...Object.keys(report.created), ...Object.keys(report.updated)])]
  const leftovers = Object.entries(report.local_only)

  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Text size="sm" fw={600}>
          {report.branch_name}
        </Text>
        <Badge size="sm" variant="light" color={report.matched_by === 'new' ? 'blue' : 'gray'}>
          {MATCHED_BY[report.matched_by]}
        </Badge>
        {report.applied && (
          <Badge size="sm" color="teal" leftSection={<IconCheck size={11} />}>
            застосовано
          </Badge>
        )}
      </Group>

      {report.errors.length > 0 && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          <Text size="sm" fw={600} mb={4}>
            Файл не можна застосувати
          </Text>
          <List size="xs" spacing={2}>
            {report.errors.slice(0, 20).map((e) => (
              <List.Item key={e}>{e}</List.Item>
            ))}
          </List>
          {report.errors.length > 20 && (
            <Text size="xs" c="dimmed" mt={4}>
              …та ще {report.errors.length - 20}
            </Text>
          )}
        </Alert>
      )}

      {tables.length > 0 ? (
        <Table withTableBorder highlightOnHover fz="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Що</Table.Th>
              <Table.Th w={110}>Створити</Table.Th>
              <Table.Th w={110}>Оновити</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {tables.map((t) => (
              <Table.Tr key={t}>
                <Table.Td>{label(t)}</Table.Td>
                <Table.Td>{report.created[t] ?? 0}</Table.Td>
                <Table.Td>{report.updated[t] ?? 0}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        report.errors.length === 0 && (
          <Text size="xs" c="dimmed">
            Розбіжностей немає — конфігурація на цьому сервері вже збігається з файлом.
          </Text>
        )
      )}

      {leftovers.length > 0 && (
        <Alert color="gray" variant="light">
          <Text size="xs" fw={600} mb={4}>
            Є тут, але немає у файлі — залишено без змін
          </Text>
          <List size="xs" spacing={2}>
            {leftovers.map(([table, names]) => (
              <List.Item key={table}>
                {label(table)}: {names.slice(0, 8).join(', ')}
                {names.length > 8 && ` …та ще ${names.length - 8}`}
              </List.Item>
            ))}
          </List>
        </Alert>
      )}

      {report.warnings.length > 0 && (
        <Alert color="yellow" variant="light">
          <List size="xs" spacing={2}>
            {report.warnings.slice(0, 10).map((w) => (
              <List.Item key={w}>{w}</List.Item>
            ))}
          </List>
        </Alert>
      )}

      {!report.applied && (
        <Group>
          <Button
            size="compact-sm"
            leftSection={<IconDownload size={14} />}
            color="teal"
            loading={busy}
            disabled={report.errors.length > 0}
            onClick={onApply}
          >
            Застосувати
          </Button>
          <Text size="xs" c="dimmed">
            Поки нічого не записано
          </Text>
        </Group>
      )}
    </Stack>
  )
}
