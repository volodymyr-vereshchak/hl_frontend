import { Alert, Group, Select, Stack, Tabs, Text, Title } from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import { IconAlertTriangle, IconChartLine, IconDatabase, IconInfoCircle, IconMathFunction } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { grsModelApi } from '@/api/grsModel'
import { LoadingState } from '@/components/LoadingState'
import { useUser } from '@/features/auth/UserContext'
import { useBranches, useEnsureValidBranch } from '@/features/reports/useBranchLines'
import { useLanguage } from '@/locales/LanguageContext'
import { useSelectionStore } from '@/store/selectionStore'
import { AnalysisTab } from './AnalysisTab'
import { DataTab } from './DataTab'
import { ModelTab } from './ModelTab'

type TabKey = 'analysis' | 'model' | 'data'

const grsModelStatusKey = (branchId: number | null) => ['grs-model', 'status', branchId] as const

/**
 * Аналітика → «Модель споживання ГРС». What households of a GRS burn (inflow
 * minus the non-household consumption from 1С) is explained by the weather;
 * where a station departs from its own model more than the others do, the
 * metering is worth a look. Three tabs: the comparison, the model's quality,
 * and the data it is fed from.
 */
export function GrsModelPage() {
  const { t } = useLanguage()
  const { user } = useUser()
  const isAdmin = user?.role === 'admin'
  const { branchId, setBranchId } = useSelectionStore()
  const { data: branches } = useBranches()
  useEnsureValidBranch(branches)
  const [tab, setTab] = useLocalStorage<TabKey>({ key: 'hlv-grs-model-tab', defaultValue: 'analysis' })

  const status = useQuery({
    queryKey: grsModelStatusKey(branchId),
    enabled: branchId != null,
    queryFn: () => grsModelApi.status(branchId!),
  })
  const data = status.data
  const empty = !!data && data.rows === 0
  // With nothing uploaded there is nothing to analyse: show where to start.
  const active: TabKey = empty ? 'data' : !data?.fit && tab === 'analysis' ? 'model' : tab

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={3}>{t('gmTitle')}</Title>
          <Text size="xs" c="dimmed">
            {t('gmDescription')}
          </Text>
        </div>
        <Select
          placeholder={t('branch')}
          data={(branches ?? []).map((b) => ({ value: String(b.id), label: b.name }))}
          value={branchId != null ? String(branchId) : null}
          onChange={(v) => setBranchId(v ? Number(v) : null)}
          allowDeselect={false}
          searchable
          size="xs"
          w={260}
        />
      </Group>

      {status.error && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          {(status.error as Error).message}
        </Alert>
      )}
      {status.isLoading && <LoadingState py={100} label={t('appLoading')} />}

      {data && branchId != null && (
        <>
          {empty && (
            <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
              {t(isAdmin ? 'gmEmptyAdmin' : 'gmEmptyViewer')}
            </Alert>
          )}
          {!empty && !data.fit && (
            <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
              {t(isAdmin ? 'gmNoFitAdmin' : 'gmNoFitViewer')}
            </Alert>
          )}
          {data.fit?.stale && (
            <Alert color="yellow" variant="light" icon={<IconInfoCircle size={16} />}>
              {t('gmStale')}
            </Alert>
          )}

          <Tabs value={active} onChange={(v) => v && setTab(v as TabKey)} keepMounted={false}>
            <Tabs.List mb="md">
              <Tabs.Tab value="analysis" leftSection={<IconChartLine size={15} />} disabled={!data.fit}>
                {t('gmTabAnalysis')}
              </Tabs.Tab>
              <Tabs.Tab value="model" leftSection={<IconMathFunction size={15} />} disabled={empty}>
                {t('gmTabModel')}
              </Tabs.Tab>
              <Tabs.Tab value="data" leftSection={<IconDatabase size={15} />}>
                {t('gmTabData')}
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="analysis">
              {data.fit && <AnalysisTab branchId={branchId} status={data} />}
            </Tabs.Panel>
            <Tabs.Panel value="model">
              <ModelTab branchId={branchId} status={data} isAdmin={isAdmin} />
            </Tabs.Panel>
            <Tabs.Panel value="data">
              <DataTab branchId={branchId} status={data} isAdmin={isAdmin} />
            </Tabs.Panel>
          </Tabs>
        </>
      )}
    </Stack>
  )
}
