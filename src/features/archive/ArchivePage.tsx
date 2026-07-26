import { useState, useEffect } from 'react'
import { Navigate, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Paper,
  Stack,
  Text,
  Loader,
  Center,
  Alert,
  Box,
  Divider,
  Group,
  SegmentedControl,
} from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react'
import { useSelectionStore } from '@/store/selectionStore'
import { useLanguage } from '@/locales/LanguageContext'
import { getArchiveColumns } from '@/domain/archiveColumns'
import { commercialHourlyRange } from '@/domain/commercialDay'
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

const hasTimePart = (s: string) => /\d{2}:\d{2}/.test(s)

/** Expand a date-only range to the commercial day window: D 07:00 → (D+1) 06:00. */
function commercialWindow(fromDate: string, toDate: string) {
  const win = commercialHourlyRange(fromDate.slice(0, 10), toDate.slice(0, 10))
  return { fromDate: win.from.replace('T', ' '), toDate: win.to.replace('T', ' ') }
}

// Height reserved for app header (56) + main padding + the single-line toolbar.
/** Tree + pane fill the screen; nothing else sits below them. */
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

  // Time-based archives default to the commercial day window (07:00 → 06:00):
  // widen a date-only range to those bounds when entering such a view.
  const needsTime = type === 'hourly' || type === 'sys' || type === 'edit'
  useEffect(() => {
    if (!needsTime || qsFrom) return
    if (hasTimePart(dateRange.fromDate) || hasTimePart(dateRange.toDate)) return
    setDateRange(commercialWindow(dateRange.fromDate, dateRange.toDate))
  }, [needsTime, qsFrom, dateRange.fromDate, dateRange.toDate, setDateRange])

  if (!type || !VALID.includes(type as ArchiveType)) {
    return <Navigate to="/overview" replace />
  }
  const archiveType = type as ArchiveType

  const restricted =
    lineMeta && lineMeta.kind !== 'physical' && !['daily', 'hourly'].includes(archiveType)

  const enabled = !!lineId && !!lineMeta && dateFilterEnabled && !restricted
  const paged = isPagedArchive(archiveType)
  // Table or chart in the same pane — no scrolling to reach the plot. Kept per
  // archive type: the daily view and the hourly view are used differently.
  const [view, setView] = useLocalStorage<'table' | 'chart'>({
    key: `hlv-archive-view-${archiveType}`,
    defaultValue: 'table',
  })
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
          style={{ width: 420, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
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
              {/* daily/hourly only: the other archives have nothing to plot. */}
              {canOverlay && rows.length > 0 && (
                <Group
                  px="sm"
                  py={6}
                  style={{ borderBottom: '1px solid var(--hlv-border)', flexShrink: 0 }}
                >
                  <SegmentedControl
                    size="xs"
                    value={view}
                    onChange={(v) => setView(v as 'table' | 'chart')}
                    data={[
                      { value: 'table', label: t('table') },
                      { value: 'chart', label: t('chart') },
                    ]}
                  />
                </Group>
              )}
              {canOverlay && view === 'chart' && rows.length > 0 ? (
                <ArchiveChart
                  rows={rows}
                  type={archiveType}
                  meta={lineMeta}
                  overlay={overlay.enabled && !!overlay.byPeriod}
                  embedded
                />
              ) : (
                <Box style={{ flex: 1, minHeight: 0 }}>
                  <ArchiveTable
                    rows={rows}
                    type={archiveType}
                    meta={lineMeta}
                    overlay={canOverlay && overlay.enabled && !!overlay.byPeriod}
                    onDrillDown={drillToHourly}
                  />
                </Box>
              )}
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
    </Stack>
  )
}
