import { Navigate, useParams } from 'react-router-dom'
import {
  Grid,
  Paper,
  Stack,
  Title,
  Text,
  Group,
  Loader,
  Center,
  Alert,
  Badge,
  Box,
} from '@mantine/core'
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react'
import { useSelectionStore } from '@/store/selectionStore'
import { useLanguage } from '@/locales/LanguageContext'
import { getArchiveColumns } from '@/domain/archiveColumns'
import type { ArchiveType } from '@/types'
import { TreeView } from './TreeView'
import { DateRangeControls } from './DateRangeControls'
import { ArchiveTable } from './ArchiveTable'
import { ArchiveChart } from './ArchiveChart'
import { useArchiveData } from './useArchiveData'
import { exportArchiveToExcel } from './exportArchive'

const VALID: ArchiveType[] = ['daily', 'hourly', 'sys', 'edit', 'param']

export function ArchivePage() {
  const { type } = useParams<{ type: string }>()
  const { t } = useLanguage()
  const { lineId, lineMeta, dateRange, dateFilterEnabled } = useSelectionStore()

  if (!type || !VALID.includes(type as ArchiveType)) {
    return <Navigate to="/overview" replace />
  }
  const archiveType = type as ArchiveType

  // Virtual/DPD lines only carry daily/hourly.
  const restricted =
    lineMeta && lineMeta.kind !== 'physical' && !['daily', 'hourly'].includes(archiveType)

  const enabled = !!lineId && !!lineMeta && dateFilterEnabled && !restricted
  const { data: rows, isLoading, error } = useArchiveData({
    lineId,
    meta: lineMeta,
    type: archiveType,
    range: dateRange,
    enabled,
  })

  const canExport = !!rows && rows.length > 0
  const handleExport = () => {
    if (!rows || !lineMeta) return
    const columns = getArchiveColumns({
      archiveType,
      isVirtualLine: lineMeta.kind === 'virtual',
      isDpdLine: lineMeta.kind === 'dpd',
      lineUnits: lineMeta,
      showOutputPressure: lineMeta.kind === 'physical' && !lineMeta.is_high_pressure && !lineMeta.meter,
      pressureUnit: lineMeta.pressure_unit || 'кгс/см²',
      dpUnit: lineMeta.dp_unit || 'кгс/м²',
      t,
    })
    exportArchiveToExcel(rows, columns, archiveType, `${archiveType}_${lineId}`)
  }

  const titleKey = archiveType as
    | 'dailyArchive'
    | 'hourlyArchive'
    | 'editArchive'
    | 'systemArchive'
    | 'parameters'
  const titleMap: Record<ArchiveType, string> = {
    daily: t('dailyArchive'),
    hourly: t('hourlyArchive'),
    edit: t('editArchive'),
    sys: t('systemArchive'),
    param: t('parameters'),
  }
  void titleKey

  return (
    <Grid gap="lg">
      <Grid.Col span={{ base: 12, md: 3 }}>
        <Paper p="sm" radius="md" withBorder>
          <Text fw={600} mb="xs" size="sm" tt="uppercase" c="dimmed">
            {t('nodeListTitle')}
          </Text>
          <TreeView />
        </Paper>
      </Grid.Col>

      <Grid.Col span={{ base: 12, md: 9 }}>
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Group gap="sm">
              <Title order={3}>{titleMap[archiveType]}</Title>
              {lineMeta && lineMeta.kind !== 'physical' && (
                <Badge variant="light" color={lineMeta.kind === 'virtual' ? 'grape' : 'blue'}>
                  {lineMeta.kind === 'virtual' ? 'Virtual' : 'DPD'}
                </Badge>
              )}
            </Group>
          </Group>

          <DateRangeControls onExport={handleExport} canExport={canExport} />

          {restricted && (
            <Alert color="amber" variant="light" icon={<IconInfoCircle size={16} />}>
              {t('virtualLinesSupportOnlyDailyHourly')}
            </Alert>
          )}

          {!lineId && (
            <Alert color="petrol" variant="light" icon={<IconInfoCircle size={16} />}>
              {t('selectLines')}
            </Alert>
          )}

          {lineId && !dateFilterEnabled && !restricted && (
            <Alert color="petrol" variant="light" icon={<IconInfoCircle size={16} />}>
              {t('activateDate')}
            </Alert>
          )}

          {error && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
              {(error as Error).message}
            </Alert>
          )}

          {isLoading && (
            <Center py={60}>
              <Loader color="petrol" />
            </Center>
          )}

          {rows && lineMeta && (
            <>
              {(archiveType === 'daily' || archiveType === 'hourly') && rows.length > 0 && (
                <ArchiveChart rows={rows} type={archiveType} meta={lineMeta} />
              )}
              <Paper p={0} radius="md" withBorder>
                <Box p="xs">
                  <ArchiveTable rows={rows} type={archiveType} meta={lineMeta} />
                </Box>
              </Paper>
            </>
          )}
        </Stack>
      </Grid.Col>
    </Grid>
  )
}
