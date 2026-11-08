import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Anchor,
  Badge,
  Button,
  CloseButton,
  FileButton,
  Group,
  Paper,
  Progress,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import {
  IconAlertTriangle,
  IconCloudDownload,
  IconCopy,
  IconLink,
  IconRefresh,
  IconUpload,
} from '@tabler/icons-react'
import {
  weatherApi,
  type DateRange,
  type WeatherDailyRow,
  type WeatherHourlyRow,
  type WeatherPoint,
} from '@/api/weather'
import {
  archiveLastDay,
  archiveUrl,
  matchLocations,
  parseOpenMeteoJson,
  parseWeatherFile,
  planRequests,
  type ParsedLocation,
  type WeatherRequest,
} from '@/domain/weather/openMeteo'
import { PeriodPicker } from '@/features/archive/PeriodPicker'
import { copyText } from '@/lib/clipboard'
import { useLanguage } from '@/locales/LanguageContext'

/** Rows per POST: nginx caps a request body at 1 MB by default. */
const IMPORT_CHUNK = 2000

const days = (r: DateRange[]) =>
  r.reduce((s, x) => s + (Date.parse(x.last) - Date.parse(x.first)) / 86_400_000 + 1, 0)

async function importRows(pointId: number, daily: WeatherDailyRow[], hourly: WeatherHourlyRow[]) {
  let nd = 0
  let nh = 0
  for (let i = 0; i < daily.length; i += IMPORT_CHUNK) {
    nd += (await weatherApi.import(pointId, daily.slice(i, i + IMPORT_CHUNK), [])).daily
  }
  for (let i = 0; i < hourly.length; i += IMPORT_CHUNK) {
    nh += (await weatherApi.import(pointId, [], hourly.slice(i, i + IMPORT_CHUNK))).hourly
  }
  return { nd, nh }
}

interface Upload {
  file: string
  locations: ParsedLocation[]
  /** Point id per location; null = not imported. */
  target: (number | null)[]
}

export function WeatherDownloadPanel({ branchId, points }: { branchId: number; points: WeatherPoint[] }) {
  const { t } = useLanguage()
  const qc = useQueryClient()
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showLinks, setShowLinks] = useState(false)
  const [uploads, setUploads] = useState<Upload[]>([])

  const plan = useQuery({
    queryKey: ['weather-plan', branchId, from, to, points.map((p) => p.id).join(',')],
    queryFn: () => weatherApi.plan(branchId, from ?? undefined, to ?? undefined),
  })
  // The period starts as the span the consumption archives cover.
  useEffect(() => {
    if (from == null && plan.data?.archive_first) setFrom(plan.data.archive_first)
    if (to == null && plan.data?.archive_last) setTo(plan.data.archive_last)
  }, [plan.data, from, to])

  const gaps = useMemo(() => {
    const byId = new Map((plan.data?.points ?? []).map((p) => [p.point_id, p]))
    return points.map((p) => byId.get(p.id) ?? { point_id: p.id, daily: [], hourly: [] })
  }, [plan.data, points])
  const requests = useMemo(() => planRequests(gaps, archiveLastDay()), [gaps])
  const coords = points.map((p) => ({ lat: p.latitude, lon: p.longitude }))
  const missingTotal = gaps.reduce((s, g) => s + days(g.daily) + days(g.hourly), 0)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['weather-plan'] })
    void qc.invalidateQueries({ queryKey: ['weather-points'] })
  }

  const urlOf = (r: WeatherRequest, format: 'json' | 'csv') =>
    archiveUrl(r.pointIndexes.map((i) => coords[i]), r.kind, r.start, r.end, format)
  const requestLabel = (r: WeatherRequest) =>
    `${r.kind === 'daily' ? t('weatherCoverageDaily') : t('weatherCoverageHourly')} · ${r.start} … ${r.end} · №${
      r.pointIndexes[0] + 1
    }–${r.pointIndexes.at(-1)! + 1}`

  const downloadOnline = async () => {
    setError(null)
    setBusy({ done: 0, total: requests.length })
    let nd = 0
    let nh = 0
    try {
      for (const [k, r] of requests.entries()) {
        let text: string
        try {
          const resp = await fetch(urlOf(r, 'json'))
          text = await resp.text()
          if (!resp.ok) {
            // Open-Meteo explains a refusal in the body: {"error":true,"reason":…}
            parseOpenMeteoJson(text)
            throw new Error(`Open-Meteo: HTTP ${resp.status}`)
          }
        } catch (e) {
          if (e instanceof TypeError) throw new Error(t('weatherNoInternet'))
          throw e
        }
        const locs = parseOpenMeteoJson(text)
        // Online the order is ours: location i is the i-th point of the request.
        for (const [i, loc] of locs.entries()) {
          const point = points[r.pointIndexes[i]]
          if (!point) continue
          const res = await importRows(point.id, loc.daily, loc.hourly)
          nd += res.nd
          nh += res.nh
        }
        setBusy({ done: k + 1, total: requests.length })
      }
      notifications.show({ color: 'teal', message: `${t('weatherImported')}: ${nd} / ${nh}` })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
      refresh()
    }
  }

  const onFiles = async (files: File[]) => {
    setError(null)
    const next: Upload[] = []
    for (const f of files) {
      try {
        const locations = parseWeatherFile(await f.text())
        const idx = matchLocations(
          locations.map((l) => ({ lat: l.latitude, lon: l.longitude })),
          coords,
        )
        next.push({ file: f.name, locations, target: idx.map((i) => (i == null ? null : points[i].id)) })
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`)
      }
    }
    setUploads((u) => [...u, ...next])
  }

  const importUploads = async () => {
    setError(null)
    const jobs = uploads.flatMap((u) =>
      u.locations.map((loc, i) => ({ loc, point: u.target[i] })).filter((j) => j.point != null),
    )
    setBusy({ done: 0, total: jobs.length })
    let nd = 0
    let nh = 0
    try {
      for (const [k, j] of jobs.entries()) {
        const res = await importRows(j.point!, j.loc.daily, j.loc.hourly)
        nd += res.nd
        nh += res.nh
        setBusy({ done: k + 1, total: jobs.length })
      }
      notifications.show({ color: 'teal', message: `${t('weatherImported')}: ${nd} / ${nh}` })
      setUploads([])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
      refresh()
    }
  }

  const pointOptions = points.map((p, i) => ({ value: String(p.id), label: `${i + 1}. ${p.name}` }))

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Text fw={600}>{t('weatherDownload')}</Text>
          {plan.data?.archive_first && (
            <Text size="xs" c="dimmed">
              {t('weatherArchiveSpan')}: {plan.data.archive_first} … {plan.data.archive_last}
            </Text>
          )}
        </Group>

        <Group gap="sm" wrap="wrap" align="flex-end">
          {from && to && (
            <PeriodPicker
              withTime={false}
              from={from}
              to={to}
              onChange={({ from: f, to: t2 }) => {
                setFrom(f)
                setTo(t2)
              }}
            />
          )}
          <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} onClick={refresh}>
            {t('weatherCheck')}
          </Button>
        </Group>

        <Table.ScrollContainer minWidth={520}>
          <Table verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>#</Table.Th>
                <Table.Th>{t('weatherPointName')}</Table.Th>
                <Table.Th>
                  {t('weatherMissingDays')}: {t('weatherCoverageDaily').toLowerCase()}
                </Table.Th>
                <Table.Th>{t('weatherCoverageHourly').toLowerCase()}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {points.map((p, i) => {
                const g = gaps[i]
                const cell = (r: DateRange[]) =>
                  r.length === 0 ? (
                    <Badge size="sm" color="teal" variant="light">
                      0
                    </Badge>
                  ) : (
                    <Text size="xs" ff="monospace" title={r.map((x) => `${x.first}…${x.last}`).join('\n')}>
                      {days(r)} ({r.length === 1 ? `${r[0].first} … ${r[0].last}` : `${r.length} ×`})
                    </Text>
                  )
                return (
                  <Table.Tr key={p.id}>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {i + 1}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{p.name}</Text>
                    </Table.Td>
                    <Table.Td>{cell(g.daily)}</Table.Td>
                    <Table.Td>{cell(g.hourly)}</Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        {missingTotal === 0 ? (
          <Text size="sm" c="teal">
            {t('weatherNothingMissing')}
          </Text>
        ) : (
          <Text size="xs" c="dimmed">
            {requests.length} {t('weatherRequests')} · {t('weatherLagNote')}
          </Text>
        )}

        {error && (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
            {error}
          </Alert>
        )}
        {busy && <Progress value={(busy.done / Math.max(1, busy.total)) * 100} animated />}

        <Group gap="sm" wrap="wrap">
          <Button
            size="sm"
            leftSection={<IconCloudDownload size={16} />}
            onClick={downloadOnline}
            loading={!!busy}
            disabled={requests.length === 0}
          >
            {t('weatherOnline')}
          </Button>
          <Button
            size="sm"
            variant="light"
            leftSection={<IconLink size={16} />}
            onClick={() => setShowLinks((s) => !s)}
            disabled={requests.length === 0}
          >
            {t('weatherOffline')}
          </Button>
          <FileButton onChange={(f) => void onFiles(f)} accept=".csv,.json,text/csv,application/json" multiple>
            {(props) => (
              <Button size="sm" variant="light" leftSection={<IconUpload size={16} />} {...props}>
                {t('weatherUploadFiles')}
              </Button>
            )}
          </FileButton>
        </Group>

        {showLinks && requests.length > 0 && (
          <Paper withBorder radius="sm" p="sm" bg="var(--hlv-surface-2, transparent)">
            <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs" mb="xs">
              <Text size="xs" c="dimmed">
                {t('weatherOfflineHint')}
              </Text>
              <CloseButton size="sm" onClick={() => setShowLinks(false)} aria-label={t('close')} />
            </Group>
            <ScrollArea.Autosize mah={240}>
              <Stack gap={4}>
                {requests.map((r, i) => (
                  <Anchor key={i} size="xs" href={urlOf(r, 'csv')} target="_blank" rel="noreferrer">
                    {requestLabel(r)}
                  </Anchor>
                ))}
              </Stack>
            </ScrollArea.Autosize>
            <Button
              mt="xs"
              size="xs"
              variant="default"
              leftSection={<IconCopy size={14} />}
              onClick={async () => {
                const ok = await copyText(requests.map((r) => urlOf(r, 'csv')).join('\n'))
                notifications.show({ message: ok ? t('copied') : 'Не вдалося скопіювати', color: ok ? 'teal' : 'red' })
              }}
            >
              {t('weatherCopyLinks')}
            </Button>
          </Paper>
        )}

        {uploads.length > 0 && (
          <Paper withBorder radius="sm" p="sm">
            <Table.ScrollContainer minWidth={560}>
              <Table verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('weatherFileLocation')}</Table.Th>
                    <Table.Th>{t('weatherCoordinates')}</Table.Th>
                    <Table.Th>{t('weatherCoverageDaily')}</Table.Th>
                    <Table.Th>{t('weatherCoverageHourly')}</Table.Th>
                    <Table.Th>→</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {uploads.flatMap((u, ui) =>
                    u.locations.map((loc, li) => (
                      <Table.Tr key={`${ui}-${li}`}>
                        <Table.Td>
                          <Text size="xs" lineClamp={1} title={u.file}>
                            {u.file} #{li}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" ff="monospace">
                            {loc.latitude.toFixed(3)}, {loc.longitude.toFixed(3)}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">{loc.daily.length}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">{loc.hourly.length}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Select
                            size="xs"
                            w={240}
                            clearable
                            data={pointOptions}
                            value={u.target[li] != null ? String(u.target[li]) : null}
                            onChange={(v) =>
                              setUploads((all) =>
                                all.map((x, xi) =>
                                  xi === ui
                                    ? { ...x, target: x.target.map((tg, ti) => (ti === li ? (v ? Number(v) : null) : tg)) }
                                    : x,
                                ),
                              )
                            }
                          />
                        </Table.Td>
                      </Table.Tr>
                    )),
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Group justify="flex-end" mt="xs" gap="xs">
              <Button size="xs" variant="default" onClick={() => setUploads([])}>
                {t('cancel')}
              </Button>
              <Button size="xs" onClick={importUploads} loading={!!busy}>
                {t('weatherImport')}
              </Button>
            </Group>
          </Paper>
        )}
      </Stack>
    </Paper>
  )
}
