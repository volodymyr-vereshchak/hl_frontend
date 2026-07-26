import { memo, useMemo, useState } from 'react'
import { Table, Text, Group, Box, ScrollArea } from '@mantine/core'
import { IconArrowUp, IconArrowDown } from '@tabler/icons-react'
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
import { getArchiveColumns, resolveEditName } from '@/domain/archiveColumns'
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
}

const pad = (n: number) => String(n).padStart(2, '0')

function fmtPeriod(period: string, type: ArchiveType): string {
  const d = new Date(period)
  if (isNaN(d.getTime())) return period
  const date = d.toLocaleDateString('uk-UA')
  if (type === 'hourly') return `${date} ${pad(d.getHours())}:00`
  // sys/edit events carry a real time-of-day — show seconds too.
  if (type === 'sys' || type === 'edit') {
    return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }
  return date
}

/** Two decimals everywhere; density keeps four, event counters are integers. */
function decimalsFor(key: string): number {
  if (key === 'density') return 4
  if (key === 'edit_counts' || key === 'sys_counts') return 0
  return 2
}

function fmtNumber(v: unknown, digits = 2): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!isFinite(n)) return String(v)
  return n.toLocaleString('uk-UA', { minimumFractionDigits: digits, maximumFractionDigits: digits })
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
      pressureUnit: meta.pressure_unit || 'кгс/см²',
      dpUnit: meta.dp_unit || 'кгс/м²',
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

  // Summary row: sum summable, avg averagable.
  const summary = useMemo(() => {
    const out: Record<string, string> = {}
    for (const spec of specs) {
      const digits = decimalsFor(spec.key)
      if (spec.isSummable) {
        const sum = rows.reduce((s, r) => s + (Number(r[spec.key]) || 0), 0)
        out[spec.key] = fmtNumber(sum, digits)
      } else if (spec.isAveragable && rows.length) {
        const vals = rows.map((r) => Number(r[spec.key])).filter((n) => isFinite(n))
        out[spec.key] = vals.length
          ? fmtNumber(vals.reduce((a, b) => a + b, 0) / vals.length, digits)
          : '—'
      }
    }
    return out
  }, [rows, specs])

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
          {table.getRowModel().rows.map((row) => (
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
                        {t('total')}
                      </Text>
                    ) : (
                      <Text fw={700} size="sm">
                        {summary[spec.key] ?? ''}
                      </Text>
                    )}
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
