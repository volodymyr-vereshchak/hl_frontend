import { useEffect, useState } from 'react'
import { Group, Pagination, SegmentedControl, Text, TextInput } from '@mantine/core'

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
      <Group gap="xs" wrap="nowrap">
        {pages > 1 && <PageJump page={page} pages={pages} onPageChange={onPageChange} />}
        <Pagination
          size="sm"
          value={page}
          total={pages}
          onChange={onPageChange}
          siblings={1}
          withEdges
        />
      </Group>
    </Group>
  )
}

/**
 * Typing a page number, for the tables long enough that clicking through them
 * is not an option.
 *
 * The value is held locally and committed on Enter or blur rather than on each
 * keystroke: these tables are server-paginated, and "12" typed one character
 * at a time would fetch page 1 before page 12.
 */
function PageJump({
  page,
  pages,
  onPageChange,
}: {
  page: number
  pages: number
  onPageChange: (page: number) => void
}) {
  const [draft, setDraft] = useState(String(page))

  // Follow the arrows: the box must show where the table actually is.
  useEffect(() => setDraft(String(page)), [page])

  const commit = () => {
    const parsed = Number.parseInt(draft, 10)
    if (Number.isNaN(parsed)) {
      setDraft(String(page))
      return
    }
    const next = Math.min(pages, Math.max(1, parsed))
    setDraft(String(next))
    if (next !== page) onPageChange(next)
  }

  return (
    <Group gap={4} wrap="nowrap">
      <TextInput
        size="xs"
        w={56}
        inputMode="numeric"
        aria-label="Номер сторінки"
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value.replace(/[^\d]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(String(page))
        }}
        styles={{ input: { textAlign: 'center' } }}
      />
      <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
        / {pages}
      </Text>
    </Group>
  )
}
