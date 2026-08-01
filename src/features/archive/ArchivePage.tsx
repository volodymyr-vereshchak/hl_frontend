import { startTransition, useCallback, useEffect, useMemo, useState } from 'react'
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
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react'
import { useSelectionStore } from '@/store/selectionStore'
import { useLanguage } from '@/locales/LanguageContext'
import { getArchiveColumns } from '@/domain/archiveColumns'
import { commercialHourlyRange } from '@/domain/commercialDay'
import { DP_UNIT_DEFAULT, normalizeUnit, PRESSURE_UNIT_DEFAULT } from '@/domain/pressureUnits'
import { TablePagination, type PageSizeOption } from '@/components/TablePagination'
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

/**
 * A page is a stretch of time, not a row count: a month of the daily archive
 * and a month of the hourly one are the units people actually work in.
 * sys/edit stay on plain row counts — their rows are events, not periods, and
 * they page on the server.
 */
const PAGE_SIZES: Partial<Record<ArchiveType, { value: number; labelKey: string }[]>> = {
  daily: [
    { value: 31, labelKey: 'pageMonth' },
    { value: 92, labelKey: 'pageQuarter' },
    { value: 366, labelKey: 'pageYear' },
  ],
  hourly: [
    { value: 24, labelKey: 'pageDay' },
    { value: 168, labelKey: 'pageWeek' },
    { value: 744, labelKey: 'pageMonth' },
  ],
}
const DEFAULT_PAGE_SIZE: Record<ArchiveType, number> = {
  daily: 31,
  hourly: 744,
  sys: 50,
  edit: 50,
  param: 50,
}
/** Parameters return one record per line, so there is never a second page. */
const isClientPaged = (type: ArchiveType) => type === 'daily' || type === 'hourly'

/** Locale keys for the archive name that goes into the file name. */
const FILE_NAME_KEY: Record<ArchiveType, string> = {
  daily: 'dailyArchiveFile',
  hourly: 'hourlyArchiveFile',
  sys: 'systemArchiveFile',
  edit: 'editArchiveFile',
  param: 'parametersFile',
}

/** Anything a file name cannot carry (or that makes it awkward to type). */
const sanitizeForFileName = (s: string) =>
  s
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60)

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

  // An unknown :type redirects, but only AFTER the hooks below have run —
  // bailing out early would change the hook count between renders and crash
  // React on the way out. `daily` is a stand-in for that one render.
  const validType = type && VALID.includes(type as ArchiveType) ? (type as ArchiveType) : null
  const archiveType = validType ?? 'daily'

  const restricted =
    lineMeta && lineMeta.kind !== 'physical' && !['daily', 'hourly'].includes(archiveType)

  /** Identifies what is on screen: a change to any part restarts the paging. */
  const loadKey = `${archiveType}|${lineId}|${dateRange.fromDate}|${dateRange.toDate}`
  const enabled = !!lineId && !!lineMeta && dateFilterEnabled && !restricted
  const paged = isPagedArchive(archiveType)
  // Table or chart in the same pane — no scrolling to reach the plot. Kept per
  // archive type: the daily view and the hourly view are used differently.
  const [view, setView] = useLocalStorage<'table' | 'chart'>({
    key: `hlv-archive-view-${archiveType}`,
    defaultValue: 'table',
  })
  const clientPaged = isClientPaged(archiveType)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useLocalStorage({
    key: `hlv-archive-pagesize-${archiveType}`,
    defaultValue: DEFAULT_PAGE_SIZE[archiveType],
  })
  // A new period (or archive, or line) starts at its first page.
  useEffect(() => setPage(1), [loadKey])
  const pageSizeOptions: PageSizeOption[] | undefined = useMemo(
    () => PAGE_SIZES[archiveType]?.map((s) => ({ value: s.value, label: t(s.labelKey) })),
    [archiveType, t],
  )

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
  // The daily and hourly archives are always paged, whatever the range: the
  // control belongs to the view, not to how much happened to come back, and a
  // bar that appears and disappears with the data is worse than a quiet one.
  const showPagination = total > 0 && (paged || clientPaged)

  // Enterprise (промисловість) overlay — daily/hourly only.
  const canOverlay = archiveType === 'daily' || archiveType === 'hourly'
  // No confirmation on the switch: the overlay reads the same DPD archive table
  // in Postgres that everything else does (`live` is off), so a long period is
  // a database read like any other. Only ranges the archive has never covered
  // reach the DPD API at all, and that is a backfill, not the normal path.
  const overlay = useEnterpriseOverlay(canOverlay ? lineId : null, lineMeta, archiveType, dateRange)
  const rows =
    canOverlay && overlay.enabled && rawRows ? applyOverlay(rawRows, overlay.byPeriod, archiveType) : rawRows
  // A DPD line has no unit configuration of its own — its pressure unit comes
  // with the data, as the device reported it. Everything below (table, chart,
  // export) reads units off `meta`, so fold it in there once.
  const meta = useMemo(() => {
    if (!lineMeta || lineMeta.kind !== 'dpd') return lineMeta
    const withUnit = rows?.find((r) => normalizeUnit(r.press_unit))
    if (!withUnit) return lineMeta
    return { ...lineMeta, pressure_unit: normalizeUnit(withUnit.press_unit) }
  }, [lineMeta, rows])

  const showChart = canOverlay && view === 'chart' && !!rows?.length
  // Once the chart has been opened it stays in the tree, hidden.
  const [chartMounted, setChartMounted] = useState(false)
  useEffect(() => {
    if (showChart) setChartMounted(true)
  }, [showChart])


  const canExport = !!rows && rows.length > 0
  const runExport = async () => {
    if (!rows || !meta || !lineId) return
    const columns = getArchiveColumns({
      archiveType,
      isVirtualLine: meta.kind === 'virtual',
      isDpdLine: meta.kind === 'dpd',
      lineUnits: meta,
      showOutputPressure: meta.kind === 'physical' && !meta.is_high_pressure && !meta.meter,
      pressureUnit: meta.pressure_unit || PRESSURE_UNIT_DEFAULT,
      dpUnit: meta.dp_unit || DP_UNIT_DEFAULT,
      t,
    })
    // Paged archives export the whole range, not just the visible page.
    const data = paged ? await fetchFullArchive(lineId, archiveType, dateRange) : rows
    // Name the file after the line, not its database id: a folder of exports
    // should be readable without looking anything up.
    const lineName = sanitizeForFileName(meta.name || `#${lineId}`)
    const fileBase = `${t(FILE_NAME_KEY[archiveType])}_${lineName}`
    // With the overlay on, export a per-enterprise breakdown instead.
    if (canOverlay && overlay.enabled) {
      await exportWithEnterpriseBreakdown(
        data,
        columns,
        archiveType,
        `${fileBase}_${t('enterpriseFile')}`,
        lineId,
        meta.kind === 'virtual',
        dateRange,
      )
      return
    }
    exportArchiveToExcel(data, columns, archiveType, fileBase)
  }

  const handleExport = async () => {
    try {
      await runExport()
    } catch (e) {
      // Without this the whole export failed silently — the enterprise
      // breakdown fetches from the API, and that request can 400 or time out.
      notifications.show({
        color: 'red',
        title: t('exportError'),
        message: (e as Error).message,
      })
    }
  }

  // Clicking a daily volume opens that commercial day in the hourly archive.
  // Stable identity, or the memoised table would rebuild on every render.
  const drillToHourly = useCallback(
    (day: string) => {
      setDateRange({ fromDate: day, toDate: day })
      navigate('/archive/hourly')
    },
    [navigate, setDateRange],
  )

  if (!validType) return <Navigate to="/overview" replace />

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
          ) : isLoading ? (
            <Center style={{ flex: 1 }}>
              <Loader color="petrol" />
            </Center>
          ) : error ? (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} m="sm">
              {(error as Error).message}
            </Alert>
          ) : rows && meta ? (
            <>
              {/* daily/hourly only: the other archives have nothing to plot. */}
              {canOverlay && rows.length > 0 && (
                <Group
                  px="sm"
                  py={6}
                  style={{ borderBottom: '1px solid var(--hlv-border)', flexShrink: 0 }}
                >
                  {/* The heavy part of the switch is mounting the chart (~450ms
                      of render for a month of hourly points). startTransition
                      lets React paint the control immediately and do that work
                      after, so the click never feels swallowed. */}
                  <SegmentedControl
                    size="xs"
                    value={view}
                    onChange={(v) => startTransition(() => setView(v as 'table' | 'chart'))}
                    data={[
                      { value: 'table', label: t('table') },
                      { value: 'chart', label: t('chart') },
                    ]}
                  />
                </Group>
              )}
              {/*
                The table is HIDDEN, not unmounted, when the chart is shown. A
                month of hourly data is ~750 rows; re-mounting them on every
                switch cost ~1s of blocked main thread, which read as "the table
                is loading again". Kept mounted, switching back is instant.
              */}
              <Box style={{ flex: 1, minHeight: 0, display: showChart ? 'none' : 'block' }}>
                <ArchiveTable
                  rows={rows}
                  type={archiveType}
                  meta={meta}
                  overlay={canOverlay && overlay.enabled && !!overlay.byPeriod}
                  onDrillDown={drillToHourly}
                  /* sys/edit arrive one page at a time from the server; the
                     others hold the whole period and page it here. */
                  page={clientPaged ? page : undefined}
                  pageSize={clientPaged ? pageSize : undefined}
                />
              </Box>
              {/* Mounted on first use and then kept: re-creating the plot on
                  every switch cost about a second each way. */}
              {chartMounted && (
                <Box
                  style={{
                    flex: showChart ? 1 : undefined,
                    minHeight: 0,
                    display: showChart ? 'flex' : 'none',
                    flexDirection: 'column',
                  }}
                >
                  <ArchiveChart
                    rows={rows}
                    type={archiveType}
                    meta={meta}
                    overlay={overlay.enabled && !!overlay.byPeriod}
                    embedded
                  />
                </Box>
              )}
              {showPagination && (
                <>
                  <Divider />
                  <TablePagination
                    page={page}
                    pageSize={pageSize}
                    total={total}
                    onPageChange={setPage}
                    onPageSizeChange={setPageSize}
                    shownLabel={`${t('records')}: ${total.toLocaleString('uk-UA')}`}
                    pageSizes={pageSizeOptions}
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
