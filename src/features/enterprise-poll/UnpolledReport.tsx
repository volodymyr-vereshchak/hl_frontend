import { useMemo, useState } from 'react'
import {
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core'
import {
  IconArrowLeft,
  IconChevronRight,
  IconCircleCheck,
  IconFileSpreadsheet,
  IconSearch,
} from '@tabler/icons-react'
import { TablePagination } from '@/components/TablePagination'
import { useStickyRowHeights } from '@/components/useMeasuredHeight'
import { enterpriseLabel, type EnterpriseMappingRow } from '@/api/enterprise'
import { useLanguage } from '@/locales/LanguageContext'

export interface UnpolledReportProps {
  rows: EnterpriseMappingRow[]
  /** How many active enterprises the check covered — the denominator. */
  checked: number
  /** Window the check looked at, as display strings. */
  from: string
  to: string
  branchName: (id: number | null | undefined) => string
  lineLabel: (row: EnterpriseMappingRow) => string | null
  correctorName: (row: EnterpriseMappingRow) => string
  onSelect: (id: number) => void
  onClose: () => void
  onExport: () => void
}

/** A switched-off enterprise is *expected* to be silent; a live one is not. */
const isActionable = (m: EnterpriseMappingRow) => m.enabled !== false

/**
 * Result of the "no poll" check, rendered in the pane the poll results use.
 *
 * It was a modal, which fought the screen it opened over: the list can run to
 * hundreds of rows, a modal caps them at 60vh with no search and no paging, and
 * it covered the very tree a row click is supposed to move the selection in.
 * As a pane it reuses the archive idiom — toolbar strip, sticky-header table,
 * pagination — so it reads as part of the app rather than an interruption.
 */
export function UnpolledReport({
  rows,
  checked,
  from,
  to,
  branchName,
  lineLabel,
  correctorName,
  onSelect,
  onClose,
  onExport,
}: UnpolledReportProps) {
  const { t, getLocale } = useLanguage()
  // The window is built from ISO days; show it the way the pickers do.
  const day = (v: string) => {
    const d = new Date(v)
    return isNaN(d.getTime()) ? v : d.toLocaleDateString(getLocale())
  }
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  // No totals row here, so only the sticky header needs measuring.
  const { containerRef, theadRef, theadHeight } = useStickyRowHeights()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const match = (m: EnterpriseMappingRow) =>
      !q ||
      enterpriseLabel(m).toLowerCase().includes(q) ||
      String(m.ser_num ?? '').includes(q) ||
      (lineLabel(m) ?? '').toLowerCase().includes(q) ||
      branchName(m.branch_id).toLowerCase().includes(q)
    // Enabled-but-silent first: those are the ones somebody has to act on.
    // Everything else keeps a stable branch → name order.
    return rows.filter(match).sort((a, b) => {
      if (isActionable(a) !== isActionable(b)) return isActionable(a) ? -1 : 1
      const byBranch = branchName(a.branch_id).localeCompare(branchName(b.branch_id))
      return byBranch || enterpriseLabel(a).localeCompare(enterpriseLabel(b))
    })
  }, [rows, search, lineLabel, branchName])

  const pageRows = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  )
  const actionable = rows.filter(isActionable).length

  return (
    <>
      <Group
        px="sm"
        py={6}
        gap="sm"
        wrap="wrap"
        style={{ borderBottom: '1px solid var(--hlv-border)', flexShrink: 0 }}
      >
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          leftSection={<IconArrowLeft size={14} />}
          onClick={onClose}
        >
          {t('back')}
        </Button>
        <Text fw={600} size="sm" ff="'Space Grotesk Variable', sans-serif">
          {t('unpolledEnterprises')}
        </Text>
        {/* The count is the headline, so it carries the colour: amber while
            something is silent, teal when the whole branch answered. */}
        <Badge size="sm" variant="light" color={actionable > 0 ? 'amber' : 'teal'}>
          {rows.length}
        </Badge>
        <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
          {day(from)} — {day(to)} · {t('unpolledChecked')}: {checked}
        </Text>
        <TextInput
          placeholder={t('searchEnterprise')}
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value)
            setPage(1)
          }}
          size="xs"
          w={220}
          ml="auto"
        />
        <Button
          size="xs"
          variant="light"
          color="teal"
          leftSection={<IconFileSpreadsheet size={15} />}
          onClick={onExport}
          disabled={rows.length === 0}
        >
          {t('excel')}
        </Button>
      </Group>

      {rows.length === 0 ? (
        <Center style={{ flex: 1 }}>
          <Stack align="center" gap={8} c="teal">
            <IconCircleCheck size={44} stroke={1.2} />
            <Text size="sm" fw={600}>
              {t('unpolledNone')}
            </Text>
            <Text size="xs" c="dimmed">
              {t('unpolledChecked')}: {checked}
            </Text>
          </Stack>
        </Center>
      ) : (
        <>
          <Box style={{ flex: 1, minHeight: 0 }}>
            <ScrollArea
              ref={containerRef}
              className="hlv-table-scroll"
              type="auto"
              style={
                { height: '100%', '--hlv-thead-h': `${theadHeight}px` } as React.CSSProperties
              }
            >
              <Table striped highlightOnHover stickyHeader verticalSpacing={6}>
                <Table.Thead ref={theadRef}>
                  <Table.Tr>
                    <Table.Th>{t('branch')}</Table.Th>
                    <Table.Th>{t('enterprise')}</Table.Th>
                    <Table.Th>{t('correctorType')}</Table.Th>
                    <Table.Th ta="center">{t('correctorNumber')}</Table.Th>
                    <Table.Th ta="center">{t('channelNumber')}</Table.Th>
                    <Table.Th>{t('lineName')}</Table.Th>
                    <Table.Th ta="center">{t('status')}</Table.Th>
                    <Table.Th w={28} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {pageRows.map((m) => {
                    const live = isActionable(m)
                    return (
                      <Table.Tr
                        key={m.id}
                        onClick={() => onSelect(m.id)}
                        style={{ cursor: 'pointer' }}
                        // A disabled enterprise is silent on purpose — dimmed so
                        // the rows that need attention stand out among them.
                        opacity={live ? 1 : 0.55}
                        title={t('unpolledRowHint')}
                      >
                        <td className="hlv-cell" style={{ textAlign: 'left' }}>
                          {branchName(m.branch_id)}
                        </td>
                        <td className="hlv-cell" style={{ textAlign: 'left', whiteSpace: 'normal' }}>
                          <Text size="sm" fw={live ? 600 : 400}>
                            {enterpriseLabel(m)}
                          </Text>
                        </td>
                        <td className="hlv-cell" style={{ textAlign: 'left' }}>
                          {correctorName(m) || '—'}
                        </td>
                        <td className="hlv-cell hlv-cell-num">{m.ser_num ?? '—'}</td>
                        <td className="hlv-cell hlv-cell-num">{m.ch_num ?? '—'}</td>
                        <td className="hlv-cell" style={{ textAlign: 'left' }}>
                          {lineLabel(m) ?? (
                            <Text span size="sm" c="amber.6">
                              {t('withoutLine')}
                            </Text>
                          )}
                        </td>
                        <td className="hlv-cell">
                          <Badge size="xs" variant="light" color={live ? 'amber' : 'gray'}>
                            {live ? t('statusEnabled') : t('statusDisabled')}
                          </Badge>
                        </td>
                        <td className="hlv-cell" style={{ paddingLeft: 0, paddingRight: 6 }}>
                          <IconChevronRight size={13} color="var(--mantine-color-steel-6)" />
                        </td>
                      </Table.Tr>
                    )
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Box>
          {filtered.length > pageSize && (
            <>
              <Divider />
              <TablePagination
                page={page}
                pageSize={pageSize}
                total={filtered.length}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                shownLabel={`${t('records')}: ${filtered.length}`}
              />
            </>
          )}
        </>
      )}
    </>
  )
}
