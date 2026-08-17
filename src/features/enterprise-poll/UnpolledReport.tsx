import { useMemo } from 'react'
import {
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
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
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react'
import { CheckboxFilter } from '@/components/CheckboxFilter'
import { TablePagination } from '@/components/TablePagination'
import { useStickyRowHeights } from '@/components/useMeasuredHeight'
import { currentDevice, enterpriseLabel, type EnterpriseMappingRow } from '@/api/enterprise'
import { useLanguage } from '@/locales/LanguageContext'
import { numericStyle } from '@/theme/theme'
import type { UnpolledFilters } from './unpolledFilters'

export interface UnpolledReportProps {
  rows: EnterpriseMappingRow[]
  /** Held by the page: hiding the report unmounts this component. */
  filters: UnpolledFilters
  onFiltersChange: (next: UnpolledFilters) => void
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
  /** Exports exactly what the filters left on screen, not the whole result. */
  onExport: (rows: EnterpriseMappingRow[]) => void
  /** Run the check again over the same branch. */
  onRefresh: () => void
}

/** A switched-off enterprise is *expected* to be silent; a live one is not. */
const isActionable = (m: EnterpriseMappingRow) => m.enabled !== false

/**
 * One headline number with its label. Not a chart: three counts and a
 * denominator are read exactly, and a bar chart of three bars would say less
 * than the digits do.
 */
function Stat({
  label,
  value,
  of,
  color,
}: {
  label: string
  value: number
  of?: string
  color?: string
}) {
  return (
    <Paper radius="md" withBorder p="md">
      <Text size="10px" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: 0.6 }}>
        {label}
      </Text>
      <Group align="baseline" gap={6} mt={4} wrap="nowrap">
        <Text fz={30} fw={700} lh={1.05} c={color} style={numericStyle}>
          {value}
        </Text>
        {of && (
          <Text size="xs" c="dimmed">
            {of}
          </Text>
        )}
      </Group>
    </Paper>
  )
}

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
  filters,
  onFiltersChange,
  checked,
  from,
  to,
  branchName,
  lineLabel,
  correctorName,
  onSelect,
  onClose,
  onExport,
  onRefresh,
}: UnpolledReportProps) {
  const { t, getLocale } = useLanguage()
  // The window is built from ISO days; show it the way the pickers do.
  const day = (v: string) => {
    const d = new Date(v)
    return isNaN(d.getTime()) ? v : d.toLocaleDateString(getLocale())
  }
  const { mode, search, status, page, pageSize } = filters
  const set = (patch: Partial<UnpolledFilters>) => onFiltersChange({ ...filters, ...patch })
  // No totals row here, so only the sticky header needs measuring.
  const { containerRef, theadRef, theadHeight } = useStickyRowHeights()

  const modelOf = useMemo(
    () => (m: EnterpriseMappingRow) => correctorName(m) || t('unknownCorrector'),
    [correctorName, t],
  )

  /**
   * Several models at once: a fault usually belongs to a family of correctors,
   * not to exactly one of them.
   *
   * Models that a re-run no longer reports are dropped here rather than left to
   * filter the whole report down to nothing — an empty table under a filter for
   * a model that is no longer in the result reads as "everybody answered".
   */
  const correctors = useMemo(() => {
    const available = new Set(rows.map(modelOf))
    return filters.correctors.filter((c) => available.has(c))
  }, [filters.correctors, rows, modelOf])

  /**
   * The filtered set, and the single source every part of the report reads:
   * the list, the summary and the Excel export. A filter that visibly narrows
   * one of them while another quietly keeps the full set is a trap.
   */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const match = (m: EnterpriseMappingRow) => {
      if (status === 'on' && !isActionable(m)) return false
      if (status === 'off' && isActionable(m)) return false
      // No selection means no restriction, exactly as an empty search does.
      if (correctors.length && !correctors.includes(modelOf(m))) return false
      return (
        !q ||
        enterpriseLabel(m).toLowerCase().includes(q) ||
        (m.devices ?? []).some((d) => String(d.ser_num).includes(q)) ||
        (lineLabel(m) ?? '').toLowerCase().includes(q) ||
        branchName(m.branch_id).toLowerCase().includes(q)
      )
    }
    // Enabled-but-silent first: those are the ones somebody has to act on.
    // Everything else keeps a stable branch → name order.
    return rows.filter(match).sort((a, b) => {
      if (isActionable(a) !== isActionable(b)) return isActionable(a) ? -1 : 1
      const byBranch = branchName(a.branch_id).localeCompare(branchName(b.branch_id))
      return byBranch || enterpriseLabel(a).localeCompare(enterpriseLabel(b))
    })
  }, [rows, search, status, correctors, modelOf, lineLabel, branchName])

  /** The page now survives leaving the report, so it can outlive the rows it
   *  pointed into — a re-run that comes back shorter would otherwise open on a
   *  page past the end and show an empty table. */
  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)))
  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  )
  const actionable = filtered.filter(isActionable).length
  const isFiltered = filtered.length !== rows.length
  /** Whether anything is set, as opposed to whether anything was cut out:
   *  ticking every corrector model narrows nothing, and the button that clears
   *  the ticks has to stay reachable. */
  const hasFilters = status !== null || correctors.length > 0 || search.trim() !== ''
  /** Colour of the headline badge comes from the WHOLE check, not the filtered
   *  slice: teal means the branch answered, and filtering down to the switched
   *  off ones must not turn a branch with faults green. */
  const allClear = rows.every((m) => !isActionable(m))

  /**
   * Silent enterprises grouped by corrector model, split by whether they are
   * switched on. A whole model going quiet points at the model — a firmware or
   * a channel-addressing problem — where a scatter of names does not.
   */
  const byCorrector = useMemo(() => {
    const map = new Map<string, { name: string; on: number; off: number }>()
    for (const m of filtered) {
      const name = modelOf(m)
      const e = map.get(name) ?? { name, on: 0, off: 0 }
      if (isActionable(m)) e.on += 1
      else e.off += 1
      map.set(name, e)
    }
    return [...map.values()].sort((a, b) => b.on + b.off - (a.on + a.off) || a.name.localeCompare(b.name))
  }, [filtered, modelOf])

  /** Filter options carry their own counts — over the WHOLE result, so the
   *  numbers do not shift as you narrow, which would make them unreadable. */
  const statusOptions = useMemo(() => {
    const on = rows.filter(isActionable).length
    return [
      { value: 'on', label: `${t('unpolledOn')} (${on})` },
      { value: 'off', label: `${t('unpolledOff')} (${rows.length - on})` },
    ]
  }, [rows, t])

  const correctorOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of rows) counts.set(modelOf(m), (counts.get(modelOf(m)) ?? 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, n]) => ({ value: name, label: name, count: n }))
  }, [rows, modelOf])

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
            something is silent, teal when the whole branch answered. Under a
            filter it counts what is on screen, with the full result after the
            slash — otherwise the number would contradict the rows below it. */}
        <Badge size="sm" variant="light" color={allClear ? 'teal' : 'amber'}>
          {isFiltered ? `${filtered.length} / ${rows.length}` : rows.length}
        </Badge>
        <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
          {day(from)} — {day(to)} · {t('unpolledChecked')}: {checked}
        </Text>
        <Button
          size="xs"
          variant="default"
          leftSection={<IconRefresh size={15} />}
          onClick={onRefresh}
          ml="auto"
        >
          {t('refresh')}
        </Button>
        <Button
          size="xs"
          variant="light"
          color="teal"
          leftSection={<IconFileSpreadsheet size={15} />}
          onClick={() => onExport(filtered)}
          disabled={filtered.length === 0}
        >
          {t('excel')}
        </Button>
      </Group>

      {/* Filters get their own row rather than competing with the title for
          space — nine controls on one line wrapped the Excel button onto a
          line of its own, which read as a mistake. */}
      {rows.length > 0 && (
        <Group
          px="sm"
          py={6}
          gap="xs"
          wrap="wrap"
          style={{ borderBottom: '1px solid var(--hlv-border)', flexShrink: 0 }}
        >
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(v) => set({ mode: v as 'list' | 'summary' })}
            data={[
              { value: 'list', label: t('unpolledByName') },
              { value: 'summary', label: t('unpolledSummary') },
            ]}
          />
          <Select
            placeholder={t('status')}
            data={statusOptions}
            value={status}
            onChange={(v) => set({ status: v, page: 1 })}
            clearable
            size="xs"
            w={175}
          />
          <CheckboxFilter
            label={t('correctorType')}
            options={correctorOptions}
            value={correctors}
            onChange={(v) => set({ correctors: v, page: 1 })}
            searchPlaceholder={t('searchCorrector')}
          />
          {/* Free-text search is only meaningful against the named rows. */}
          {mode === 'list' && (
            <TextInput
              placeholder={t('searchEnterprise')}
              leftSection={<IconSearch size={14} />}
              value={search}
              onChange={(e) => set({ search: e.currentTarget.value, page: 1 })}
              size="xs"
              w={220}
            />
          )}
          {hasFilters && (
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              onClick={() => set({ status: null, correctors: [], search: '', page: 1 })}
            >
              {t('resetFilters')}
            </Button>
          )}
        </Group>
      )}

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
      ) : mode === 'summary' ? (
        <ScrollArea className="hlv-table-scroll" type="auto" style={{ flex: 1 }}>
          <Box p="md">
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
              <Stat
                label={t('unpolledTotal')}
                value={filtered.length}
                of={`${t('unpolledOutOf')} ${isFiltered ? rows.length : checked}`}
                color={allClear ? 'teal.5' : 'amber.5'}
              />
              {/* The split that decides what to do: a live corrector that went
                  quiet is a fault, a switched-off one is a setting. */}
              <Stat label={t('unpolledOn')} value={actionable} color="amber.5" />
              <Stat label={t('unpolledOff')} value={filtered.length - actionable} />
            </SimpleGrid>

            <Text size="10px" fw={700} tt="uppercase" c="petrol" mt="lg" mb={6} style={{ letterSpacing: 0.6 }}>
              {t('unpolledByCorrector')}
            </Text>
            <Paper radius="md" withBorder style={{ overflow: 'hidden' }}>
              <Table striped highlightOnHover verticalSpacing={6}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('correctorType')}</Table.Th>
                    <Table.Th ta="center" w={140}>
                      {t('unpolledOn')}
                    </Table.Th>
                    <Table.Th ta="center" w={140}>
                      {t('unpolledOff')}
                    </Table.Th>
                    <Table.Th ta="center" w={110}>
                      {t('total')}
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {byCorrector.map((c) => (
                    <Table.Tr key={c.name}>
                      <td className="hlv-cell" style={{ textAlign: 'left' }}>
                        {c.name}
                      </td>
                      {/* A zero is not a finding — dimmed, so the counts that
                          matter are the ones the eye lands on. */}
                      <td className="hlv-cell hlv-cell-num">
                        <Text span size="sm" fw={c.on ? 700 : 400} c={c.on ? 'amber.5' : 'dimmed'}>
                          {c.on}
                        </Text>
                      </td>
                      <td className="hlv-cell hlv-cell-num">
                        <Text span size="sm" c={c.off ? undefined : 'dimmed'}>
                          {c.off}
                        </Text>
                      </td>
                      <td className="hlv-cell hlv-cell-num">
                        <Text span size="sm" fw={600}>
                          {c.on + c.off}
                        </Text>
                      </td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
                <Table.Tfoot style={{ background: 'var(--hlv-surface-2)' }}>
                  <Table.Tr>
                    <Table.Td fw={700}>{t('total')}</Table.Td>
                    <Table.Td ta="center" fw={700} style={numericStyle}>
                      {actionable}
                    </Table.Td>
                    <Table.Td ta="center" fw={700} style={numericStyle}>
                      {filtered.length - actionable}
                    </Table.Td>
                    <Table.Td ta="center" fw={700} style={numericStyle}>
                      {filtered.length}
                    </Table.Td>
                  </Table.Tr>
                </Table.Tfoot>
              </Table>
            </Paper>
          </Box>
        </ScrollArea>
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
                        {/* The corrector fitted now — the one the poll asked. */}
                        <td className="hlv-cell hlv-cell-num">
                          {currentDevice(m)?.ser_num ?? '—'}
                        </td>
                        <td className="hlv-cell hlv-cell-num">
                          {currentDevice(m)?.ch_num ?? '—'}
                        </td>
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
                page={safePage}
                pageSize={pageSize}
                total={filtered.length}
                onPageChange={(p) => set({ page: p })}
                onPageSizeChange={(n) => set({ pageSize: n, page: 1 })}
                shownLabel={`${t('records')}: ${filtered.length}`}
              />
            </>
          )}
        </>
      )}
    </>
  )
}
