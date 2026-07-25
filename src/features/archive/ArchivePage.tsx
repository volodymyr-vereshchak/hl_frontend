import { Navigate, useParams } from 'react-router-dom'
import { Paper, Stack, Title, Text, Group, Loader, Center, Alert, Badge, Box } from '@mantine/core'
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

// Height reserved for header (56) + main padding + title + controls.
const SPLIT_HEIGHT = 'calc(100dvh - 210px)'

export function ArchivePage() {
  const { type } = useParams<{ type: string }>()
  const { t } = useLanguage()
  const { lineId, lineMeta, dateRange, dateFilterEnabled } = useSelectionStore()

  if (!type || !VALID.includes(type as ArchiveType)) {
    return <Navigate to="/overview" replace />
  }
  const archiveType = type as ArchiveType

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

  const titleMap: Record<ArchiveType, string> = {
    daily: t('dailyArchive'),
    hourly: t('hourlyArchive'),
    edit: t('editArchive'),
    sys: t('systemArchive'),
    param: t('parameters'),
  }

  const showChart =
    rows && rows.length > 0 && lineMeta && (archiveType === 'daily' || archiveType === 'hourly')

  return (
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

      {/* Tree + table row: full viewport height, each scrolls internally. */}
      <Box style={{ display: 'flex', gap: 'var(--mantine-spacing-md)', height: SPLIT_HEIGHT, minHeight: 360 }}>
        <Paper
          withBorder
          radius="md"
          style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          <Text fw={600} px="sm" pt="sm" size="sm" tt="uppercase" c="dimmed">
            {t('nodeListTitle')}
          </Text>
          <Box style={{ flex: 1, minHeight: 0, padding: 'var(--mantine-spacing-sm)' }}>
            <TreeView fill />
          </Box>
        </Paper>

        <Paper
          withBorder
          radius="md"
          style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          {restricted ? (
            <Alert color="amber" variant="light" icon={<IconInfoCircle size={16} />} m="sm">
              {t('virtualLinesSupportOnlyDailyHourly')}
            </Alert>
          ) : !lineId ? (
            <Center style={{ flex: 1 }}>
              <Text c="dimmed">{t('selectLines')}</Text>
            </Center>
          ) : !dateFilterEnabled ? (
            <Center style={{ flex: 1 }}>
              <Text c="dimmed">{t('activateDate')}</Text>
            </Center>
          ) : error ? (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} m="sm">
              {(error as Error).message}
            </Alert>
          ) : isLoading ? (
            <Center style={{ flex: 1 }}>
              <Loader color="petrol" />
            </Center>
          ) : rows && lineMeta ? (
            <Box style={{ flex: 1, minHeight: 0 }}>
              <ArchiveTable rows={rows} type={archiveType} meta={lineMeta} />
            </Box>
          ) : null}
        </Paper>
      </Box>

      {/* Chart: full width, below the split — revealed on page scroll. */}
      {showChart && <ArchiveChart rows={rows} type={archiveType} meta={lineMeta} />}
    </Stack>
  )
}
