import { Group, Pagination, SegmentedControl, Text } from '@mantine/core'

export const PAGE_SIZES = [10, 50, 100]

export interface PageSizeOption {
  value: number
  label: string
}

interface Props {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  /** Optional "shown X / Y" label on the left. */
  shownLabel?: string
  /**
   * Page sizes to offer. Defaults to plain row counts; the archive passes
   * named spans instead ("доба" / "тиждень" / "місяць"), because there a page
   * is a stretch of time and 744 means nothing on its own.
   */
  pageSizes?: PageSizeOption[]
}

/** Shared page-size + page navigation bar for server-paginated tables. */
export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  shownLabel,
  pageSizes,
}: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const sizes = pageSizes ?? PAGE_SIZES.map((s) => ({ value: s, label: String(s) }))
  return (
    <Group justify="space-between" px="sm" py={6} wrap="nowrap">
      <Group gap="xs" wrap="nowrap">
        <SegmentedControl
          size="xs"
          value={String(pageSize)}
          onChange={(v) => {
            onPageSizeChange(Number(v))
            onPageChange(1)
          }}
          data={sizes.map((s) => ({ value: String(s.value), label: s.label }))}
        />
        <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
          {shownLabel ?? `${total.toLocaleString('uk-UA')}`}
        </Text>
      </Group>
      <Pagination
        size="sm"
        value={page}
        total={pages}
        onChange={onPageChange}
        siblings={1}
        withEdges
      />
    </Group>
  )
}
