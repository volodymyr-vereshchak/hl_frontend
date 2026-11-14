import { Badge, Button, Group, Paper, ScrollArea, SimpleGrid, Stack, Table, Text, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconPlayerPlay } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { grsModelApi, type GrsModelQuality, type GrsModelStatus } from '@/api/grsModel'
import { LoadingState } from '@/components/LoadingState'
import { useLanguage } from '@/locales/LanguageContext'
import { fmtDay, fmtNumber, fmtStamp } from './format'

const MONO = "'JetBrains Mono Variable', monospace"

/** A month within this error is a good one (the share shown in the table). */
const GOOD_MONTH_ERROR = 6

/**
 * The model in use and how good it is, station by station, and the button
 * that trains it again. Every figure here was measured on months the model
 * did not see: each month is predicted by a model fitted without it.
 */
export function ModelTab({
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
  const fit = status.fit

  const train = useMutation({
    mutationFn: () => grsModelApi.train(branchId),
    onSuccess: (result) => {
      notifications.show({
        message: `${t('gmTrained')}: ${result.stations.filter((s) => s.status === 'ok').length}`,
        color: 'teal',
      })
      void qc.invalidateQueries({ queryKey: ['grs-model'] })
    },
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red', autoClose: 10_000 }),
  })

  const rows = [...(fit?.stations ?? [])].sort(
    (a, b) => Number(a.status !== 'ok') - Number(b.status !== 'ok') || a.name.localeCompare(b.name, 'uk'),
  )
  const trained = rows.filter((r) => r.status === 'ok')
  const mean = (pick: (r: GrsModelQuality) => number | null | undefined) => {
    const values = trained.map(pick).filter((v): v is number => v != null)
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
  }

  return (
    <Stack gap="md">
      <Paper withBorder radius="md" p="md">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
          <div>
            {fit ? (
              <>
                <Group gap="xs">
                  <Text fw={600}>
                    {t('gmTrainedAt')} {fmtStamp(fit.trained_at, locale)}
                  </Text>
                  {fit.stale && (
                    <Badge color="yellow" variant="light">
                      {t('gmStaleBadge')}
                    </Badge>
                  )}
                </Group>
                <Text size="xs" c="dimmed">
                  {fit.trained_by ? `${fit.trained_by} · ` : ''}
                  {t('gmTrainedOn')} {fmtDay(fit.first_day, locale)} – {fmtDay(fit.last_day, locale)} ({fit.days}{' '}
                  {t('gmDaysShort')}) · {t('gmWeather')} {fmtDay(fit.weather_first, locale)} –{' '}
                  {fmtDay(fit.weather_last, locale)}
                </Text>
              </>
            ) : (
              <Text fw={600}>{t('gmNotTrained')}</Text>
            )}
            <Text size="xs" c="dimmed" mt={6} maw={760}>
              {t('gmTrainHint')}
            </Text>
          </div>
          {isAdmin && (
            <Button
              size="xs"
              leftSection={<IconPlayerPlay size={15} />}
              onClick={() => train.mutate()}
              disabled={train.isPending || status.rows === 0}
            >
              {t(fit ? 'gmRetrain' : 'gmTrain')}
            </Button>
          )}
        </Group>
      </Paper>

      {train.isPending && <LoadingState py={60} label={t('gmTraining')} />}

      {fit && !train.isPending && (
        <>
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
            <Tile label={t('gmStationsTrained')} value={`${trained.length} / ${rows.length}`} />
            <Tile label={t('gmMonthError')} value={`${fmtNumber(mean((r) => r.month_error), 1, locale)} %`} />
            <Tile label="R²" value={fmtNumber(mean((r) => r.r2), 3, locale)} />
            <Tile label={t('gmExcludedShare')} value={`${fmtNumber(mean((r) => r.excluded_share), 1, locale)} %`} />
          </SimpleGrid>

          <Paper withBorder radius="md" p="md">
            <ScrollArea>
              <Table striped highlightOnHover verticalSpacing={6} fz="xs" miw={980}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('gmStation')}</Table.Th>
                    <Table.Th>{t('gmVariant')}</Table.Th>
                    <Th hint={t('gmTrainDaysHint')}>{t('gmTrainDays')}</Th>
                    <Th hint={t('gmExcludedHint')}>{t('gmExcluded')}</Th>
                    <Th hint={t('gmMonthErrorHint')}>{t('gmMonthError')}</Th>
                    <Th hint={t('gmGoodMonthsHint')}>{t('gmGoodMonths')}</Th>
                    <Th hint={t('gmR2Hint')}>R²</Th>
                    <Th hint={t('gmMapeHint')}>{t('gmMapeHeat')}</Th>
                    <Th hint={t('gmMapeHint')}>{t('gmMapeSummer')}</Th>
                    <Th hint={t('gmSigmaHint')}>{t('gmSigmaWeek')}</Th>
                    <Th hint={t('gmMeanHint')}>{t('gmMean')}</Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((r) => (
                    <Table.Tr key={r.name}>
                      <Table.Td fw={500}>{r.name}</Table.Td>
                      {r.status === 'ok' ? (
                        <>
                          <Table.Td>
                            <Badge size="xs" variant="light" color={r.variant === 'heating' ? 'orange' : 'gray'}>
                              {t(r.variant === 'heating' ? 'gmVariantHeating' : 'gmVariantPlain')}
                            </Badge>
                          </Table.Td>
                          <Num>{r.train_days}</Num>
                          <Table.Td ta="right" ff={MONO}>
                            <Tooltip
                              label={`${t('gmExcludedShape')}: ${r.excluded?.shape ?? 0} · ${t('gmExcludedLevel')}: ${
                                r.excluded?.level ?? 0
                              } · ${t('gmExcludedMissing')}: ${r.excluded?.missing ?? 0}`}
                            >
                              <span>{fmtNumber(r.excluded_share, 1, locale)} %</span>
                            </Tooltip>
                          </Table.Td>
                          <Table.Td ta="right" ff={MONO} c={errorColor(r.month_error)} fw={600}>
                            {fmtNumber(r.month_error, 1, locale)} %
                          </Table.Td>
                          <Num>
                            {r.months_within_6 ?? 0} / {r.months ?? 0}
                          </Num>
                          <Num>{fmtNumber(r.r2, 3, locale)}</Num>
                          <Num>{fmtNumber(r.mape_heat, 1, locale)} %</Num>
                          <Num>{fmtNumber(r.mape_summer, 1, locale)} %</Num>
                          <Num>
                            {fmtNumber(r.sigma_week_heat, 1, locale)} / {fmtNumber(r.sigma_week_summer, 1, locale)} %
                          </Num>
                          <Num>{fmtNumber(r.mean, 1, locale)}</Num>
                        </>
                      ) : (
                        <Table.Td colSpan={10} c="dimmed">
                          {t(r.status === 'tiny' ? 'gmStatusTiny' : 'gmStatusFewDays')}
                        </Table.Td>
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            <Text size="xs" c="dimmed" mt="sm">
              {t('gmQualityNote').replace('{n}', String(GOOD_MONTH_ERROR))}
            </Text>
          </Paper>
        </>
      )}
    </Stack>
  )
}

/** Monthly error of a model: green is a model to trust, red one to doubt. */
function errorColor(value: number | null | undefined): string | undefined {
  if (value == null) return undefined
  if (value <= GOOD_MONTH_ERROR) return 'teal'
  return value <= 2 * GOOD_MONTH_ERROR ? 'yellow.8' : 'red'
}

function Th({ hint, children }: { hint: string; children: React.ReactNode }) {
  return (
    <Table.Th ta="right">
      <Tooltip label={hint} multiline w={280} withArrow>
        <span style={{ cursor: 'help', borderBottom: '1px dotted currentColor' }}>{children}</span>
      </Tooltip>
    </Table.Th>
  )
}

function Num({ children }: { children: React.ReactNode }) {
  return (
    <Table.Td ta="right" ff={MONO}>
      {children}
    </Table.Td>
  )
}

export function Tile({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <Paper withBorder radius="md" p="sm">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} size="lg" ff={MONO} c={color}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Paper>
  )
}
