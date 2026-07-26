import { useMemo, useRef, useState } from 'react'
import {
  Stack,
  Group,
  Title,
  Select,
  SegmentedControl,
  Button,
  Paper,
  Text,
  Table,
  Alert,
  Badge,
  UnstyledButton,
  Box,
  ScrollArea,
  TextInput,
  Loader,
  Center,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import {
  IconAlertTriangle,
  IconCalendar,
  IconFileSpreadsheet,
  IconPlayerPlay,
  IconSearch,
  IconPlayerStop,
} from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { branchAdminApi, dpdLineAdminApi, lineAdminApi } from '@/api/admin'
import {
  enterpriseApi,
  enterpriseLabel,
  streamEnterpriseVolumes,
  type EnterpriseMappingRow,
  type EnterpriseRecord,
} from '@/api/enterprise'
import { PollProgress } from '@/components/PollProgress'
import { enterpriseRecordTotal } from '@/domain/enterpriseVolumes'
import { useLanguage } from '@/locales/LanguageContext'
import { useSelectionStore } from '@/store/selectionStore'
import { numericStyle } from '@/theme/theme'
import { ArchiveChart } from '@/features/archive/ArchiveChart'
import type { ArchiveRow } from '@/api/entities'

type PeriodType = 'daily' | 'hourly'

function today(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5)
  return d.toISOString().split('T')[0]
}

/**
 * Enterprise poll: pick a branch + enterprise (device) and pull its volumes
 * from the DPD API over the NDJSON progress stream (polls can run minutes).
 */
export function EnterprisePollPage() {
  const { t } = useLanguage()
  const { branchId, setBranchId } = useSelectionStore()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [periodType, setPeriodType] = useState<PeriodType>('daily')
  const [from, setFrom] = useState(today(-7))
  const [to, setTo] = useState(today())
  const [records, setRecords] = useState<EnterpriseRecord[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<{ done?: number; total?: number; phase?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { data: branches } = useQuery({ queryKey: ['admin', 'branches'], queryFn: branchAdminApi.getAll })
  const { data: mappings, isLoading: mappingsLoading } = useQuery({
    queryKey: ['enterprise', 'mappings'],
    queryFn: enterpriseApi.getMappings,
    staleTime: 5 * 60_000,
  })

  // Line names for the list: an enterprise points at either a physical line or
  // a DPD line, and knowing which one it feeds is the whole point of the list.
  const { data: lines } = useQuery({
    queryKey: ['admin', 'lines'],
    queryFn: () => lineAdminApi.getAll(),
    staleTime: 5 * 60_000,
  })
  const { data: dpdLines } = useQuery({
    queryKey: ['admin', 'dpd-lines'],
    queryFn: () => dpdLineAdminApi.getAll().catch(() => []),
    staleTime: 5 * 60_000,
  })

  const lineLabel = useMemo(() => {
    const m = new Map<number, string>()
    ;(lines ?? []).forEach((l) => m.set(l.id, l.name))
    ;(dpdLines ?? []).forEach((d) => m.set(d.id, `[ДПД] ${d.name}`))
    return (row: EnterpriseMappingRow) => {
      const id = row.line_id ?? row.dpd_line_id
      return id != null ? (m.get(id) ?? `#${id}`) : null
    }
  }, [lines, dpdLines])

  const list = useMemo(() => {
    const all = mappings ?? []
    const q = search.trim().toLowerCase()
    return all
      .filter((m) => !branchId || m.branch_id === branchId)
      .filter((m) => {
        if (!q) return true
        return (
          enterpriseLabel(m).toLowerCase().includes(q) ||
          String(m.ser_num ?? '').includes(q) ||
          (lineLabel(m) ?? '').toLowerCase().includes(q)
        )
      })
  }, [mappings, branchId, search, lineLabel])

  const selectedMapping = list.find((m) => m.id === selected) ?? null

  const run = async () => {
    if (!selectedMapping) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    setProgress(null)
    setRecords(null)
    try {
      const res = await streamEnterpriseVolumes(
        {
          from_date: from,
          to_date: to,
          period_type: periodType,
          serNum: selectedMapping.ser_num ?? undefined,
          mfDev: selectedMapping.mf_dev ?? undefined,
          typeDev: selectedMapping.type_dev ?? undefined,
          chNum: selectedMapping.ch_num ?? undefined,
          line_id: (() => {
            const id = selectedMapping.line_id ?? selectedMapping.dpd_line_id
            return id != null ? [id] : undefined
          })(),
        },
        { onProgress: setProgress, signal: ctrl.signal },
      )
      setRecords(res)
    } catch (e) {
      const err = e as Error
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const stop = () => {
    abortRef.current?.abort()
    setLoading(false)
  }

  const rows: ArchiveRow[] = useMemo(
    () =>
      (records ?? []).map((r) => ({
        period: String(r.period),
        volume: enterpriseRecordTotal(r as never),
        temperature: r.temperature,
        pressure: r.pressure,
      })),
    [records],
  )

  const totalVolume = rows.reduce((s, r) => s + (Number(r.volume) || 0), 0)

  const exportExcel = () => {
    if (!rows.length) return
    const header = ['Період', 'Обʼєм, м³', 'Температура', 'Тиск']
    const body = rows.map((r) => [r.period, Number(r.volume) || 0, r.temperature ?? '', r.pressure ?? ''])
    const ws = XLSX.utils.aoa_to_sheet([header, ...body])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Підприємство')
    XLSX.writeFile(wb, `enterprise_${selectedMapping?.ser_num ?? 'poll'}_${from}_${to}.xlsx`)
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={3}>{t('enterprisePoll')}</Title>
        <Select
          placeholder="Всі філії"
          data={(branches ?? []).map((b) => ({ value: String(b.id), label: b.name }))}
          value={branchId != null ? String(branchId) : null}
          onChange={(v) => setBranchId(v ? Number(v) : null)}
          clearable
          searchable
          size="xs"
          w={260}
        />
      </Group>

      <Box style={{ display: 'flex', gap: 'var(--mantine-spacing-md)', alignItems: 'flex-start' }}>
        <Paper
          withBorder
          radius="md"
          style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 200px)' }}
        >
          <Box p="sm" pb={4}>
            <TextInput
              placeholder={t('searchEnterprise')}
              leftSection={<IconSearch size={15} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              size="xs"
            />
          </Box>
          <ScrollArea className="hlv-table-scroll" style={{ flex: 1 }} type="hover">
            {mappingsLoading ? (
              <Center py={40}>
                <Loader size="sm" color="petrol" />
              </Center>
            ) : (
              <Stack gap={2} p="xs">
                {list.map((m) => {
                  const line = lineLabel(m)
                  const on = selected === m.id
                  return (
                    <UnstyledButton
                      key={m.id}
                      onClick={() => setSelected(m.id)}
                      px="xs"
                      py={6}
                      style={{
                        borderRadius: 6,
                        background: on ? 'var(--mantine-color-petrol-light)' : undefined,
                      }}
                      className={on ? undefined : 'hlv-picker-row'}
                    >
                      <Text size="xs" fw={on ? 600 : 400} lh={1.3}>
                        {enterpriseLabel(m)}
                      </Text>
                      <Group gap={6} mt={2} wrap="nowrap">
                        <Text size="10px" c={line ? 'petrol' : 'amber.6'} lineClamp={1}>
                          {line ?? 'без лінії'}
                        </Text>
                        {m.ser_num != null && (
                          <Text size="10px" c="dimmed" style={numericStyle} ml="auto">
                            {m.ser_num}
                          </Text>
                        )}
                      </Group>
                    </UnstyledButton>
                  )
                })}
                {list.length === 0 && (
                  <Text size="xs" c="dimmed" ta="center" py="md" px="xs">
                    {(mappings ?? []).length === 0
                      ? 'Підприємства не налаштовані — додайте їх в Адмініструванні → Підприємства'
                      : t('noData')}
                  </Text>
                )}
              </Stack>
            )}
          </ScrollArea>
        </Paper>

        <Stack gap="md" style={{ flex: 1, minWidth: 0 }}>
          <Paper withBorder radius="md" p="md">
            <Group align="flex-end" gap="sm" wrap="wrap">
              <SegmentedControl
                size="xs"
                value={periodType}
                onChange={(v) => setPeriodType(v as PeriodType)}
                data={[
                  { value: 'daily', label: t('daily') },
                  { value: 'hourly', label: t('hourly') },
                ]}
              />
              <DatePickerInput
                aria-label={t('from')}
                leftSection={<IconCalendar size={15} />}
                value={from}
                onChange={(v) => v && setFrom(v)}
                valueFormat="DD.MM.YYYY"
                size="xs"
                w={140}
                popoverProps={{ zIndex: 500, withinPortal: true }}
              />
              <DatePickerInput
                aria-label={t('to')}
                leftSection={<IconCalendar size={15} />}
                value={to}
                onChange={(v) => v && setTo(v)}
                valueFormat="DD.MM.YYYY"
                size="xs"
                w={140}
                popoverProps={{ zIndex: 500, withinPortal: true }}
              />
              {loading ? (
                <Button
                  size="xs"
                  color="red"
                  variant="light"
                  leftSection={<IconPlayerStop size={15} />}
                  onClick={stop}
                >
                  Зупинити
                </Button>
              ) : (
                <Button
                  size="xs"
                  leftSection={<IconPlayerPlay size={15} />}
                  onClick={run}
                  disabled={!selectedMapping}
                >
                  Опитати
                </Button>
              )}
              <Button
                size="xs"
                variant="light"
                color="teal"
                leftSection={<IconFileSpreadsheet size={15} />}
                onClick={exportExcel}
                disabled={!rows.length}
                ml="auto"
              >
                {t('excel')}
              </Button>
            </Group>

            {selectedMapping && (
              <Group gap="xs" mt="sm">
                <Badge variant="light" color="petrol" tt="none">
                  {enterpriseLabel(selectedMapping)}
                </Badge>
                {lineLabel(selectedMapping) && (
                  <Badge variant="outline" color="gray" tt="none">
                    {lineLabel(selectedMapping)}
                  </Badge>
                )}
                {selectedMapping.ser_num != null && (
                  <Text size="xs" c="dimmed" style={numericStyle}>
                    S/N {selectedMapping.ser_num}
                  </Text>
                )}
                {selectedMapping.model_name && (
                  <Text size="xs" c="dimmed">
                    {selectedMapping.manufacturer_short_name} {selectedMapping.model_name}
                  </Text>
                )}
              </Group>
            )}

            {loading && (
              <Box mt="sm">
                <PollProgress progress={progress ?? { phase: 'polling' }} />
              </Box>
            )}
          </Paper>

          {error && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
              {error}
            </Alert>
          )}

          {records && rows.length > 0 && (
            <>
              <Paper withBorder radius="md">
                <Group justify="space-between" p="sm">
                  <Text fw={600} size="sm">
                    {t('records')}: {rows.length}
                  </Text>
                  <Text fw={700} style={numericStyle}>
                    {totalVolume.toLocaleString('uk-UA', { maximumFractionDigits: 3 })} м³
                  </Text>
                </Group>
                <ScrollArea.Autosize mah={320} type="auto">
                  <Table striped highlightOnHover stickyHeader verticalSpacing={6}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Період</Table.Th>
                        <Table.Th ta="right">Обʼєм, м³</Table.Th>
                        <Table.Th ta="right">Температура</Table.Th>
                        <Table.Th ta="right">Тиск</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {rows.map((r, i) => (
                        <Table.Tr key={i}>
                          <Table.Td>{String(r.period).replace('T', ' ').slice(0, 16)}</Table.Td>
                          <Table.Td ta="right" style={numericStyle}>
                            {Number(r.volume).toLocaleString('uk-UA', { maximumFractionDigits: 3 })}
                          </Table.Td>
                          <Table.Td ta="right" style={numericStyle}>
                            {r.temperature ?? '—'}
                          </Table.Td>
                          <Table.Td ta="right" style={numericStyle}>
                            {r.pressure ?? '—'}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea.Autosize>
              </Paper>

              <ArchiveChart rows={rows} type={periodType} meta={{ kind: 'dpd' }} />
            </>
          )}

          {records && rows.length === 0 && !loading && (
            <Alert variant="light" color="amber" icon={<IconAlertTriangle size={16} />}>
              {t('enterpriseNoData')}
            </Alert>
          )}
        </Stack>
      </Box>
    </Stack>
  )
}
