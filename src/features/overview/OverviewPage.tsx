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
  Alert,
  Box,
  Paper,
  ThemeIcon,
  Collapse,
  UnstyledButton,
  Button,
} from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import {
  IconArrowUpRight,
  IconArrowDownRight,
  IconAlertTriangle,
  IconGauge,
  IconClockHour4,
  IconActivity,
  IconChevronRight,
} from '@tabler/icons-react'
import { useSelectionStore } from '@/store/selectionStore'
import { useLanguage } from '@/locales/LanguageContext'
import { numericStyle } from '@/theme/theme'
import { LineCard } from './LineCard'
import { useOverviewData, type OverviewData, type LumgGroup } from './useOverviewData'
import { LoadingState } from '@/components/LoadingState'

function fmtNum(n: number, digits = 0) {
  return n.toLocaleString('uk-UA', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

function MetricCard({
  label,
  value,
  unit,
  icon,
  color = 'petrol',
  extra,
}: {
  label: string
  value: string
  unit?: string
  icon: React.ReactNode
  color?: string
  extra?: React.ReactNode
}) {
  return (
    <Card padding="md" radius="md">
      <Group justify="center" gap={8}>
        <ThemeIcon variant="light" color={color} size="sm" radius="md">
          {icon}
        </ThemeIcon>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {label}
        </Text>
      </Group>
      <Group align="baseline" gap={6} mt="xs" justify="center">
        <Text fz={26} fw={700} style={numericStyle} lh={1}>
          {value}
        </Text>
        {unit && (
          <Text c="dimmed" size="sm">
            {unit}
          </Text>
        )}
      </Group>
      {extra && (
        <Box mt={6} ta="center">
          {extra}
        </Box>
      )}
    </Card>
  )
}

function LumgSection({
  data,
  group,
  collapsed,
  onToggle,
}: {
  data: OverviewData
  group: LumgGroup
  collapsed: boolean
  onToggle: () => void
}) {
  const { t } = useLanguage()
  const flowById = new Map(data.flowComparisons.map((f) => [f.lineId, f]))
  const volById = new Map(data.volumeComparisons.map((v) => [v.lineId, v]))
  const cards = group.lineIds.filter((id) => data.pressures[id])

  return (
    <Paper radius="md" withBorder>
      <UnstyledButton onClick={onToggle} p="sm" w="100%">
        <Group gap="xs">
          <IconChevronRight
            size={16}
            style={{ transform: collapsed ? 'none' : 'rotate(90deg)', transition: 'transform 150ms' }}
          />
          <Text fw={600} fz="lg" ff="'Space Grotesk Variable', sans-serif">
            {group.lumgName}
          </Text>
          <Badge variant="light" color="steel" size="sm">
            {group.lineIds.length} {t('linesCount')}
          </Badge>
        </Group>
      </UnstyledButton>
      <Collapse expanded={!collapsed}>
        <Box px="sm" pb="sm">
          {/* auto-fill rather than a fixed column count: the cards keep a
              readable minimum width and a wide screen simply fits more. */}
          {cards.length > 0 ? (
            <Box
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(186px, 1fr))',
                gap: 'var(--mantine-spacing-xs)',
              }}
            >
              {cards.map((id) => (
                <LineCard
                  key={id}
                  lineName={data.lineNames[id] ?? String(id)}
                  pressure={data.pressures[id]}
                  flow={flowById.get(id)}
                  volume={volById.get(id)}
                  referenceTime={data.currentPeriod.end}
                />
              ))}
            </Box>
          ) : (
            <Text c="dimmed" size="sm" ta="center" py="md">
              {t('noLinesInLumg')}
            </Text>
          )}
        </Box>
      </Collapse>
    </Paper>
  )
}

export function OverviewPage() {
  const { t } = useLanguage()
  const { branchId, setBranchId } = useSelectionStore()
  const { topology, data, isLoading, error } = useOverviewData(branchId)
  const [collapsed, setCollapsed] = useLocalStorage<Record<number, boolean>>({
    key: 'hlv-overview-collapsed-lumgs',
    defaultValue: {},
  })

  const branches = topology.data?.branches ?? []

  useEffect(() => {
    if (branchId == null && branches.length > 0) setBranchId(branches[0].id)
  }, [branchId, branches, setBranchId])

  const setAll = (value: boolean) => {
    if (!data) return
    const next: Record<number, boolean> = {}
    data.lumgGroups.forEach((g) => (next[g.lumgId] = value))
    setCollapsed(next)
  }

  const vc = data?.volumeComparison
  const allActive = !!data && data.activeLines === data.totalLines && data.totalLines > 0

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
          data={branches.map((b) => ({ value: String(b.id), label: b.name }))}
          value={branchId != null ? String(branchId) : null}
          onChange={(v) => setBranchId(v ? Number(v) : null)}
          w={280}
          placeholder={t('branch')}
          searchable
        />
      </Group>

      {error && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          {(error as Error).message}
        </Alert>
      )}

      {isLoading && (
        <LoadingState py={80} label={t('appLoading')} />
      )}

      {data && (
        <>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <MetricCard
              label={t('total24hVolume')}
              value={fmtNum(data.totalVolume24h)}
              unit="м³"
              icon={<IconGauge size={18} />}
              extra={
                vc && (
                  <Group gap={6} justify="center">
                    <Badge
                      variant="light"
                      color={vc.isDecrease ? 'red' : vc.isIncrease ? 'teal' : 'gray'}
                      size="sm"
                      tt="none" // Badge uppercases by default, which mangles "м³"
                      leftSection={
                        vc.isDecrease ? <IconArrowDownRight size={12} /> : <IconArrowUpRight size={12} />
                      }
                    >
                      {/* Absolute change as well as the share — a percent alone
                          says nothing about how much gas that actually is. */}
                      <Text span style={numericStyle} inherit>
                        {fmtNum(Math.abs(vc.change))} {t('volumeUnit')} (
                        {vc.changePercent > 0 ? '+' : ''}
                        {vc.changePercent}%)
                      </Text>
                    </Badge>
                    <Text size="xs" c="dimmed">
                      {t('comparedToPrevious')}
                    </Text>
                  </Group>
                )
              }
            />
            <MetricCard
              label={t('lastUpdate')}
              value={data.currentPeriod.end.toLocaleDateString('uk-UA')}
              unit={data.currentPeriod.end.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}
              icon={<IconClockHour4 size={18} />}
            />
            <MetricCard
              label={t('activeLines')}
              value={`${data.activeLines} / ${data.totalLines}`}
              color={allActive ? 'teal' : 'amber'}
              icon={<IconActivity size={18} />}
            />
          </SimpleGrid>

          {data.lumgGroups.length > 1 && (
            <Group gap="xs">
              <Button size="xs" variant="default" onClick={() => setAll(false)}>
                {t('expandAll')}
              </Button>
              <Button size="xs" variant="default" onClick={() => setAll(true)}>
                {t('collapseAll')}
              </Button>
            </Group>
          )}

          <Stack gap="md">
            {data.lumgGroups.map((g) => (
              <LumgSection
                key={g.lumgId}
                data={data}
                group={g}
                collapsed={!!collapsed[g.lumgId]}
                onToggle={() => setCollapsed({ ...collapsed, [g.lumgId]: !collapsed[g.lumgId] })}
              />
            ))}
          </Stack>
        </>
      )}
    </Stack>
  )
}
