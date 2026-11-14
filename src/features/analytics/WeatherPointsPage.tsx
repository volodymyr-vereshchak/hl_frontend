import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconBuildingFactory, IconMapPin, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { grsModelApi, type GrsModelStation } from '@/api/grsModel'
import { weatherApi, type WeatherLineRef, type WeatherPoint, type WeatherPointInput } from '@/api/weather'
import { formatCoordinates, parseCoordinates } from '@/domain/weather/coords'
import { useUser } from '@/features/auth/UserContext'
import { useBranches, useBranchLines, useEnsureValidBranch, type ReportLine } from '@/features/reports/useBranchLines'
import { useLanguage } from '@/locales/LanguageContext'
import { useSelectionStore } from '@/store/selectionStore'
import { WeatherDownloadPanel } from './WeatherDownloadPanel'
import { WeatherAutoPanel } from './WeatherAutoPanel'

export const weatherPointsKey = (branchId: number | null) => ['weather-points', branchId] as const

export function useWeatherPoints(branchId: number | null) {
  return useQuery({
    queryKey: weatherPointsKey(branchId),
    enabled: branchId != null,
    // Sorted by id: the download links group points by their position in this
    // order, and an uploaded file is matched back by it.
    queryFn: async () => (await weatherApi.points(branchId!)).sort((a, b) => a.id - b.id),
  })
}

export const mapUrl = (lat: number, lon: number) => `https://www.google.com/maps?q=${lat},${lon}`

const lineKey = (l: { kind: string; id: number }) => `${l.kind}:${l.id}`
const fromKey = (k: string): WeatherLineRef => {
  const [kind, id] = k.split(':')
  return { kind: kind as WeatherLineRef['kind'], id: Number(id) }
}

export function WeatherPointsPage() {
  const { t } = useLanguage()
  const { user } = useUser()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const { branchId, setBranchId } = useSelectionStore()
  const { data: branches } = useBranches()
  useEnsureValidBranch(branches)
  const { data: lines } = useBranchLines(branchId)
  const { data: points, isLoading } = useWeatherPoints(branchId)
  const [editing, setEditing] = useState<WeatherPoint | 'new' | null>(null)
  const [grsOpen, setGrsOpen] = useState(false)
  const grsStatus = useQuery({
    queryKey: ['grs-model', 'status', branchId],
    enabled: branchId != null && isAdmin,
    queryFn: () => grsModelApi.status(branchId!),
  })

  const lineName = useMemo(() => {
    const m = new Map<number, string>()
    for (const l of lines ?? []) m.set(l.id, l.name)
    return m
  }, [lines])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['weather-points'] })
  const remove = useMutation({
    mutationFn: (id: number) => weatherApi.remove(id),
    onSuccess: invalidate,
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red' }),
  })
  const confirmRemove = (p: WeatherPoint) =>
    modals.openConfirmModal({
      title: t('weatherDeletePoint'),
      children: (
        <Text size="sm">
          «{p.name}». {t('weatherDeletePointConfirm')}
        </Text>
      ),
      labels: { confirm: t('weatherDeletePoint'), cancel: t('cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(p.id),
    })

  // GRS of the 1С balance report not yet tied to a weather point — what
  // «create from the GRS file» offers. Only stations the inflow report names:
  // the consumption report alone does not make a station of the balance.
  const grsUncovered = useMemo(
    () => (grsStatus.data?.stations ?? []).filter((s) => s.inflow_days > 0 && s.weather_point_id == null),
    [grsStatus.data],
  )

  const coverage = (c: WeatherPoint['daily']) =>
    c.count === 0 ? (
      <Text size="xs" c="dimmed">
        {t('weatherNone')}
      </Text>
    ) : (
      <Text size="xs" ff="monospace">
        {c.first} … {c.last}
      </Text>
    )

  // Points and downloads are an admin's job; others read the weather page.
  if (user && !isAdmin) return <Navigate to="/analytics/weather" replace />

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={3}>{t('weatherPointsTitle')}</Title>
          <Text size="xs" c="dimmed">
            {t('weatherPointsDescription')}
          </Text>
        </div>
        <Select
          placeholder={t('branch')}
          data={(branches ?? []).map((b) => ({ value: String(b.id), label: b.name }))}
          value={branchId != null ? String(branchId) : null}
          onChange={(v) => v && setBranchId(Number(v))}
          allowDeselect={false}
          w={260}
        />
      </Group>

      <Paper withBorder radius="md" p="md">
        <Group justify="space-between" mb="sm">
          <Text fw={600}>{t('weatherPointsTitle')}</Text>
          {isAdmin && (
            <Group gap="xs">
              <Tooltip label={t('weatherFromGrsHint')} withArrow multiline w={300}>
                <Button
                  size="xs"
                  variant="light"
                  color="teal"
                  leftSection={<IconBuildingFactory size={14} />}
                  disabled={branchId == null}
                  onClick={() => setGrsOpen(true)}
                >
                  {t('weatherFromGrs')}
                  {grsStatus.data ? ` (${grsUncovered.length})` : ''}
                </Button>
              </Tooltip>
              <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEditing('new')}>
                {t('weatherAddPoint')}
              </Button>
            </Group>
          )}
        </Group>

        {!isLoading && (points ?? []).length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="lg">
            {t('weatherNoPoints')}
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={760}>
            <Table striped highlightOnHover verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>#</Table.Th>
                  <Table.Th>{t('weatherPointName')}</Table.Th>
                  <Table.Th>{t('weatherCoordinates')}</Table.Th>
                  <Table.Th>{t('weatherLines')}</Table.Th>
                  <Table.Th>{t('weatherCoverageDaily')}</Table.Th>
                  <Table.Th>{t('weatherCoverageHourly')}</Table.Th>
                  <Table.Th>{t('weatherForecastUntil')}</Table.Th>
                  {isAdmin && <Table.Th />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(points ?? []).map((p, i) => (
                  <Table.Tr key={p.id}>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {i + 1}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {p.name}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Anchor
                        size="xs"
                        ff="monospace"
                        href={mapUrl(p.latitude, p.longitude)}
                        target="_blank"
                        rel="noreferrer"
                        title={t('weatherOpenMap')}
                      >
                        {formatCoordinates(p.latitude, p.longitude)}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        {p.lines.map((l) => (
                          <Badge key={l.id} size="sm" variant="light" color="gray" tt="none">
                            {lineName.get(l.id) ?? `#${l.id}`}
                          </Badge>
                        ))}
                      </Group>
                    </Table.Td>
                    <Table.Td>{coverage(p.daily)}</Table.Td>
                    <Table.Td>{coverage(p.hourly)}</Table.Td>
                    <Table.Td>
                      {p.forecast_until ? (
                        <Text
                          size="xs"
                          ff="monospace"
                          title={p.forecast_updated_at ? new Date(p.forecast_updated_at).toLocaleString() : undefined}
                        >
                          {p.forecast_until}
                        </Text>
                      ) : (
                        <Text size="xs" c="dimmed">
                          {t('weatherNone')}
                        </Text>
                      )}
                    </Table.Td>
                    {isAdmin && (
                      <Table.Td>
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          <ActionIcon variant="subtle" color="gray" onClick={() => setEditing(p)}>
                            <IconPencil size={16} />
                          </ActionIcon>
                          <ActionIcon variant="subtle" color="red" onClick={() => confirmRemove(p)}>
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Group>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Paper>

      {isAdmin && <WeatherAutoPanel />}

      {isAdmin && branchId != null && (points ?? []).length > 0 && (
        <WeatherDownloadPanel branchId={branchId} points={points!} />
      )}

      {editing && branchId != null && (
        <PointModal
          branchId={branchId}
          point={editing === 'new' ? null : editing}
          lines={lines ?? []}
          points={points ?? []}
          onClose={() => setEditing(null)}
          onSaved={invalidate}
        />
      )}
      {grsOpen && (
        <GrsBulkModal
          stations={grsUncovered}
          points={points ?? []}
          loading={grsStatus.isLoading}
          error={grsStatus.error ? (grsStatus.error as Error).message : null}
          hasStations={(grsStatus.data?.stations ?? []).some((s) => s.inflow_days > 0)}
          onClose={() => setGrsOpen(false)}
          onSaved={() => {
            void invalidate()
            void qc.invalidateQueries({ queryKey: ['grs-model'] })
          }}
        />
      )}
    </Stack>
  )
}

/** Coordinates input that accepts whatever Google Maps hands out. */
function CoordinatesInput({
  value,
  onChange,
  label,
  compact = false,
}: {
  value: string
  onChange: (v: string) => void
  label?: string
  /** In a list of rows the format hint once above the list is enough. */
  compact?: boolean
}) {
  const { t } = useLanguage()
  const parsed = parseCoordinates(value)
  return (
    <TextInput
      label={label}
      placeholder="47.838310, 35.165560"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      error={value.trim() && !parsed ? t('weatherCoordinatesInvalid') : undefined}
      description={
        parsed ? (
          <Anchor size="xs" href={mapUrl(parsed.lat, parsed.lon)} target="_blank" rel="noreferrer">
            {formatCoordinates(parsed.lat, parsed.lon)} — {t('weatherOpenMap')}
          </Anchor>
        ) : compact ? undefined : (
          t('weatherCoordinatesHint')
        )
      }
      leftSection={<IconMapPin size={14} />}
    />
  )
}

function PointModal({
  branchId,
  point,
  lines,
  points,
  onClose,
  onSaved,
}: {
  branchId: number
  point: WeatherPoint | null
  lines: ReportLine[]
  points: WeatherPoint[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [name, setName] = useState(point?.name ?? '')
  const [coords, setCoords] = useState(point ? formatCoordinates(point.latitude, point.longitude) : '')
  const [selected, setSelected] = useState<string[]>((point?.lines ?? []).map(lineKey))
  const parsed = parseCoordinates(coords)

  // A line belongs to one point; show where the others already are.
  const owner = useMemo(() => {
    const m = new Map<number, string>()
    for (const p of points) if (p.id !== point?.id) for (const l of p.lines) m.set(l.id, p.name)
    return m
  }, [points, point])

  const save = useMutation({
    mutationFn: () => {
      const data: WeatherPointInput = {
        name: name.trim(),
        latitude: parsed!.lat,
        longitude: parsed!.lon,
        lines: selected.map(fromKey),
      }
      return point ? weatherApi.update(point.id, data) : weatherApi.create(branchId, data)
    },
    onSuccess: () => {
      onSaved()
      onClose()
    },
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red' }),
  })

  return (
    <Modal opened onClose={onClose} title={t('weatherEditPoint')} size="lg">
      <Stack gap="sm">
        <TextInput
          label={t('weatherPointName')}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          data-autofocus
        />
        <CoordinatesInput label={t('weatherCoordinates')} value={coords} onChange={setCoords} />
        <MultiSelect
          label={t('weatherLines')}
          description={t('weatherLinesHint')}
          searchable
          data={lines.map((l) => ({
            value: lineKey(l),
            label: owner.has(l.id) ? `${l.name} (→ ${owner.get(l.id)})` : l.name,
          }))}
          value={selected}
          onChange={setSelected}
        />
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim() || !parsed}>
            {t('weatherSave')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

/** One point per GRS of the 1С balance report, named after it and tied to
 *  it in the consumption model; rows left without coordinates are skipped,
 *  so the list can be filled in over several visits. */
function GrsBulkModal({
  stations,
  points,
  loading,
  error,
  hasStations,
  onClose,
  onSaved,
}: {
  stations: GrsModelStation[]
  points: WeatherPoint[]
  loading: boolean
  error: string | null
  /** The branch has GRS from the balance report at all. */
  hasStations: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [coords, setCoords] = useState<Record<number, string>>({})
  // A point of the station's name is already there: the station is tied to
  // it as it is, no coordinates asked.
  const existing = new Map(points.map((p) => [p.name, p]))
  const ready = stations.filter((s) => existing.has(s.name) || parseCoordinates(coords[s.id] ?? ''))

  const save = useMutation({
    mutationFn: () =>
      grsModelApi.createStationPoints(
        ready.map((s) => {
          const c = existing.has(s.name) ? null : parseCoordinates(coords[s.id])
          return { station_id: s.id, latitude: c?.lat ?? null, longitude: c?.lon ?? null }
        }),
      ),
    onSuccess: () => {
      onSaved()
      onClose()
    },
    onError: (e: Error) => {
      onSaved()
      notifications.show({ message: e.message, color: 'red' })
    },
  })

  let empty: string | null = null
  if (error) empty = `${t('weatherFromGrsFailed')}: ${error}`
  else if (!loading && !hasStations) empty = t('weatherFromGrsNoFile')
  else if (!loading && stations.length === 0) empty = t('weatherFromGrsAllDone')

  return (
    <Modal opened onClose={onClose} title={t('weatherFromGrs')} size="xl">
      <Stack gap="xs">
        {loading && <Loader size="sm" />}
        {empty ? (
          <Text size="sm" c={error ? 'red' : 'dimmed'}>
            {empty}
          </Text>
        ) : (
          <>
            <Text size="xs" c="dimmed">
              {t('weatherCoordinatesHint')}
            </Text>
            {stations.map((s) => (
              <Group key={s.id} gap="sm" wrap="nowrap" align="flex-start">
                <Text size="sm" w={260} pt={8} lineClamp={1} title={s.name}>
                  {s.name}
                </Text>
                <div style={{ flex: 1 }}>
                  {existing.has(s.name) ? (
                    <Text size="xs" c="teal" pt={10}>
                      {t('weatherFromGrsExisting')}
                    </Text>
                  ) : (
                    <CoordinatesInput
                      compact
                      value={coords[s.id] ?? ''}
                      onChange={(v) => setCoords((c) => ({ ...c, [s.id]: v }))}
                    />
                  )}
                </div>
              </Group>
            ))}
          </>
        )}
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={ready.length === 0}>
            {t('weatherSave')} ({ready.length})
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
