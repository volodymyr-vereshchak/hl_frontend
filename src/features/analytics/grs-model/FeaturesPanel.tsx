import { Group, Paper, Progress, ScrollArea, Select, Table, Text } from '@mantine/core'
import type { GrsModelQuality } from '@/api/grsModel'
import { useLanguage } from '@/locales/LanguageContext'
import type { TranslationKey } from '@/locales'
import { fmtNumber } from './format'

const MONO = "'JetBrains Mono Variable', monospace"

/** What each feature of backend/services/grs_model/core.features is. */
const FEATURE_LABEL: Record<string, TranslationKey> = {
  HDD_w: 'gmFeatHDD_w',
  HDDw_w: 'gmFeatHDDw_w',
  HDDr_w: 'gmFeatHDDr_w',
  wknd_w: 'gmFeatwknd_w',
  h4_w: 'gmFeath4_w',
  h8_w: 'gmFeath8_w',
  HDDaut_w: 'gmFeatHDDaut_w',
  Twarm_s: 'gmFeatTwarm_s',
  wknd_s: 'gmFeatwknd_s',
  HDD_s: 'gmFeatHDD_s',
  pw: 'gmFeatpw',
  HDD_Tmax22: 'gmFeatHDD_Tmax22',
  warm3: 'gmFeatwarm3',
  HDD_Tmin10: 'gmFeatHDD_Tmin10',
  cold_aut: 'gmFeatcold_aut',
  hol_xmas: 'gmFeathol_xmas',
  hol_easter: 'gmFeathol_easter',
}

/**
 * The features a station's model uses and how much each weighs: its share
 * of what the model moves on the station's training days, and the
 * coefficient — the station's own and the branch's it was pulled towards.
 */
export function FeaturesPanel({
  stations,
  selected,
  onSelect,
}: {
  stations: GrsModelQuality[]
  selected: string | null
  onSelect: (name: string) => void
}) {
  const { t, getLocale } = useLanguage()
  const locale = getLocale()
  const withFeatures = stations.filter((s) => s.status === 'ok' && s.features?.length)
  const station = withFeatures.find((s) => s.name === selected) ?? withFeatures[0]
  if (!station) return null
  const coef = (v: number) =>
    `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNumber(Math.abs(v), 3, locale)}`

  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" mb="xs" wrap="wrap" gap="sm">
        <Text fw={600}>{t('gmFeaturesTitle')}</Text>
        <Select
          size="xs"
          w={300}
          aria-label={t('gmStation')}
          data={withFeatures.map((s) => ({ value: s.name, label: s.name }))}
          value={station.name}
          onChange={(v) => v && onSelect(v)}
          allowDeselect={false}
          searchable
        />
      </Group>
      <ScrollArea>
        <Table striped verticalSpacing={5} fz="xs" miw={760}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={28}>#</Table.Th>
              <Table.Th>{t('gmFeature')}</Table.Th>
              <Table.Th w={220}>{t('gmFeatureShare')}</Table.Th>
              <Table.Th ta="right">{t('gmFeatureOwn')}</Table.Th>
              <Table.Th ta="right">{t('gmFeatureCommon')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {station.features!.map((f, i) => (
              <Table.Tr key={f.feature}>
                <Table.Td c="dimmed">{i + 1}</Table.Td>
                <Table.Td>
                  <Text size="xs">
                    {FEATURE_LABEL[f.feature] ? t(FEATURE_LABEL[f.feature]) : f.feature}
                  </Text>
                  <Text size="xs" c="dimmed" ff={MONO}>
                    {f.feature}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Progress value={f.share} w={140} size="sm" color="petrol" />
                    <Text size="xs" ff={MONO}>
                      {fmtNumber(f.share, 1, locale)} %
                    </Text>
                  </Group>
                </Table.Td>
                <Table.Td ta="right" ff={MONO} fw={600}>
                  {coef(f.own)}
                </Table.Td>
                <Table.Td ta="right" ff={MONO} c="dimmed">
                  {coef(f.common)}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <Text size="xs" c="dimmed" mt="sm">
        {t('gmFeaturesNote')}
      </Text>
    </Paper>
  )
}
