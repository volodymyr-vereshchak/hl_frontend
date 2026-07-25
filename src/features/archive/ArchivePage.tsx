import { useState, useEffect } from 'react'
import { Navigate, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Paper, Stack, Text, Loader, Center, Alert, Box, Divider } from '@mantine/core'
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react'
import { useSelectionStore } from '@/store/selectionStore'
import { useLanguage } from '@/locales/LanguageContext'
import { getArchiveColumns } from '@/domain/archiveColumns'
import { TablePagination } from '@/components/TablePagination'
import type { ArchiveType } from '@/types'
import { TreeView } from './TreeView'
import { DateRangeControls } from './DateRangeControls'
import { ArchiveTable } from './ArchiveTable'
import { ArchiveChart } from './ArchiveChart'
import { useArchiveData, useArchivePage, isPagedArchive, fetchFullArchive } from './useArchiveData'
import { useEnterpriseOverlay, applyOverlay } from './useEnterpriseOverlay'
import { exportArchiveToExcel, exportWithEnterpriseBreakdown } from './exportArchive'

const VALID: ArchiveType[] = ['daily', 'hourly', 'sys', 'edit', 'param']

// Height reserved for app header (56) + main padding + the single-line toolbar.
const SPLIT_HEIGHT = 'calc(100dvh - 150px)'

export function ArchivePage() {
  const { type } = useParams<{ type: string }>()
  const { t } = useLanguage()
  const { lineId, lineMeta, dateRange, dateFilterEnabled, setDateRange, setDateFilterEnabled } =
    useSelectionStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Deep links: ?fromDate=&toDate=(&filter=1) preselect the period.
  const qsFrom = searchParams.get('fromDate')
  const qsTo = searchParams.get('toDate')
  const qsFilter = searchParams.get('filter')
  useEffect(() => {
    if (qsFrom && qsTo) setDateRange({ fromDate: qsFrom, toDate: qsTo })
    if (qsFilter === '1') setDateFilterEnabled(true)
  }, [qsFrom, qsTo, qsFilter, setDateRange, setDateFilterEnabled])

  if (!type || !VALID.includes(type as ArchiveType)) {
    return <Navigate to="/overview" replace />
  }
  const archiveType = type as ArchiveType

  const restricted =
    lineMeta && lineMeta.kind !== 'physical' && !['daily', 'hourly'].includes(archiveType)

  const enabled = !!lineId && !!lineMeta && dateFilterEnabled && !restricted
  const paged = isPagedArchive(archiveType)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const full = useArchiveData({
    lineId,
    meta: lineMeta,
    type: archiveType,
    range: dateRange,
    enabled,
  })
  const pageQuery = useArchivePage({
    lineId,
    meta: lineMeta,
    type: archiveType,
    range: dateRange,
    enabled,
    page,
    pageSize,
  })

  const rawRows = paged ? pageQuery.data?.items : full.data
  const total = paged ? (pageQuery.data?.total ?? 0) : (rawRows?.length ?? 0)
  const isLoading = paged ? pageQuery.isLoading : full.isLoading
  const error = paged ? pageQuery.error : full.error

  // Enterprise (промисловість) overlay — daily/hourly only.
  const canOverlay = archiveType === 'daily' || archiveType === 'hourly'
  const overlay = useEnterpriseOverlay(canOverlay ? lineId : null, lineMeta, archiveType, dateRange)
  const rows =
    canOverlay && overlay.enabled && rawRows ? applyOverlay(rawRows, overlay.byPeriod, archiveType) : rawRows

  const canExport = !!rows && rows.length > 0
  const handleExport = async () => {
    if (!rows || !lineMeta || !lineId) return
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
    // Paged archives export the whole range, not just the visible page.
    const data = paged ? await fetchFullArchive(lineId, archiveType, dateRange) : rows
    // With the overlay on, export a per-enterprise breakdown instead.
    if (canOverlay && overlay.enabled) {
      await exportWithEnterpriseBreakdown(
        data,
        columns,
        archiveType,
        `${archiveType}_${lineId}_enterprise`,
        lineId,
        lineMeta.kind === 'virtual',
        dateRange,
      )
      return
    }
    exportArchiveToExcel(data, columns, archiveType, `${archiveType}_${lineId}`)
  }

  // Clicking a daily volume opens that commercial day in the hourly archive.
  const drillToHourly = (day: string) => {
    setDateRange({ fromDate: day, toDate: day })
    navigate('/archive/hourly')
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
    <Stack gap="sm">
      <DateRangeControls
        title={titleMap[archiveType]}
        kindBadge={lineMeta && lineMeta.kind !== 'physical' ? lineMeta.kind : null}
        onExport={handleExport}
        canExport={canExport}
        withTime={archiveType === 'hourly' || archiveType === 'sys' || archiveType === 'edit'}
        overlay={canOverlay && lineId ? overlay : undefined}
      />

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
            <>
              <Box style={{ flex: 1, minHeight: 0 }}>
                <ArchiveTable
                  rows={rows}
                  type={archiveType}
                  meta={lineMeta}
                  overlay={canOverlay && overlay.enabled && !!overlay.byPeriod}
                  onDrillDown={drillToHourly}
                />
              </Box>
              {paged && total > 0 && (
                <>
                  <Divider />
                  <TablePagination
                    page={page}
                    pageSize={pageSize}
                    total={total}
                    onPageChange={setPage}
                    onPageSizeChange={setPageSize}
                    shownLabel={`${t('records')}: ${total.toLocaleString('uk-UA')}`}
                  />
                </>
              )}
            </>
          ) : null}
        </Paper>
      </Box>

      {/* Chart: full width, below the split — revealed on page scroll. */}
      {showChart && (
        <ArchiveChart
          rows={rows}
          type={archiveType}
          meta={lineMeta}
          overlay={overlay.enabled && !!overlay.byPeriod}
        />
      )}
    </Stack>
  )
}
