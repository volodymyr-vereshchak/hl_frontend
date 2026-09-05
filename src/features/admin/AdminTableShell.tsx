import type { ReactNode } from 'react'
import { Box, Center, Divider, Group, ScrollArea, Stack, Text } from '@mantine/core'
import { TablePagination, type PageSizeOption } from '@/components/TablePagination'

/**
 * The frame every admin tab draws around its table.
 *
 * Eleven files rebuilt the same title block and seven the same scrolling
 * table area, which is how the empty state ended up saying «Немає записів» in
 * three tabs and «Нічого не знайдено» in three others — the same situation,
 * two answers, depending on which tab you were looking at.
 *
 * Deliberately NOT part of CrudTable: the tabs that need a member list or a
 * cascade of selects cannot use CrudTable's field spec, but they want this
 * frame just the same, and having to take the whole component to get the
 * frame is what made them rebuild it.
 */

export function AdminTabHeader({
  title,
  description,
  actions,
  align,
}: {
  title: string
  description?: ReactNode
  /** Search box, refresh, «Додати» — whatever this tab acts with. */
  actions?: ReactNode
  /**
   * `flex-start` pins the actions to the top when the description runs to two
   * lines; the default centres them against a one-line description. Kept as a
   * prop rather than normalised away, because both readings are deliberate.
   */
  align?: 'center' | 'flex-start'
}) {
  return (
    <Group justify="space-between" wrap="wrap" gap="sm" align={align}>
      <Box>
        <Text fw={600} fz="lg" ff="'Space Grotesk Variable', sans-serif">
          {title}
        </Text>
        {description && (
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        )}
      </Box>
      {actions && <Group gap="xs">{actions}</Group>}
    </Group>
  )
}

export interface AdminTableShellProps {
  /** The `<Table>` itself. */
  children: ReactNode
  /** True when the table has no rows to show — draws the empty state instead. */
  empty?: boolean
  /** Overrides the default wording, for a tab where "not found" is the truth. */
  emptyLabel?: string
  /** Omit to hide pagination entirely (a tab that always fits on one page). */
  pagination?: {
    page: number
    pageSize: number
    total: number
    onPageChange: (page: number) => void
    onPageSizeChange: (size: number) => void
    pageSizeOptions?: PageSizeOption[]
    shownLabel?: string
  }
}

export function AdminTableShell({
  children,
  empty,
  emptyLabel = 'Немає записів',
  pagination,
}: AdminTableShellProps) {
  return (
    <Box style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <ScrollArea className="hlv-table-scroll" style={{ flex: 1 }} type="auto">
        {children}
        {/* Below the table, not instead of it: the header stays visible, so an
            empty result still shows what was being looked for. */}
        {empty && (
          <Center py="xl">
            <Text c="dimmed" size="sm">
              {emptyLabel}
            </Text>
          </Center>
        )}
      </ScrollArea>
      {pagination && pagination.total > pagination.pageSize && (
        <>
          <Divider />
          <TablePagination {...pagination} />
        </>
      )}
    </Box>
  )
}

/** Title, then the framed table. The shape nine of the ten tabs are. */
export function AdminTablePage({
  title,
  description,
  actions,
  alert,
  children,
  ...shell
}: AdminTableShellProps & {
  title: string
  description?: ReactNode
  actions?: ReactNode
  /** An error or notice rendered between the header and the table. */
  alert?: ReactNode
}) {
  return (
    <Stack gap="sm" style={{ height: '100%' }}>
      <AdminTabHeader title={title} description={description} actions={actions} />
      {alert}
      <AdminTableShell {...shell}>{children}</AdminTableShell>
    </Stack>
  )
}
