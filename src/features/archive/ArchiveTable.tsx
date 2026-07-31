import { memo, useMemo, useState } from 'react'
import { Table, Text, Group, Box, ScrollArea, Menu, Tooltip, UnstyledButton } from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import {
  IconArrowUp,
  IconArrowDown,
  IconMathAvg,
  IconMathMax,
  IconMathMin,
  IconSum,
} from '@tabler/icons-react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from '@tanstack/react-table'
import { useStickyRowHeights } from '@/components/useMeasuredHeight'
import { numericStyle } from '@/theme/theme'
import { useLanguage } from '@/locales/LanguageContext'
import {
  AGGREGATES,
  AGGREGATE_LABELS,
  columnAggregate,
  fold,
  type Aggregate,
} from '@/domain/aggregate'
import { getArchiveColumns, resolveEditName } from '@/domain/archiveColumns'
import { DP_UNIT_DEFAULT, PRESSURE_UNIT_DEFAULT } from '@/domain/pressureUnits'
import { formatEditValue } from '@/domain/valueConverter'
import type { ArchiveType } from '@/types'
import type { LineMeta } from '@/store/selectionStore'
import type { ArchiveRow } from '@/api/entities'

interface Props {
  rows: ArchiveRow[]
  type: ArchiveType
  meta: LineMeta
  /** Enterprise overlay on → show NET + total-enterprise columns. */
  overlay?: boolean
  /** Daily archive: open the hourly archive for the clicked commercial day. */
  onDrillDown?: (day: string) => void
  /**
   * Show one page of `rows` instead of all of them. Sorting and the totals row
   * still run over the whole range — the page is a view, not a subset of the
   * data. Omit both to render everything (sys/edit paginate on the server, so
   * their `rows` is already one page).
   */
  page?: number
  pageSize?: number
}

const pad = (n: number) => String(n).padStart(2, '0')

function fmtPeriod(period: string, type: ArchiveType): string {
  const d = new Date(period)
  if (isNaN(d.getTime())) return period
  const date = d.toLocaleDateString('uk-UA')
  if (type === 'hourly') return `${date} ${pad(d.getHours())}:00`
  // sys/edit events and parameter records carry a real time-of-day — show
  // seconds too. Two parameter records can share a date, so the date alone
  // does not identify a row.
  if (type === 'sys' || type === 'edit' || type === 'param') {
    return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }
  return date
}

/** Two decimals everywhere; event counters are integers, small values keep more. */
function decimalsFor(key: string): number {
  if (key === 'density') return 4
  // Pipe roughness and the orifice edge radius are fractions of a millimetre:
  // real values in the archive go down to 0.0032 mm, which two decimals
  // flattened to "0,00" — indistinguishable from the genuine zero a meter
  // (no orifice at all) carries.
  if (key === 'roughness' || key === 'radius') return 5
  if (key === 'edit_counts' || key === 'sys_counts') return 0
  return 2
}

function fmtNumber(v: unknown, digits = 2): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!isFinite(n)) return String(v)
  return n.toLocaleString('uk-UA', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** The mode's mark in the footer: a glyph, not a word — it sits in a data cell. */
const AGGREGATE_ICONS: Record<Aggregate, typeof IconSum> = {
  sum: IconSum,
  avg: IconMathAvg,
  max: IconMathMax,
  min: IconMathMin,
}

/**
 * One footer cell: the folded value, marked with how it was folded, and the
 * mark is the way to change it. Per column, because a row that sums volumes
 * and averages pressure is the only row that means anything.
 */
function AggregateCell({
  value,
  how,
  onPick,
  t,
}: {
  value: string
  how: Aggregate
  onPick: (how: Aggregate) => void
  t: (key: string) => string
}) {
  const Icon = AGGREGATE_ICONS[how]
  return (
    <Menu shadow="md" position="top" withinPortal>
      <Menu.Target>
        <Tooltip label={`${t(AGGREGATE_LABELS[how])} — ${t('aggregateChange')}`} withArrow>
          <UnstyledButton aria-label={t(AGGREGATE_LABELS[how])} style={{ width: '100%' }}>
            <Group gap={4} justify="center" wrap="nowrap">
              <Icon size={13} stroke={1.8} style={{ color: 'var(--mantine-color-dimmed)' }} />
              <Text fw={700} size="sm">
                {value}
              </Text>
            </Group>
          </UnstyledButton>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        {AGGREGATES.map((key) => {
          const ItemIcon = AGGREGATE_ICONS[key]
          return (
            <Menu.Item
              key={key}
              leftSection={<ItemIcon size={14} stroke={1.8} />}
              onClick={() => onPick(key)}
              fw={key === how ? 700 : undefined}
            >
              {t(AGGREGATE_LABELS[key])}
            </Menu.Item>
          )
        })}
      </Menu.Dropdown>
    </Menu>
  )
}

const helper = createColumnHelper<ArchiveRow>()

/**
 * Memoised: a month of hourly data is ~750 rows, and rebuilding them cost ~0.8s
 * of blocked main thread whenever ANY sibling state changed — flipping the
 * industry switch, for instance, which does not touch the table until its data
 * actually arrives. Callers must keep the props referentially stable.
 */
export const ArchiveTable = memo(function ArchiveTable({
  rows,
  type,
  meta,
  overlay,
  onDrillDown,
  page,
  pageSize,
}: Props) {
  const { t } = useLanguage()
  const [sorting, setSorting] = useState<SortingState>([])

  const specs = useMemo(() => {
    const base = getArchiveColumns({
      archiveType: type,
      isVirtualLine: meta.kind === 'virtual',
      isDpdLine: meta.kind === 'dpd',
      lineUnits: meta,
      showOutputPressure: meta.kind === 'physical' && !meta.is_high_pressure && !meta.meter,
      pressureUnit: meta.pressure_unit || PRESSURE_UNIT_DEFAULT,
      dpUnit: meta.dp_unit || DP_UNIT_DEFAULT,
      t,
    })
    if (!overlay) return base
    // Enterprise overlay adds NET and total-industry columns next to volume.
    return [
      ...base,
      { key: 'netVolume', label: t('netVolume'), sortable: true, isSummable: true },
      { key: 'totalEnterprise', label: t('totalEnterpriseVolume'), sortable: true, isSummable: true },
    ]
  }, [type, meta, t, overlay])

  const columns = useMemo(
    () =>
      specs.map((spec) =>
        helper.accessor((row) => row[spec.key], {
          id: spec.key,
          header: spec.label,
          enableSorting: spec.sortable,
          cell: (info) => {
            const raw = info.getValue()
            if (spec.key === 'period') return fmtPeriod(String(raw), type)
            if (type === 'edit' && spec.key === 'edit_name') {
              return resolveEditName(String(raw ?? ''), info.row.original.old_value, info.row.original.new_value)
            }
            if (type === 'edit' && (spec.key === 'old_value' || spec.key === 'new_value')) {
              return formatEditValue(raw == null ? null : Number(raw))
            }
            if (spec.key === 'sys_name' || spec.key === 'edit_name') return String(raw ?? '—')
            // Daily volume drills down into that commercial day's hourly archive.
            if (spec.key === 'volume' && type === 'daily' && onDrillDown) {
              const day = String(info.row.original.period).slice(0, 10)
              return (
                <Text
                  component="span"
                  c="petrol"
                  style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                  onClick={() => onDrillDown(day)}
                  title="Відкрити годинний архів за цю добу"
                >
                  {fmtNumber(raw, decimalsFor(spec.key))}
                </Text>
              )
            }
            return fmtNumber(raw, decimalsFor(spec.key))
          },
        }),
      ),
    [specs, type, onDrillDown],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  // Sliced AFTER sorting, so a sort reorders the whole period and the first
  // page shows its real top — not the top of whatever page is open.
  // `getRowModel()` is memoised by TanStack on data + sorting, and slicing an
  // array of row objects is cheap, so this needs no memo of its own.
  const sortedRows = table.getRowModel().rows
  const visibleRows =
    page == null || pageSize == null
      ? sortedRows
      : sortedRows.slice((page - 1) * pageSize, page * pageSize)

  // Per column, and kept per archive type — the daily view and the hourly view
  // get read for different things. Absent key = that column's own default.
  const [aggregates, setAggregates] = useLocalStorage<Record<string, Aggregate>>({
    key: `hlv-archive-agg-cols-${type}`,
    defaultValue: {},
  })
  const pickAggregate = (key: string, how: Aggregate) =>
    setAggregates({ ...aggregates, [key]: how })

  // Over the WHOLE period, not the open page — the footer answers "what did
  // this line do in the period", which a page cannot.
  const summary = useMemo(() => {
    const out: Record<string, { text: string; how: Aggregate }> = {}
    for (const spec of specs) {
      if (!spec.isSummable && !spec.isAveragable) continue
      const how = columnAggregate(spec, aggregates[spec.key])
      const values = rows.map((r) => Number(r[spec.key])).filter((n) => isFinite(n))
      const folded = fold(values, how)
      out[spec.key] = {
        text: folded == null ? '—' : fmtNumber(folded, decimalsFor(spec.key)),
        how,
      }
    }
    return out
  }, [rows, specs, aggregates])

  const numericKeys = new Set(specs.filter((s) => s.key !== 'period' && s.key !== 'edit_name' && s.key !== 'sys_name').map((s) => s.key))
  // Parameters are a snapshot list — a totals row is meaningless there.
  const hasSummary = type !== 'param' && specs.some((s) => s.isSummable || s.isAveragable)
  // Both feed the scrollbars, which run between the sticky header and the
  // sticky totals row. Measured rather than assumed: the header takes one line
  // wide and two lines narrow, and the totals row is absent in `param`.
  const { containerRef, theadRef, tfootRef, theadHeight, tfootHeight } = useStickyRowHeights()

  return (
    <ScrollArea
      ref={containerRef}
      className="hlv-table-scroll"
      type="auto"
      style={
        {
          height: '100%',
          '--hlv-thead-h': `${theadHeight}px`,
          '--hlv-tfoot-h': `${tfootHeight}px`,
        } as React.CSSProperties
      }
    >
      <Table striped highlightOnHover stickyHeader verticalSpacing={6}>
        <Table.Thead ref={theadRef}>
          {table.getHeaderGroups().map((hg) => (
            <Table.Tr key={hg.id}>
              {hg.headers.map((header) => {
                const spec = specs.find((s) => s.key === header.id)
                const sorted = header.column.getIsSorted()
                return (
                  /* Headers wrap onto several lines instead of stretching the table. */
                  <Table.Th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    style={{
                      cursor: spec?.sortable ? 'pointer' : 'default',
                      textAlign: 'center',
                      whiteSpace: 'normal',
                      verticalAlign: 'bottom',
                    }}
                  >
                    <Group gap={4} justify="center" wrap="nowrap" align="flex-end">
                      <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                      {sorted === 'asc' && <IconArrowUp size={13} />}
                      {sorted === 'desc' && <IconArrowDown size={13} />}
                    </Group>
                  </Table.Th>
                )
              })}
            </Table.Tr>
          ))}
        </Table.Thead>
        {/*
          Rows stay Mantine's (striping and hover live on the row), but the CELLS
          are plain <td>: a month of hourly data is ~750 rows x 10 columns, and
          routing all ~7500 of those through Mantine's styles API is what made
          the table expensive to rebuild. `.hlv-cell` reuses Mantine's own
          spacing variables, so the padding is identical to Table.Td.
        */}
        <Table.Tbody>
          {visibleRows.map((row) => (
            <Table.Tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={
                    numericKeys.has(cell.column.id) ? 'hlv-cell hlv-cell-num' : 'hlv-cell'
                  }
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </Table.Tr>
          ))}
          {/* Absorbs the slack so the totals row sits at the bottom of the pane
              even when only a handful of rows came back. Collapses to nothing
              once the rows overflow. */}
          {hasSummary && <Table.Tr className="hlv-table-filler" aria-hidden><td colSpan={specs.length} /></Table.Tr>}
        </Table.Tbody>
        {hasSummary && rows.length > 0 && (
          /* Totals stay pinned to the bottom of the viewport while rows scroll. */
          <Table.Tfoot ref={tfootRef}>
            <Table.Tr>
              {specs.map((spec, i) => {
                const isNum = numericKeys.has(spec.key)
                return (
                  <Table.Td
                    key={spec.key}
                    style={{
                      textAlign: 'center',
                      ...(isNum ? numericStyle : {}),
                      position: 'sticky',
                      bottom: 0,
                      zIndex: 2,
                      background: 'var(--hlv-surface-2)',
                      borderTop: '1px solid var(--hlv-border)',
                    }}
                  >
                    {i === 0 ? (
                      <Text fw={700} size="sm">
                        {t('summaryRow')}
                      </Text>
                    ) : summary[spec.key] ? (
                      <AggregateCell
                        value={summary[spec.key].text}
                        how={summary[spec.key].how}
                        onPick={(how) => pickAggregate(spec.key, how)}
                        t={t}
                      />
                    ) : null}
                  </Table.Td>
                )
              })}
            </Table.Tr>
          </Table.Tfoot>
        )}
      </Table>
      {rows.length === 0 && (
        <Box py="xl" ta="center">
          <Text c="dimmed">{t('noData')}</Text>
        </Box>
      )}
    </ScrollArea>
  )
})
