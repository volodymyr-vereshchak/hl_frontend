import { useEffect } from 'react'
import {
  Select,
  Group,
  Stack,
  Card,
  Text,
  SimpleGrid,
  Title,
  Badge,
  Loader,
  Center,
  Alert,
  Table,
  Box,
  Paper,
  ThemeIcon,
} from '@mantine/core'
import {
  IconArrowUpRight,
  IconArrowDownRight,
  IconAlertTriangle,
  IconGauge,
  IconClockHour4,
  IconActivity,
} from '@tabler/icons-react'
import { useSelectionStore } from '@/store/selectionStore'
import { useLanguage } from '@/locales/LanguageContext'
import { numericStyle } from '@/theme/theme'
import { OverviewCalculator } from '@/domain/overviewCalculator'
import { PressureGauge } from './PressureGauge'
import { useOverviewData, type OverviewData } from './useOverviewData'

function fmtNum(n: number, digits = 0) {
  return n.toLocaleString('uk-UA', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

function ChangeBadge({ percent, up }: { percent: number; up: boolean }) {
  if (Math.abs(percent) < 0.05) return <Badge variant="light" color="gray" size="sm">0%</Badge>
  return (
    <Badge
      variant="light"
      color={up ? 'teal' : 'red'}
      size="sm"
      leftSection={up ? <IconArrowUpRight size={12} /> : <IconArrowDownRight size={12} />}
    >
      {up ? '+' : ''}
      {percent.toFixed(1)}%
    </Badge>
  )
}

function MetricCard({
  label,
  value,
  unit,
  icon,
  extra,
}: {
  label: string
  value: string
  unit?: string
  icon: React.ReactNode
  extra?: React.ReactNode
}) {
  return (
    <Card padding="md" radius="md">
      <Group justify="space-between" align="flex-start">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {label}
        </Text>
        <ThemeIcon variant="light" color="petrol" size="md" radius="md">
          {icon}
        </ThemeIcon>
      </Group>
      <Group align="baseline" gap={6} mt="xs">
        <Text fz={26} fw={700} style={numericStyle} lh={1}>
          {value}
        </Text>
        {unit && (
          <Text c="dimmed" size="sm">
            {unit}
          </Text>
        )}
      </Group>
      {extra && <Box mt={6}>{extra}</Box>}
    </Card>
  )
}

function LumgSection({ data, group }: { data: OverviewData; group: OverviewData['lumgGroups'][number] }) {
  const { t } = useLanguage()
  const volById = new Map(data.volumeComparisons.map((v) => [v.lineId, v]))

  const gauges = group.lineIds
    .map((id) => ({ id, p: data.pressures[id] }))
    .filter((x) => x.p)

  return (
    <Paper p="md" radius="md" withBorder>
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <Text fw={600} fz="lg" ff="'Space Grotesk Variable', sans-serif">
            {group.lumgName}
          </Text>
          <Badge variant="light" color="steel" size="sm">
            {group.lineIds.length} {t('linesCount')}
          </Badge>
        </Group>
      </Group>

      {gauges.length > 0 && (
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 6 }} spacing="md" mb="md">
          {gauges.map(({ id, p }) => {
            const range = OverviewCalculator.getPressureRange(p!.isHighPressure)
            return (
              <PressureGauge
                key={id}
                label={data.lineNames[id] ?? String(id)}
                value={p!.pressure}
                min={range.min}
                max={range.max}
                unit={p!.pressureUnit}
                min24h={p!.minPressure24h}
                max24h={p!.maxPressure24h}
              />
            )
          })}
        </SimpleGrid>
      )}

      <Table.ScrollContainer minWidth={420}>
        <Table striped highlightOnHover verticalSpacing="xs" style={numericStyle}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ fontFamily: 'var(--mantine-font-family)' }}>{t('lineName')}</Table.Th>
              <Table.Th ta="right" style={{ fontFamily: 'var(--mantine-font-family)' }}>
                {t('current24hShort')}
              </Table.Th>
              <Table.Th ta="right" style={{ fontFamily: 'var(--mantine-font-family)' }}>
                {t('previous24hShort')}
              </Table.Th>
              <Table.Th ta="right" style={{ fontFamily: 'var(--mantine-font-family)' }}>
                {t('changeShort')}
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {group.lineIds.map((id) => {
              const v = volById.get(id)
              if (!v) return null
              return (
                <Table.Tr key={id}>
                  <Table.Td style={{ fontFamily: 'var(--mantine-font-family)' }}>
                    {data.lineNames[id] ?? id}
                  </Table.Td>
                  <Table.Td ta="right">{fmtNum(v.current24h)}</Table.Td>
                  <Table.Td ta="right" c="dimmed">
                    {fmtNum(v.previous24h)}
                  </Table.Td>
                  <Table.Td ta="right">
                    <ChangeBadge percent={v.changePercent} up={v.change >= 0} />
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  )
}

export function OverviewPage() {
  const { t } = useLanguage()
  const { branchId, setBranchId } = useSelectionStore()
  const { topology, data, isLoading, error } = useOverviewData(branchId)

  const branches = topology.data?.branches ?? []

  // Auto-select the first branch once topology loads.
  useEffect(() => {
    if (branchId == null && branches.length > 0) setBranchId(branches[0].id)
  }, [branchId, branches, setBranchId])

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <Box>
          <Title order={2}>{t('grsOverviewTitle')}</Title>
          {data && (
            <Text c="dimmed" size="sm">
              {t('lastUpdate')}: {data.currentPeriod.end.toLocaleString('uk-UA')}
            </Text>
          )}
        </Box>
        <Select
          label={undefined}
          data={branches.map((b) => ({ value: String(b.id), label: b.name }))}
          value={branchId != null ? String(branchId) : null}
          onChange={(v) => setBranchId(v ? Number(v) : null)}
          w={280}
          placeholder="Філія"
          searchable
        />
      </Group>

      {error && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          {(error as Error).message}
        </Alert>
      )}

      {isLoading && (
        <Center py={80}>
          <Loader color="petrol" />
        </Center>
      )}

      {data && (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
            <MetricCard
              label={t('total24hVolume')}
              value={fmtNum(data.totalVolume24h)}
              unit="м³"
              icon={<IconGauge size={18} />}
              extra={
                <Group gap={6}>
                  <ChangeBadge
                    percent={data.volumeComparison.changePercent}
                    up={!data.volumeComparison.isDecrease}
                  />
                  <Text size="xs" c="dimmed">
                    {t('comparedToPrevious')}
                  </Text>
                </Group>
              }
            />
            <MetricCard
              label={t('activeLines')}
              value={`${data.activeLines} / ${data.totalLines}`}
              icon={<IconActivity size={18} />}
            />
            <MetricCard
              label={t('current24h')}
              value={fmtNum(data.volumeComparison.current)}
              unit="м³"
              icon={<IconGauge size={18} />}
            />
            <MetricCard
              label={t('previous24h')}
              value={fmtNum(data.volumeComparison.previous)}
              unit="м³"
              icon={<IconClockHour4 size={18} />}
            />
          </SimpleGrid>

          <Stack gap="md">
            {data.lumgGroups.map((g) => (
              <LumgSection key={g.lumgId} data={data} group={g} />
            ))}
          </Stack>
        </>
      )}
    </Stack>
  )
}
