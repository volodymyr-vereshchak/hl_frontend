import { useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  FileButton,
  Group,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconUpload } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { grsModelApi, type GrsModelStatus, type GrsReportKind, type GrsUploadResult } from '@/api/grsModel'
import { LoadingState } from '@/components/LoadingState'
import { useLanguage } from '@/locales/LanguageContext'
import type { TranslationKey } from '@/locales'
import { fmtDay, fmtStamp } from './format'
import { Tile } from './ModelTab'

const MONO = "'JetBrains Mono Variable', monospace"
const KIND_LABEL: Record<GrsReportKind, TranslationKey> = {
  inflow: 'gmKindInflow',
  consumption: 'gmKindConsumption',
}
/** «Branch mean» in the weather point picker. */
const BRANCH_MEAN = '0'

/**
 * What the model is fed from: the 1С reports uploaded so far, the days they
 * cover, and the stations they name. Uploading the same report again, or a
 * longer one over it, never doubles a figure — it adds the new days and
 * replaces the ones 1С has corrected since.
 */
export function DataTab({
  branchId,
  status,
  isAdmin,
}: {
  branchId: number
  status: GrsModelStatus
  isAdmin: boolean
}) {
  const { t, getLocale } = useLanguage()
  const locale = getLocale()
  const qc = useQueryClient()
  const [results, setResults] = useState<GrsUploadResult[] | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['grs-model'] })

  const upload = useMutation({
    mutationFn: (files: File[]) => grsModelApi.upload(branchId, files),
    onSuccess: (files) => {
      setResults(files)
      void refresh()
    },
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red', autoClose: 10_000 }),
  })
  const update = useMutation({
    mutationFn: ({ id, ...data }: { id: number; enabled?: boolean; weather_point_id?: number }) =>
      grsModelApi.updateStation(id, data),
    onSuccess: () => void refresh(),
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red' }),
  })

  const span = (s: { first: string | null; last: string | null } | null) =>
    s?.first ? `${fmtDay(s.first, locale)} – ${fmtDay(s.last, locale)}` : '—'
  const dataLast = status.inflow?.last ?? null
  // Weather ending before the data does leaves the last days unexplained.
  const weatherShort = !!dataLast && (!status.weather.last || status.weather.last < dataLast)
  const pointOptions = [
    { value: BRANCH_MEAN, label: t('gmWeatherBranchMean') },
    ...status.weather.points.map((p) => ({ value: String(p.id), label: p.name })),
  ]

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
        <Tile
          label={t('gmKindInflow')}
          value={span(status.inflow)}
          hint={status.inflow ? `${status.inflow.days} ${t('gmDaysShort')}` : t('gmNotUploaded')}
        />
        <Tile
          label={t('gmKindConsumption')}
          value={span(status.consumption)}
          hint={
            status.consumption
              ? `${status.consumption.days} ${t('gmDaysShort')}`
              : `${t('gmNotUploaded')} — ${t('gmNoConsumptionHint')}`
          }
        />
        <Tile
          label={t('gmWeather')}
          value={span(status.weather)}
          color={weatherShort ? 'red' : undefined}
          hint={
            status.weather.points.length
              ? `${t('gmWeatherPoints')}: ${status.weather.points.length}`
              : t('gmNoWeatherPoints')
          }
        />
      </SimpleGrid>

      {(weatherShort || status.weather.points.length === 0) && (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
          {t(status.weather.points.length === 0 ? 'gmNoWeatherPointsHint' : 'gmWeatherShortHint')}
        </Alert>
      )}

      {isAdmin && (
        <Paper withBorder radius="md" p="md">
          <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
            <div>
              <Text fw={600}>{t('gmUploadTitle')}</Text>
              <Text size="xs" c="dimmed" maw={760}>
                {t('gmUploadHint')}
              </Text>
            </div>
            <FileButton
              onChange={(files) => files.length && upload.mutate(files)}
              accept=".xlsx"
              multiple
              disabled={upload.isPending}
            >
              {(props) => (
                <Button {...props} size="xs" leftSection={<IconUpload size={15} />}>
                  {t('gmUploadButton')}
                </Button>
              )}
            </FileButton>
          </Group>

          {upload.isPending && <LoadingState py={30} label={t('gmUploading')} />}

          {results && !upload.isPending && (
            <Stack gap={6} mt="md">
              {results.map((r, i) =>
                r.error !== undefined ? (
                  <Alert key={i} color="red" variant="light" p="xs" icon={<IconAlertTriangle size={16} />}>
                    <b>{r.filename}</b>: {r.error}
                  </Alert>
                ) : (
                  <Alert key={i} color="teal" variant="light" p="xs">
                    <b>{r.filename}</b> — {t(KIND_LABEL[r.kind])}, {fmtDay(r.first_day, locale)} –{' '}
                    {fmtDay(r.last_day, locale)}, {t('gmStations')}: {r.stations}. {t('gmAdded')}: <b>{r.added}</b>,{' '}
                    {t('gmUpdated')}: <b>{r.updated}</b>, {t('gmUnchanged')}: {r.unchanged}
                  </Alert>
                ),
              )}
            </Stack>
          )}
        </Paper>
      )}

      <Paper withBorder radius="md" p="md">
        <Text fw={600} mb="xs">
          {t('gmStations')}
        </Text>
        {status.stations.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t('gmNoStations')}
          </Text>
        ) : (
          <ScrollArea>
            <Table striped verticalSpacing={6} fz="xs" miw={860}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('gmStation')}</Table.Th>
                  <Table.Th>{t('gmKindInflow')}</Table.Th>
                  <Table.Th ta="right">{t('gmDaysShort')}</Table.Th>
                  <Table.Th>{t('gmKindConsumption')}</Table.Th>
                  <Table.Th w={240}>{t('gmWeatherPoint')}</Table.Th>
                  <Table.Th w={110}>{t('gmInModel')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {status.stations.map((s) => (
                  <Table.Tr key={s.id} style={{ opacity: s.enabled ? 1 : 0.55 }}>
                    <Table.Td fw={500}>{s.name}</Table.Td>
                    <Table.Td ff={MONO}>{span({ first: s.inflow_first, last: s.inflow_last })}</Table.Td>
                    <Table.Td ta="right" ff={MONO}>
                      {s.inflow_days}
                    </Table.Td>
                    <Table.Td ff={MONO}>{span({ first: s.consumption_first, last: s.consumption_last })}</Table.Td>
                    <Table.Td>
                      {isAdmin ? (
                        <Select
                          size="xs"
                          data={pointOptions}
                          value={s.weather_point_id != null ? String(s.weather_point_id) : BRANCH_MEAN}
                          onChange={(v) => v != null && update.mutate({ id: s.id, weather_point_id: Number(v) })}
                          allowDeselect={false}
                          disabled={update.isPending}
                        />
                      ) : (
                        (status.weather.points.find((p) => p.id === s.weather_point_id)?.name ??
                        t('gmWeatherBranchMean'))
                      )}
                    </Table.Td>
                    <Table.Td>
                      {isAdmin ? (
                        <Switch
                          size="xs"
                          checked={s.enabled}
                          onChange={(e) => update.mutate({ id: s.id, enabled: e.currentTarget.checked })}
                          disabled={update.isPending}
                        />
                      ) : (
                        <Badge size="xs" variant="light" color={s.enabled ? 'teal' : 'gray'}>
                          {t(s.enabled ? 'gmYes' : 'gmNo')}
                        </Badge>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
        <Text size="xs" c="dimmed" mt="sm">
          {t('gmStationsNote')}
        </Text>
      </Paper>

      {status.uploads.length > 0 && (
        <Paper withBorder radius="md" p="md">
          <Text fw={600} mb="xs">
            {t('gmUploadsJournal')}
          </Text>
          <ScrollArea>
            <Table striped verticalSpacing={6} fz="xs" miw={860}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('gmUploadedAt')}</Table.Th>
                  <Table.Th>{t('gmFile')}</Table.Th>
                  <Table.Th>{t('gmReport')}</Table.Th>
                  <Table.Th>{t('gmPeriod')}</Table.Th>
                  <Table.Th ta="right">{t('gmAdded')}</Table.Th>
                  <Table.Th ta="right">{t('gmUpdated')}</Table.Th>
                  <Table.Th ta="right">{t('gmUnchanged')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {status.uploads.map((u) => (
                  <Table.Tr key={u.id}>
                    <Table.Td ff={MONO}>
                      {fmtStamp(u.uploaded_at, locale)}
                      {u.uploaded_by ? ` · ${u.uploaded_by}` : ''}
                    </Table.Td>
                    <Table.Td>{u.filename}</Table.Td>
                    <Table.Td>{t(KIND_LABEL[u.kind])}</Table.Td>
                    <Table.Td ff={MONO}>
                      {fmtDay(u.first_day, locale)} – {fmtDay(u.last_day, locale)}
                    </Table.Td>
                    <Table.Td ta="right" ff={MONO}>
                      {u.added}
                    </Table.Td>
                    <Table.Td ta="right" ff={MONO}>
                      {u.updated}
                    </Table.Td>
                    <Table.Td ta="right" ff={MONO}>
                      {u.unchanged}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
      )}
    </Stack>
  )
}
