import { Badge, Group, ScrollArea, Table, Text } from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import type { FhpVolumeBlock } from '@/api/fhpReport'
import { AggregateCell } from '@/components/AggregateCell'
import { useStickyRowHeights } from '@/components/useMeasuredHeight'
import { fold, type Aggregate } from '@/domain/aggregate'
import { formatDelta, formatFhp, formatPeriod } from '@/domain/fhpParams'
import { numericStyle } from '@/theme/theme'

interface Props {
  block: FhpVolumeBlock
  granularity: 'hourly' | 'daily'
  page: number
  pageSize: number
  t: (key: string) => string
}

/**
 * What each line's volume would have been on the reference gas composition.
 *
 * ΔV = V_еталонний − V_звітний, so a negative number means the reported volume
 * was overstated. The backend computes it hour by hour and only then sums —
 * the correction is non-linear in the composition and an hour with no flow
 * contributes nothing however wrong its ФХП was.
 */
export function FhpVolumeTable({ block, granularity, page, pageSize, t }: Props) {
  const { containerRef, theadRef, tfootRef, theadHeight, tfootHeight } =
    useStickyRowHeights()

  // Volumes add up, so unlike the composition columns these default to a sum.
  const [agg, setAgg] = useLocalStorage<Record<string, Aggregate>>({
    key: 'hlv-fhp-volume-agg-cols',
    defaultValue: {},
  })
  const aggOf = (role: string): Aggregate =>
    agg[role] ?? (role === 'pct' ? 'avg' : 'sum')
  const pick = (role: string, how: Aggregate) => setAgg({ ...agg, [role]: how })
  const foldCol = (values: (number | null)[], role: string) =>
    fold(
      values.filter((v): v is number => v != null && Number.isFinite(v)),
      aggOf(role),
    )

  const slice = block.periods
    .map((period, i) => ({ period, i }))
    .slice((page - 1) * pageSize, page * pageSize)

  return (
    <ScrollArea
      ref={containerRef}
      className="hlv-table-scroll"
      style={
        {
          flex: 1,
          minHeight: 0,
          '--hlv-thead-h': `${theadHeight}px`,
          '--hlv-tfoot-h': `${tfootHeight}px`,
        } as React.CSSProperties
      }
      type="auto"
    >
      <Table striped highlightOnHover stickyHeader verticalSpacing={5}>
        <Table.Thead ref={theadRef}>
          <Table.Tr>
            <Table.Th rowSpan={2} style={{ textAlign: 'center' }}>
              Період
            </Table.Th>
            {block.lines.map((line) => (
              <Table.Th key={line.line_id} colSpan={3} style={{ textAlign: 'center' }}>
                <Group gap={6} justify="center" wrap="nowrap">
                  <span>{line.line_name}</span>
                  <Badge size="xs" variant="light" color={line.is_meter ? 'grape' : 'gray'}>
                    {line.is_meter ? 'лічильник' : 'діафрагма'}
                  </Badge>
                </Group>
              </Table.Th>
            ))}
          </Table.Tr>
          <Table.Tr>
            {block.lines.flatMap((line) => [
              <Table.Th key={`${line.line_id}-v`} style={{ textAlign: 'center' }}>
                Об'єм, {block.unit}
              </Table.Th>,
              <Table.Th key={`${line.line_id}-d`} style={{ textAlign: 'center' }}>
                ΔV, {block.unit}
              </Table.Th>,
              <Table.Th key={`${line.line_id}-p`} style={{ textAlign: 'center' }}>
                ΔV%
              </Table.Th>,
            ])}
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          {slice.map(({ period, i }) => (
            <Table.Tr key={period}>
              <Table.Td ta="center" style={{ ...numericStyle, whiteSpace: 'nowrap' }}>
                {formatPeriod(period, granularity)}
              </Table.Td>
              {block.lines.flatMap((line) => {
                const delta = line.delta[i] ?? null
                return [
                  <Table.Td key={`${line.line_id}-v`} ta="center" style={numericStyle}>
                    {formatFhp(line.volume[i] ?? null, 1)}
                  </Table.Td>,
                  <Table.Td
                    key={`${line.line_id}-d`}
                    ta="center"
                    style={numericStyle}
                    c={delta == null || delta === 0 ? undefined : delta < 0 ? 'red' : 'teal'}
                  >
                    {formatDelta(delta, 1)}
                  </Table.Td>,
                  <Table.Td
                    key={`${line.line_id}-p`}
                    ta="center"
                    style={numericStyle}
                    c="dimmed"
                  >
                    {formatDelta(line.delta_pct[i] ?? null, 3)}
                  </Table.Td>,
                ]
              })}
            </Table.Tr>
          ))}
        </Table.Tbody>

        {block.periods.length > 0 && (
          <Table.Tfoot ref={tfootRef}>
            <Table.Tr>
              <FootCell first>{t('summaryRow')}</FootCell>
              {block.lines.flatMap((line) => [
                <FootCell key={`${line.line_id}-v`}>
                  <AggregateCell
                    value={formatFhp(foldCol(line.volume, 'vol'), 1)}
                    how={aggOf('vol')}
                    onPick={(how) => pick('vol', how)}
                    t={t}
                  />
                </FootCell>,
                <FootCell key={`${line.line_id}-d`}>
                  <AggregateCell
                    value={formatDelta(foldCol(line.delta, 'delta'), 1)}
                    how={aggOf('delta')}
                    onPick={(how) => pick('delta', how)}
                    t={t}
                  />
                </FootCell>,
                <FootCell key={`${line.line_id}-p`}>
                  <AggregateCell
                    value={formatDelta(foldCol(line.delta_pct, 'pct'), 3)}
                    how={aggOf('pct')}
                    onPick={(how) => pick('pct', how)}
                    t={t}
                  />
                </FootCell>,
              ])}
            </Table.Tr>
          </Table.Tfoot>
        )}
      </Table>
    </ScrollArea>
  )
}

function FootCell({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <Table.Td
      style={{
        textAlign: 'center',
        ...numericStyle,
        position: 'sticky',
        bottom: 0,
        zIndex: 2,
        background: 'var(--hlv-surface-2)',
        borderTop: '1px solid var(--hlv-border)',
        whiteSpace: 'nowrap',
      }}
    >
      {first ? (
        <Text fw={700} size="sm">
          {children}
        </Text>
      ) : (
        children
      )}
    </Table.Td>
  )
}
