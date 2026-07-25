import { useMemo, useState } from 'react'
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
}

function fmtPeriod(period: string, hourly: boolean): string {
  const d = new Date(period)
  if (isNaN(d.getTime())) return period
  const date = d.toLocaleDateString('uk-UA')
  return hourly ? `${date} ${String(d.getHours()).padStart(2, '0')}:00` : date
}

function fmtNumber(v: unknown): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!isFinite(n)) return String(v)
  return n.toLocaleString('uk-UA', { maximumFractionDigits: 3 })
}

const helper = createColumnHelper<ArchiveRow>()

export function ArchiveTable({ rows, type, meta }: Props) {
  const { t } = useLanguage()
  const [sorting, setSorting] = useState<SortingState>([])

  const specs = useMemo(
    () =>
      getArchiveColumns({
        archiveType: type,
        isVirtualLine: meta.kind === 'virtual',
        isDpdLine: meta.kind === 'dpd',
        lineUnits: meta,
        showOutputPressure: meta.kind === 'physical' && !meta.is_high_pressure && !meta.meter,
        pressureUnit: meta.pressure_unit || 'кгс/см²',
        dpUnit: meta.dp_unit || 'кгс/м²',
        t,
      }),
    [type, meta, t],
  )

  const columns = useMemo(
    () =>
      specs.map((spec) =>
        helper.accessor((row) => row[spec.key], {
          id: spec.key,
          header: spec.label,
          enableSorting: spec.sortable,
          cell: (info) => {
            const raw = info.getValue()
            if (spec.key === 'period') return fmtPeriod(String(raw), type === 'hourly')
            if (type === 'edit' && spec.key === 'edit_name') {
              return resolveEditName(String(raw ?? ''), info.row.original.old_value, info.row.original.new_value)
            }
            if (type === 'edit' && (spec.key === 'old_value' || spec.key === 'new_value')) {
              return formatEditValue(raw == null ? null : Number(raw))
            }
            if (spec.key === 'sys_name' || spec.key === 'edit_name') return String(raw ?? '—')
            return fmtNumber(raw)
          },
        }),
      ),
    [specs, type],
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
      if (spec.isSummable) {
        const sum = rows.reduce((s, r) => s + (Number(r[spec.key]) || 0), 0)
        out[spec.key] = fmtNumber(sum)
      } else if (spec.isAveragable && rows.length) {
        const vals = rows.map((r) => Number(r[spec.key])).filter((n) => isFinite(n))
        out[spec.key] = vals.length ? fmtNumber(vals.reduce((a, b) => a + b, 0) / vals.length) : '—'
      }
    }
    return out
  }, [rows, specs])

  const numericKeys = new Set(specs.filter((s) => s.key !== 'period' && s.key !== 'edit_name' && s.key !== 'sys_name').map((s) => s.key))
  const hasSummary = specs.some((s) => s.isSummable || s.isAveragable)

  return (
    <ScrollArea type="auto">
      <Table striped highlightOnHover stickyHeader withTableBorder verticalSpacing={6}>
        <Table.Thead>
          {table.getHeaderGroups().map((hg) => (
            <Table.Tr key={hg.id}>
              {hg.headers.map((header) => {
                const spec = specs.find((s) => s.key === header.id)
                const sorted = header.column.getIsSorted()
                const isNum = numericKeys.has(header.id)
                return (
                  <Table.Th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    style={{
                      cursor: spec?.sortable ? 'pointer' : 'default',
                      textAlign: isNum ? 'right' : 'left',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <Group gap={4} justify={isNum ? 'flex-end' : 'flex-start'} wrap="nowrap">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sorted === 'asc' && <IconArrowUp size={13} />}
                      {sorted === 'desc' && <IconArrowDown size={13} />}
                    </Group>
                  </Table.Th>
                )
              })}
            </Table.Tr>
          ))}
        </Table.Thead>
        <Table.Tbody>
          {table.getRowModel().rows.map((row) => (
            <Table.Tr key={row.id}>
              {row.getVisibleCells().map((cell) => {
                const isNum = numericKeys.has(cell.column.id)
                return (
                  <Table.Td
                    key={cell.id}
                    style={{ textAlign: isNum ? 'right' : 'left', ...(isNum ? numericStyle : {}) }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </Table.Td>
                )
              })}
            </Table.Tr>
          ))}
        </Table.Tbody>
        {hasSummary && rows.length > 0 && (
          <Table.Tfoot>
            <Table.Tr>
              {specs.map((spec, i) => {
                const isNum = numericKeys.has(spec.key)
                return (
                  <Table.Td key={spec.key} style={{ textAlign: isNum ? 'right' : 'left', ...(isNum ? numericStyle : {}) }}>
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
}
