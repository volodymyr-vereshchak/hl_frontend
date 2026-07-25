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
  Progress,
  Alert,
  Badge,
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
import { branchAdminApi } from '@/api/admin'
import { enterpriseApi, streamEnterpriseVolumes, type EnterpriseRecord } from '@/api/enterprise'
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

  const list = useMemo(() => {
    const all = mappings ?? []
    const q = search.trim().toLowerCase()
    return all
      .filter((m) => !branchId || m.branch_id === branchId)
      .filter((m) => !q || String(m.name ?? '').toLowerCase().includes(q) || String(m.ser_num ?? '').includes(q))
  }, [mappings, branchId, search])

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
          line_id: selectedMapping.line_id ? [selectedMapping.line_id] : undefined,
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

  const pct = progress?.total ? Math.round(((progress.done ?? 0) / progress.total) * 100) : null

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
          <ScrollArea style={{ flex: 1 }} type="hover">
            {mappingsLoading ? (
              <Center py={40}>
                <Loader size="sm" color="petrol" />
              </Center>
            ) : (
              <Stack gap={2} p="xs">
                {list.map((m) => (
                  <Button
                    key={m.id}
                    variant={selected === m.id ? 'light' : 'subtle'}
                    color={selected === m.id ? 'petrol' : 'gray'}
                    size="xs"
                    justify="flex-start"
                    onClick={() => setSelected(m.id)}
                    styles={{ label: { whiteSpace: 'normal', textAlign: 'left', lineHeight: 1.25 } }}
                  >
                    {m.name ?? m.ser_num ?? `#${m.id}`}
                  </Button>
                ))}
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
                <Badge variant="light" color="petrol">
                  {selectedMapping.name ?? selectedMapping.ser_num}
                </Badge>
                {selectedMapping.ser_num && (
                  <Text size="xs" c="dimmed" style={numericStyle}>
                    S/N {selectedMapping.ser_num}
                  </Text>
                )}
              </Group>
            )}

            {loading && (
              <Box mt="sm">
                <Progress value={pct ?? 100} animated={pct === null} color="grape" size="sm" />
                <Text size="xs" c="dimmed" mt={4}>
                  {pct !== null
                    ? `${progress?.done ?? 0} / ${progress?.total} (${pct}%)`
                    : (progress?.phase ?? t('loadingEnterpriseData'))}
                </Text>
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
