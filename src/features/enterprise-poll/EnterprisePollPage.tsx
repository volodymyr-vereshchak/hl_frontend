import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Stack,
  Group,
  Title,
  Select,
  SegmentedControl,
  Button,
  Menu,
  Tabs,
  Paper,
  Text,
  Table,
  Alert,
  Badge,
  Collapse,
  UnstyledButton,
  Box,
  ScrollArea,
  TextInput,
  Loader,
  Center,
  ActionIcon,
  Tooltip,
} from '@mantine/core'
import { PeriodPicker } from '@/features/archive/PeriodPicker'
import {
  IconAlertTriangle,
  IconBroadcast,
  IconBuildingCommunity,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconChevronsDown,
  IconChevronsUp,
  IconClockHour4,
  IconDatabase,
  IconRipple,
  IconFileSpreadsheet,
  IconPlayerPlay,
  IconPlugConnectedX,
  IconSearch,
  IconPhone,
  IconPlayerStop,
} from '@tabler/icons-react'
import { useLocalStorage } from '@mantine/hooks'
import { useQuery } from '@tanstack/react-query'
import { AggregateCell } from '@/components/AggregateCell'
import { TablePagination, type PageSizeOption } from '@/components/TablePagination'
import { columnAggregate, fold, type Aggregate } from '@/domain/aggregate'
import { DEFAULT_PERIOD_PAGE_SIZE, PERIOD_PAGE_SIZES } from '@/domain/periodPaging'
import { branchAdminApi, dpdLineAdminApi, lineAdminApi } from '@/api/admin'
import {
  enterpriseApi,
  correctorLabel,
  currentDevice,
  enterpriseLabel,
  streamEnterprisePoll,
  type PollStored,
  streamEnterpriseVolumes,
  type EnterpriseMappingRow,
  type EnterpriseRecord,
  type EventGroup,
} from '@/api/enterprise'
import { PollProgress } from '@/components/PollProgress'
import { notifications } from '@mantine/notifications'
import { enterprisePollApi } from '@/api/polling'
import { DpdPollPane } from './DpdPollPane'
import { GsmPollPanel } from './GsmPollPanel'
import { writeSheet, writeSheets, today } from '@/lib/xlsx'
import { AccidentsReport, formatDuration } from './AccidentsReport'
import { useEnterpriseEvents } from './useEnterpriseEvents'
import { useUnpolledCheck } from './useUnpolledCheck'
import { UnpolledReport } from './UnpolledReport'
import { EMPTY_UNPOLLED_FILTERS, type UnpolledFilters } from './unpolledFilters'
import { useStickyRowHeights } from '@/components/useMeasuredHeight'
import { enterpriseRecordTotal } from '@/domain/enterpriseVolumes'
import {
  convertPressureValue,
  isKnownUnit,
  normalizeUnit,
  PRESSURE_UNIT_DEFAULT,
} from '@/domain/pressureUnits'
import { PressureUnitPicker } from '@/components/PressureUnitPicker'
import { useSearchParams } from 'react-router-dom'
import { useLanguage } from '@/locales/LanguageContext'
import { CheckboxFilter } from '@/components/CheckboxFilter'
import { useHotkeys } from '@/lib/hotkeys'
import { useTreeNav, type NavRow } from '@/lib/treeNav'
import { useSelectionStore } from '@/store/selectionStore'
import { numericStyle } from '@/theme/theme'
import { ArchiveChart } from '@/features/archive/ArchiveChart'
import type { ArchiveRow } from '@/api/entities'
import { TOPOLOGY_KEYS } from '@/lib/topologyKeys'

type PeriodType = 'daily' | 'hourly'

interface PollRow {
  period: string
  volume: number
  temperature: number | null
  pressure: number | null
  pressureUnit: string | null
}

/**
 * Leaves room for the two toolbar rows above it: this screen carries one more
 * than the archives, so the tree and the pane start lower.
 */
const SPLIT_HEIGHT = 'calc(100dvh - 192px)'

const NO_BRANCH = '__no_branch__'
const NO_LINE = '__no_line__'

/** One row of the left pane's tree, as the keyboard walks it. */
interface PollNavRow extends NavRow {
  kind: 'branch' | 'line' | 'site'
  /** Enterprise rows only. */
  siteId?: number
}

/** Numeric cell: '—' when there is nothing to show. */
const fmtNum = (v: number | null | undefined, digits = 2) =>
  v == null || isNaN(v) ? '—' : v.toLocaleString('uk-UA', { maximumFractionDigits: digits })

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The three numeric columns of the poll table, in the order they are shown.
 * `isSummable` picks the footer's default: volumes add up, a temperature or a
 * pressure summed over a month means nothing, so those average.
 */
const COLUMNS: {
  key: 'volume' | 'temperature' | 'pressure'
  isSummable: boolean
  decimals: number
}[] = [
  { key: 'volume', isSummable: true, decimals: 3 },
  { key: 'temperature', isSummable: false, decimals: 2 },
  { key: 'pressure', isSummable: false, decimals: 2 },
]

/** Opens on the current month: 1st -> today, like the reports. */
function defaultRange() {
  const now = new Date()
  const y = now.getFullYear()
  const m = pad(now.getMonth() + 1)
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${pad(now.getDate())}` }
}

/**
 * Enterprise poll: pick a branch + enterprise (device) and pull its volumes
 * from the DPD API over the NDJSON progress stream (polls can run minutes).
 */
/** A point whose corrector nobody has entered. Given a name of its own so it
 *  can be filtered FOR — that is the list somebody fixing the catalogue
 *  wants, and it is invisible in every other view. */
const UNKNOWN_MODEL = 'без коректора'

/** The model standing at a point now, named even when there is none. */
function fittedModel(m: EnterpriseMappingRow): string {
  return currentDevice(m)?.model_name ?? UNKNOWN_MODEL
}

export function EnterprisePollPage() {
  const { t } = useLanguage()
  const { branchId, setBranchId } = useSelectionStore()
  // "Всі філії" belongs to THIS screen, not to the reports. It used to write
  // straight into the shared selection, so clearing the filter here left every
  // report screen with no branch — the branch looked lost on the next tab.
  // Picking a branch still carries over; only the empty state stays local.
  const [branchFilter, setBranchFilter] = useState<number | null>(branchId)
  const [search, setSearch] = useState('')
  /** Corrector models to show. Multi-select: "ВЕГА and КПЛГ, not Флоутек" is
   *  the question people actually ask. Empty means all of them. */
  const [models, setModels] = useState<string[]>([])
  /** Whether the site has a modem: "yes" / "no". Empty means both. */
  const [gsm, setGsm] = useState<string[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  /**
   * Arriving on one enterprise: /enterprise-poll?enterprise=<id>.
   *
   * The GSM monitor answers "is it being polled" and the readings are here, so
   * its rows link straight to the site they are about — in a tab of their own,
   * because the monitor is a live screen somebody is watching while they come
   * and look. The link also survives being bookmarked or pasted to a
   * colleague, which the in-page selection never could.
   */
  const [params] = useSearchParams()
  const asked = Number(params.get('enterprise')) || null
  // Feed the scrollbars, which run between the sticky header and totals row.
  const { containerRef, theadRef, tfootRef, theadHeight, tfootHeight } = useStickyRowHeights()
  // Collapsed groups survive reloads; the tree is long and reopening it every
  // time would be busywork.
  const [view, setView] = useLocalStorage<'table' | 'chart'>({
    key: 'hlv-poll-view',
    defaultValue: 'table',
  })
  const [collapsed, setCollapsed] = useLocalStorage<Record<string, boolean>>({
    key: 'hlv-poll-collapsed',
    defaultValue: {},
  })
  const toggleGroup = (key: string) => setCollapsed((p) => ({ ...p, [key]: !p[key] }))
  /**
   * Whether a group shows its children. One definition, read by the markup and
   * by the flat row list the keyboard walks — the two must never disagree about
   * what is on screen. A search in progress forces every group open: a hit
   * hidden inside a collapsed branch reads as "nothing found".
   */
  const groupOpen = useCallback(
    (key: string) => !!search.trim() || !collapsed[key],
    [search, collapsed],
  )
  /**
   * Which report owns the right pane.
   *
   * Was two independent booleans, and the pane's ternary checked accidents
   * first: once «Аварії» had been opened, pressing «Не опитуються» set its own
   * flag but the pane went on drawing accidents, so the button looked broken.
   * One value cannot be in two states at once.
   */
  const [pane, setPane] = useState<'poll' | 'unpolled' | 'accidents' | 'gsm'>('poll')

  /**
   * Where the readings come from.
   *
   * The Радміртех server is the metered API somebody else runs; GSM is this
   * site's own modem,
   * dialled by an agent beside it. The switch appears only where there is a
   * modem to switch to, because an option that fails for most of the list
   * teaches people to ignore the option.
   */
  const [source, setSource] = useLocalStorage<'dpd' | 'gsm'>({
    key: 'enterprise-poll.source',
    defaultValue: 'dpd',
  })

  /**
   * Two jobs that had been one button.
   *
   * Fetching and looking are different questions and they were answered by
   * the same press: «Опитати» went to DPD for the chosen granularity and drew
   * the table it got back, so "show me what we have" and "go and get more"
   * were indistinguishable — and the modem, which fetches without returning
   * anything to draw, had nowhere to live. Now the poll stores and says how
   * much; the archive reads the database and never contacts anybody.
   */
  const [tab, setTab] = useLocalStorage<'poll' | 'archive'>({
    key: 'enterprise-poll.tab',
    defaultValue: 'archive',
  })
  const [stored, setStored] = useState<PollStored | null>(null)
  // Bumped on every «Опитати» over GSM, so the panel starts a clean log
  // instead of continuing the previous session's.
  const [gsmRun, setGsmRun] = useState(0)
  const [reportFilters, setReportFilters] = useState<UnpolledFilters>(EMPTY_UNPOLLED_FILTERS)
  const [periodType, setPeriodType] = useLocalStorage<PeriodType>({
    key: 'enterprise-poll.periodType',
    defaultValue: 'daily',
  })
  const initialRange = defaultRange()
  const [from, setFrom] = useState(initialRange.from)
  const [to, setTo] = useState(initialRange.to)
  const [records, setRecords] = useState<EnterpriseRecord[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<{ done?: number; total?: number; phase?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)


  // The poll's own stream. The two hooks abort theirs on unmount themselves.
  useEffect(() => () => abortRef.current?.abort(), [])

  const { data: branches } = useQuery({ queryKey: ['admin', 'branches'], queryFn: branchAdminApi.getAll })
  const { data: mappings, isLoading: mappingsLoading } = useQuery({
    queryKey: TOPOLOGY_KEYS.enterpriseMappings,
    queryFn: enterpriseApi.getMappings,
    staleTime: 5 * 60_000,
  })

  // «Немає опитування» and «Аварії» are separate features that happen to share
  // this screen's branch selector. While they lived here they also shared its
  // `error` state, so a failed check surfaced in the poll's panel.
  const unp = useUnpolledCheck(mappings, branchFilter)
  const acc = useEnterpriseEvents(branchFilter)

  // Line names for the list: an enterprise points at either a physical line or
  // a DPD line, and knowing which one it feeds is the whole point of the list.
  const { data: lines } = useQuery({
    queryKey: ['admin', 'lines'],
    queryFn: () => lineAdminApi.getAll(),
    staleTime: 5 * 60_000,
  })
  const { data: dpdLines } = useQuery({
    queryKey: ['admin', 'dpd-lines'],
    queryFn: () => dpdLineAdminApi.getAll().catch(() => []),
    staleTime: 5 * 60_000,
  })

  const lineNameById = useMemo(() => {
    const m = new Map<number, string>()
    ;(lines ?? []).forEach((l) => m.set(l.id, l.name))
    ;(dpdLines ?? []).forEach((d) => m.set(d.id, `[ДПД] ${d.name}`))
    return (id: number) => m.get(id) ?? null
  }, [lines, dpdLines])

  const lineLabel = useMemo(
    () => (row: EnterpriseMappingRow) => {
      const id = row.line_id ?? row.dpd_line_id
      return id != null ? (lineNameById(id) ?? `#${id}`) : null
    },
    [lineNameById],
  )

  const list = useMemo(() => {
    const all = mappings ?? []
    const q = search.trim().toLowerCase()
    return all
      .filter((m) => !branchFilter || m.branch_id === branchFilter)
      .filter((m) => {
        if (!models.length) return true
        return models.includes(fittedModel(m))
      })
      .filter((m) => !gsm.length || gsm.includes(m.gsm?.phone ? 'yes' : 'no'))
      .filter((m) => {
        if (!q) return true
        return (
          enterpriseLabel(m).toLowerCase().includes(q) ||
          (m.devices ?? []).some((d) => String(d.ser_num).includes(q)) ||
          (lineLabel(m) ?? '').toLowerCase().includes(q)
        )
      })
  }, [mappings, branchFilter, search, lineLabel, models, gsm])

  /**
   * Corrector models to choose from — the ones standing in the industry, not
   * the catalogue's thirty-nine.
   *
   * The catalogue lists every model the system knows; a handful of them are
   * fitted anywhere. Offering the rest is offering ways to filter the tree to
   * nothing, and the count beside each name answers the question that usually
   * follows ("how many ВЕГ have we got?") without filtering at all.
   *
   * Counted within the branch already chosen, so the numbers match the tree
   * underneath rather than the whole country.
   */
  const modelOptions = useMemo(() => {
    const seen = new Map<string, number>()
    for (const m of mappings ?? []) {
      if (branchFilter && m.branch_id !== branchFilter) continue
      const name = fittedModel(m)
      seen.set(name, (seen.get(name) ?? 0) + 1)
    }
    return [...seen.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'uk'))
      .map(([name, count]) => ({ value: name, label: name, count }))
  }, [mappings, branchFilter])

  /** With a modem or without — counted in the branch, like the models. */
  const gsmOptions = useMemo(() => {
    const rows = (mappings ?? []).filter((m) => !branchFilter || m.branch_id === branchFilter)
    const withModem = rows.filter((m) => m.gsm?.phone).length
    return [
      { value: 'yes', label: t('withModem'), count: withModem },
      { value: 'no', label: t('withoutModem'), count: rows.length - withModem },
    ]
  }, [mappings, branchFilter, t])

  /**
   * Branch → line → enterprises, the same shape as the old poll screen. A flat
   * list of a few hundred devices is unreadable; grouping by the line they sit
   * behind is what makes an enterprise findable.
   */
  const tree = useMemo(() => {
    const byBranch = new Map<string, Map<string, EnterpriseMappingRow[]>>()
    for (const m of list) {
      const bKey = m.branch_id != null ? String(m.branch_id) : NO_BRANCH
      const lKey = (m.line_id ?? m.dpd_line_id) != null ? String(m.line_id ?? m.dpd_line_id) : NO_LINE
      if (!byBranch.has(bKey)) byBranch.set(bKey, new Map())
      const lines = byBranch.get(bKey)!
      if (!lines.has(lKey)) lines.set(lKey, [])
      lines.get(lKey)!.push(m)
    }
    const branchOrder = (branches ?? []).map((b) => String(b.id))
    const sortKey = (k: string, order: string[]) => (k === NO_BRANCH || k === NO_LINE ? 1e9 : order.indexOf(k))
    return [...byBranch.entries()]
      .sort((a, b) => sortKey(a[0], branchOrder) - sortKey(b[0], branchOrder))
      .map(([bKey, lines]) => ({
        key: bKey,
        name:
          bKey === NO_BRANCH
            ? 'Без філії'
            : ((branches ?? []).find((b) => String(b.id) === bKey)?.name ?? `Філія ${bKey}`),
        count: [...lines.values()].reduce((n, arr) => n + arr.length, 0),
        lines: [...lines.entries()]
          .sort((a, b) => (a[0] === NO_LINE ? 1 : b[0] === NO_LINE ? -1 : Number(a[0]) - Number(b[0])))
          .map(([lKey, items]) => ({
            key: lKey,
            name: lKey === NO_LINE ? 'Без лінії' : (lineNameById(Number(lKey)) ?? `Лінія ${lKey}`),
            items,
          })),
      }))
  }, [list, branches, lineNameById])

  // Every collapsible key in the tree — branches and the lines under them.
  const allGroupKeys = useMemo(
    () => tree.flatMap((b) => [b.key, ...b.lines.map((l) => `${b.key}/${l.key}`)]),
    [tree],
  )
  const collapseAll = () => setCollapsed(Object.fromEntries(allGroupKeys.map((k) => [k, true])))
  const expandAll = () => setCollapsed({})

  /**
   * The same tree, flattened for the keyboard: branch → line → enterprise in
   * the order it is drawn, carrying only what is on screen. The archive's tree
   * works this way too — see lib/treeNav, which both share.
   *
   * `collapsed` is stored the other way round from `expanded` (an absent key
   * means open), so the hook's open/closed is inverted on the way in and out.
   */
  const navRows = useMemo<PollNavRow[]>(() => {
    const out: PollNavRow[] = []
    for (const branch of tree) {
      const bOpen = groupOpen(branch.key)
      out.push({
        key: branch.key,
        parentKey: null,
        label: branch.name,
        expandable: branch.lines.length > 0,
        expanded: bOpen,
        kind: 'branch',
      })
      if (!bOpen) continue
      for (const line of branch.lines) {
        const lKey = `${branch.key}/${line.key}`
        const lOpen = groupOpen(lKey)
        out.push({
          key: lKey,
          parentKey: branch.key,
          label: line.name,
          expandable: line.items.length > 0,
          expanded: lOpen,
          kind: 'line',
        })
        if (!lOpen) continue
        for (const m of line.items) {
          out.push({
            key: `s${m.id}`,
            parentKey: lKey,
            label: enterpriseLabel(m),
            expandable: false,
            expanded: false,
            kind: 'site',
            siteId: m.id,
          })
        }
      }
    }
    return out
  }, [tree, groupOpen])

  const searchRef = useRef<HTMLInputElement>(null)
  const nav = useTreeNav<PollNavRow>({
    rows: navRows,
    preferredKey: selected != null ? `s${selected}` : null,
    onToggle: (key, open) => setCollapsed((p) => ({ ...p, [key]: !open })),
    onExpandMany: (keys) =>
      setCollapsed((p) => {
        const next = { ...p }
        for (const key of keys) next[key] = false
        return next
      }),
    // A search forces every group open; folding would then change nothing on
    // screen, so the left arrow climbs to the parent instead.
    canFold: !search.trim(),
    onEscape: search ? () => setSearch('') : undefined,
    onActivate: (row) => {
      if (row.kind === 'site' && row.siteId != null) {
        setSelected(row.siteId)
        return
      }
      // Enter turns a group over: open folds, folded opens.
      setCollapsed((p) => ({ ...p, [row.key]: row.expanded }))
    },
  })

  useHotkeys([
    { key: ['/'], run: () => searchRef.current?.focus() },
    { alt: true, key: ['t', 'T'], code: ['KeyT'], run: () => nav.focusTree() },
  ])

  // Picked up once the list is there, and only once: the branch is widened to
  // the one the site belongs to, or the filter would hide what the link asked
  // for, and its groups are opened so the row can be seen to be selected.
  const arrived = useRef<number | null>(null)
  useEffect(() => {
    if (!asked || arrived.current === asked || !mappings?.length) return
    const site = mappings.find((m) => m.id === asked)
    if (!site) return
    arrived.current = asked
    setSelected(asked)
    if (site.branch_id != null && branchFilter !== site.branch_id) {
      setBranchFilter(site.branch_id)
    }
    const branchKey = site.branch_id != null ? String(site.branch_id) : NO_BRANCH
    const lineKey =
      (site.line_id ?? site.dpd_line_id) != null
        ? String(site.line_id ?? site.dpd_line_id)
        : NO_LINE
    setCollapsed((open) => ({
      ...open,
      [branchKey]: false,
      [`${branchKey}/${lineKey}`]: false,
    }))
  }, [asked, mappings, branchFilter, setBranchFilter, setCollapsed])

  const selectedMapping = list.find((m) => m.id === selected) ?? null
  const hasModem = !!selectedMapping?.gsm?.phone

  /**
   * "Немає опитування" — which enterprises have gone silent.
   *
   * Poll the last four COMPLETED days for every line that has an active
   * enterprise behind it, and call a device polled if ANY period in that window
   * came back with a volume. A null volume is the whole signal here — it means
   * the corrector was not reached — so `include_devices` must stay on (the
   * endpoint defaults it to true) and `live` must be set, or the check reports
   * on the archive instead of on the meters.
   *
   * The window ends YESTERDAY. Today's commercial day is still running, so DPD
   * has no daily record for it yet for anybody — including it polled a day that
   * can only come back empty and pushed the whole window a day short of what it
   * claimed to check. On the 25th the check covers the 21st through the 24th.
   */
  const exportUnpolled = (rowsToExport: EnterpriseMappingRow[]) => {
    const body = rowsToExport.map((m) => [
      (branches ?? []).find((b) => b.id === m.branch_id)?.name ?? '',
      enterpriseLabel(m),
      correctorLabel(m),
      currentDevice(m)?.ser_num ?? '',
      currentDevice(m)?.ch_num ?? '',
      lineLabel(m) ?? t('withoutLine'),
      m.enabled === false ? t('statusDisabled') : t('statusEnabled'),
    ])

    // Both views go into the file regardless of which one is on screen: whoever
    // opens it later wants the totals, and re-exporting to get them is busywork.
    const on = rowsToExport.filter((m) => m.enabled !== false).length
    const byCorrector = new Map<string, { on: number; off: number }>()
    for (const m of rowsToExport) {
      const name = correctorLabel(m) || t('unknownCorrector')
      const e = byCorrector.get(name) ?? { on: 0, off: 0 }
      if (m.enabled === false) e.off += 1
      else e.on += 1
      byCorrector.set(name, e)
    }
    const summary: (string | number)[][] = [
      [t('unpolledChecked'), unp.checkedRange.count],
      [t('unpolledTotal'), rowsToExport.length],
      [t('unpolledOn'), on],
      [t('unpolledOff'), rowsToExport.length - on],
      [],
      [t('correctorType'), t('unpolledOn'), t('unpolledOff'), t('total')],
      ...[...byCorrector.entries()]
        .sort((a, b) => b[1].on + b[1].off - (a[1].on + a[1].off))
        .map(([name, c]) => [name, c.on, c.off, c.on + c.off]),
    ]

    void writeSheets(`unpolled_enterprises_${today()}`, [
      { name: t('unpolledSummary'), aoa: summary, cols: [34, 14, 14, 12] },
      {
        name: t('unpolledByName'),
        aoa: [[
          t('branch'), t('enterprise'), t('correctorType'), t('correctorNumber'),
          t('channelNumber'), t('lineName'), t('status'),
        ], ...body],
        cols: [20, 30, 20, 18, 14, 20, 12],
      },
    ])
  }

  /**
   * Ask the agent beside the modem to dial this site now.
   *
   * Not awaited into a result: the call is made on somebody else's machine
   * and takes minutes. What comes back is only whether the request was
   * accepted — and the refusals are the useful part, because each one is a
   * call that would otherwise go nowhere: no modem set up, nothing fitted at
   * the site, no agent on the line.
   */
  const runGsm = async () => {
    if (!selectedMapping) return
    setPane('gsm')
    setError(null)
    try {
      const started = await enterprisePollApi.start(selectedMapping.id)
      setGsmRun((n) => n + 1)
      // «Прийняв» was wrong twice over: nobody has taken the request yet —
      // it is picked up when an agent next asks for its plan — and with two
      // machines on the site it is not known which of them will.
      const waiting = started.agent_names ?? []
      notifications.show({
        color: 'blue',
        message:
          waiting.length === 1
            ? `Запит передано агенту «${waiting[0]}» — подзвонить, щойно візьме завдання`
            : waiting.length > 1
              ? `Запит у черзі — подзвонить той із агентів, хто візьме першим: ${waiting.join(', ')}`
              : 'Запит у черзі — агент подзвонить, щойно візьме завдання',
      })
    } catch (e) {
      // The refusals are sentences meant for an operator — "немає
      // встановлених корректорів", "немає вільного модема" — so they belong
      // on the screen as they are.
      setError(e instanceof Error ? e.message : String(e))
      setPane('poll')
    }
  }

  /**
   * Poll DPD for this enterprise and store what comes back.
   *
   * Both granularities, and no date pickers: the window is not a question for
   * the operator, and it is decided on the server, where the archive is. It
   * runs from where that archive ends to tomorrow — tomorrow because the day
   * here is a gas day, so the hours of the current one are filed under a date
   * that has not arrived yet and ending at today would leave them behind on
   * every poll. With nothing stored it runs from the start of 2024.
   *
   * Nothing is drawn from the answer. Looking at the readings is the other
   * tab, and it reads the database.
   */
  const runDpd = async () => {
    if (!selectedMapping) return
    setPane('poll')
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    setProgress(null)
    setStored(null)
    try {
      // No dates: the server reads from where this point's archive ends to
      // tomorrow. The pickers above choose what to LOOK at, which is a
      // different question — polling only the month on screen is how holes
      // were left behind.
      const result = await streamEnterprisePoll(
        { enterprise_id: selectedMapping.id },
        { onProgress: setProgress, signal: ctrl.signal },
      )
      setStored(result)
    } catch (e) {
      const err = e as Error
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  const run = async () => {
    if (!selectedMapping) return
    // Whichever report was open, this button's results are what the operator
    // is now waiting for — leaving a report on top ran the poll invisibly.
    setPane('poll')
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    setProgress(null)
    setRecords(null)
    try {
      const res = await streamEnterpriseVolumes(
        {
          from_date: from,
          to_date: to,
          period_type: periodType,
          // The corrector standing there now: this screen asks the meter,
          // and the meter is whichever device is fitted today.
          serNum: currentDevice(selectedMapping)?.ser_num,
          mfDev: currentDevice(selectedMapping)?.mf_dev ?? undefined,
          typeDev: currentDevice(selectedMapping)?.type_dev ?? undefined,
          chNum: currentDevice(selectedMapping)?.ch_num,
          line_id: (() => {
            const id = selectedMapping.line_id ?? selectedMapping.dpd_line_id
            return id != null ? [id] : undefined
          })(),
          // Reading, not asking. This is the archive view: it answers with
          // what is stored and never contacts DPD, so a period that is
          // genuinely empty no longer looks like an API that was unreachable.
          // Fetching is the other tab, and it stores what it fetches.
          live: false,
          // A deactivated point is still selectable here, and asking its meter
          // is often WHY it is being looked at. Without this the poll ran and
          // came back empty, because every lookup drops inactive points. It
          // changes nothing anywhere else: daily, hourly, trends and the night
          // report resolve through the ring path, which refuses this flag.
          include_inactive: true,
        },
        { onProgress: setProgress, signal: ctrl.signal },
      )
      setRecords(res)
    } catch (e) {
      const err = e as Error
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const stop = () => {
    abortRef.current?.abort()
    setLoading(false)
  }

  /** One row per (event type, enterprise): the expanded view, flattened. */
  const exportAccidents = (groups: EventGroup[]) => {
    const header = [
      t('entAccType'), 'DPD key', t('enterprise'), 'serNum',
      t('entAccFirst'), t('entAccLast'), t('entAccDuration'), t('entAccCount'),
    ]
    const body = groups.flatMap((g) =>
      g.objects.map((o) => [
        g.name, g.type, o.enterprise_name, o.serNum,
        o.first, o.last ?? '', formatDuration(o.duration, t), o.appearances,
      ]),
    )
    void writeSheet(`accidents_${acc.from}_${acc.to}`, t('accidents'), [header, ...body])
  }

  /**
   * What the meter reports its pressure in — the newest record that says.
   *
   * One device, but not necessarily one unit: a corrector replaced by one set
   * differently leaves a history in both, and twelve devices of this fleet
   * already have one. Records with no unit (never sent, or sent as the literal
   * "None") fall back to the project default; those meters report in кгс/см².
   */
  const reported = useMemo(() => {
    for (let i = (records?.length ?? 0) - 1; i >= 0; i--) {
      const unit = normalizeUnit(records![i].devices?.[0]?.pressure_unit)
      if (unit) return unit
    }
    return null
  }, [records])

  // And what the screen reads it in: that same unit, until the reader says
  // otherwise in the column header. Not remembered between enterprises — each
  // one is read in its own meter's unit first.
  const [unitChoice, setUnitChoice] = useState<string | null>(null)
  const pressureUnit = unitChoice ?? reported ?? PRESSURE_UNIT_DEFAULT

  /**
   * Temperature, pressure and its unit live on the DEVICE, not on the record:
   * the record only carries the period and the rolled-up volume. Reading them
   * off the record left both columns permanently empty.
   *
   * Pressure is converted here, once, so the table, the footer, the chart and
   * the export all read the same unit — captioning them and leaving the
   * numbers alone showed the same pressure as 1.0 and 0.10 in neighbouring
   * rows, which is what a unit changing mid-history looks like.
   */
  const rows: PollRow[] = useMemo(
    () =>
      (records ?? [])
        .map((r) => {
          const device = r.devices?.[0]
          const from = normalizeUnit(device?.pressure_unit) ?? reported ?? PRESSURE_UNIT_DEFAULT
          const pressure = device?.pressure ?? null
          return {
            period: String(r.period),
            volume: enterpriseRecordTotal(r),
            temperature: device?.temperature ?? null,
            pressure:
              pressure == null || !isKnownUnit(from) || !isKnownUnit(pressureUnit)
                ? pressure
                : convertPressureValue(pressure, from, pressureUnit),
            pressureUnit,
          }
        })
        .sort((a, b) => a.period.localeCompare(b.period)),
    [records, reported, pressureUnit],
  )

  // ── Paging ────────────────────────────────────────────────────────────────
  // A page is a stretch of time, the same spans the daily and hourly archives
  // page by — a month of hourly readings is 744 rows, and scrolling through
  // them to reach the totals row was the whole problem.
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useLocalStorage({
    key: `hlv-poll-pagesize-${periodType}`,
    defaultValue: DEFAULT_PERIOD_PAGE_SIZE[periodType],
  })
  // A new poll, or a switch between daily and hourly, starts at page one —
  // clamping alone would leave the reader on page 7 of a different dataset.
  useEffect(() => {
    setPage(1)
  }, [records, periodType])
  const pageSizeOptions: PageSizeOption[] = useMemo(
    () => PERIOD_PAGE_SIZES[periodType].map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [periodType, t],
  )
  // A fresh poll, or a shorter page, can leave the open page past the end.
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleRows = useMemo(
    () => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [rows, currentPage, pageSize],
  )

  // ── Footer ────────────────────────────────────────────────────────────────
  /**
   * Per column, kept per granularity — a daily poll and an hourly one get read
   * for different things. Folded over the WHOLE poll, not the open page: the
   * row answers "what did this point consume over the period", which a page
   * cannot. Same rule, and the same picker, as the archive footer.
   */
  const [aggregates, setAggregates] = useLocalStorage<Record<string, Aggregate>>({
    key: `hlv-poll-agg-cols-${periodType}`,
    defaultValue: {},
  })
  const pickAggregate = (key: string, how: Aggregate) =>
    setAggregates({ ...aggregates, [key]: how })

  const totals = useMemo(() => {
    const out: Record<string, { text: string; how: Aggregate }> = {}
    for (const col of COLUMNS) {
      const how = columnAggregate(col, aggregates[col.key])
      const values = rows
        .map((r) => Number(r[col.key]))
        .filter((n) => isFinite(n))
      const folded = fold(values, how)
      out[col.key] = { text: folded == null ? '—' : fmtNum(folded, col.decimals), how }
    }
    return out
  }, [rows, aggregates])

  const exportExcel = () => {
    const serial = (selectedMapping && currentDevice(selectedMapping)?.ser_num) ?? 'poll'
    void writeSheet(
      `enterprise_${serial}_${from}_${to}`,
      t('enterprise'),
      [
        ['Період', 'Обʼєм, м³', 'Температура, °C', `Тиск, ${pressureUnit}`],
        ...rows.map((r) => [r.period, r.volume, r.temperature ?? '', r.pressure ?? '']),
        ['Разом', totals.volume.text, totals.temperature.text, totals.pressure.text],
      ],
    )
  }

  /**
   * Starting a poll is one act with two ways of doing it, so the choice sits in
   * the button that performs it rather than in a switch somewhere to its left.
   * Picking a way remembers it, and the pane follows.
   */
  const startPoll = (next: 'dpd' | 'gsm') => {
    setSource(next)
    if (next === 'gsm' && hasModem) return void runGsm()
    return void runDpd()
  }

  const stopButton = (
    <Button
      size="xs"
      color="red"
      variant="light"
      leftSection={<IconPlayerStop size={15} />}
      onClick={stop}
    >
      {t('stop')}
    </Button>
  )

  return (
    <Stack gap="sm">
      {/*
        Two rows. The first says what the screen is, which half of the job is
        open, and carries the questions about the whole list; the second carries
        the controls of that half.

        Both halves used to share one row, so switching between them made the
        granularity and the dates appear or vanish and shifted everything to
        their right — including the button that starts the work. The three
        choices (half of the job, granularity of the data, way of fetching) were
        also drawn as three identical pills, which said nothing about which of
        them decides what the screen does.
      */}
      <Group gap="md" wrap="nowrap" align="center">
        <Title order={4} style={{ whiteSpace: 'nowrap' }}>
          {t('enterprisePoll')}
        </Title>
        {/* Reading and fetching are two halves of one job, not two settings:
            «Архів» reads the database, «Опитування» goes and gets more. Tabs,
            because everything in the row below belongs to the chosen half. */}
        <Tabs
          value={tab}
          onChange={(v) => {
            if (!v) return
            setTab(v as 'poll' | 'archive')
            // A report is dismissed; which poll pane was open is kept, so
            // coming back from the archive does not lose the modem journal.
            setPane((p) => (p === 'gsm' ? 'gsm' : 'poll'))
          }}
        >
          <Tabs.List style={{ borderBottom: 'none', flexWrap: 'nowrap' }}>
            <Tabs.Tab value="archive" leftSection={<IconDatabase size={15} />}>
              {t('pollTabArchive')}
            </Tabs.Tab>
            <Tabs.Tab value="poll" leftSection={<IconBroadcast size={15} />}>
              {t('pollTabPoll')}
            </Tabs.Tab>
          </Tabs.List>
        </Tabs>

        {/* These ask about the whole list rather than the chosen enterprise, so
            they keep the same place whichever half is open. */}
        <Group gap="xs" wrap="nowrap" ml="auto">
          {/* Answers "is anything not reporting?" without picking a device
              first — the reason it is a toolbar button and not a row action.
              Once a report exists the button re-opens it rather than spending
              another multi-minute poll; re-running is «Оновити» inside it. */}
          <Button
            size="xs"
            variant="light"
            color="amber"
            leftSection={<IconPlugConnectedX size={15} />}
            rightSection={
              pane === 'unpolled' ? undefined : unp.checking ? (
                <Loader size={12} color="amber" />
              ) : unp.rows !== null ? (
                <Badge size="xs" circle variant="filled" color={unp.rows.length ? 'amber' : 'teal'}>
                  {unp.rows.length}
                </Badge>
              ) : undefined
            }
            onClick={() => {
              // Open FIRST, then poll: the check runs for minutes, and starting
              // it before the pane existed meant those minutes passed with no
              // progress bar anywhere on screen.
              setPane('unpolled')
              if (unp.rows === null && !unp.checking) void unp.run()
            }}
            disabled={loading}
          >
            {t('unpolledEnterprises')}
          </Button>
          {/* Alarms are a different question from volumes and need no
              enterprise selected, so they sit beside the "no poll" report
              rather than in a row action. */}
          <Button
            size="xs"
            variant="light"
            color="amber"
            leftSection={<IconAlertTriangle size={15} />}
            rightSection={
              pane === 'accidents' ? undefined : acc.loading ? (
                <Loader size={12} color="amber" />
              ) : acc.report ? (
                <Badge size="xs" circle variant="filled" color={acc.report.groups.length ? 'amber' : 'teal'}>
                  {acc.report.groups.length}
                </Badge>
              ) : undefined
            }
            onClick={() => setPane('accidents')}
            disabled={loading}
          >
            {t('accidents')}
          </Button>
          <Select
            placeholder="Всі філії"
            data={(branches ?? []).map((b) => ({ value: String(b.id), label: b.name }))}
            value={branchFilter != null ? String(branchFilter) : null}
            onChange={(v) => {
              const next = v ? Number(v) : null
              setBranchFilter(next)
              if (next != null) setBranchId(next)
            }}
            clearable
            searchable
            size="xs"
            w={200}
          />
          <Button
            size="xs"
            variant="light"
            color="teal"
            leftSection={<IconFileSpreadsheet size={15} />}
            onClick={exportExcel}
            disabled={!rows.length}
            style={{ flexShrink: 0 }}
          >
            {t('excel')}
          </Button>
        </Group>
      </Group>

      {/* The chosen half's own controls. */}
      <Group gap="md" wrap="nowrap" align="center">
        {tab === 'archive' ? (
          <>
            <SegmentedControl
              size="xs"
              value={periodType}
              onChange={(v) => setPeriodType(v as PeriodType)}
              data={[
                {
                  value: 'daily',
                  label: (
                    <Group gap={5} wrap="nowrap">
                      <IconCalendar size={13} />
                      {t('daily')}
                    </Group>
                  ),
                },
                {
                  value: 'hourly',
                  label: (
                    <Group gap={5} wrap="nowrap">
                      <IconClockHour4 size={13} />
                      {t('hourly')}
                    </Group>
                  ),
                },
              ]}
            />
            {/* The archives' own period control, so the two screens that read
                stored readings are driven the same way — its «сьогодні» preset
                included. Whole days either way: the hour window is not
                something this endpoint takes. */}
            <PeriodPicker
              withTime={false}
              from={from}
              to={to}
              onChange={({ from: nextFrom, to: nextTo }) => {
                setFrom(nextFrom)
                setTo(nextTo)
              }}
              disabled={loading}
            />
            {loading ? (
              stopButton
            ) : (
              <Button
                size="xs"
                leftSection={<IconPlayerPlay size={15} />}
                onClick={() => void run()}
                disabled={!selectedMapping}
              >
                {t('pollShow')}
              </Button>
            )}
          </>
        ) : (
          <>
            {/* Dates belong to looking, not to fetching: a poll runs from where
                the archive ends to tomorrow. Saying so beats an empty space
                where the pickers used to be. */}
            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {t('pollWindowHint')}
            </Text>
            {loading ? (
              stopButton
            ) : (
              <Button.Group>
                <Button
                  size="xs"
                  leftSection={<IconPlayerPlay size={15} />}
                  onClick={() => startPoll(source)}
                  disabled={!selectedMapping}
                >
                  {/* Where it will read from, written on the button that does
                      it — and only where there is a second way to name. */}
                  {hasModem
                    ? `${t('poll')} · ${source === 'gsm' ? 'GSM' : t('sourceDpdShort')}`
                    : t('poll')}
                </Button>
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <Button
                      size="xs"
                      px={7}
                      disabled={!selectedMapping}
                      aria-label={t('pollSourceLabel')}
                    >
                      <IconChevronDown size={14} />
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Label>{t('pollSourceLabel')}</Menu.Label>
                    <Menu.Item
                      leftSection={<IconDatabase size={15} />}
                      rightSection={source === 'dpd' ? <IconCheck size={13} /> : undefined}
                      onClick={() => startPoll('dpd')}
                    >
                      {t('pollViaDpd')}
                    </Menu.Item>
                    {/* Kept visible without a modem and disabled instead: an
                        option that disappears teaches nobody that it exists,
                        and whether it works depends on the enterprise picked
                        in the tree. */}
                    <Menu.Item
                      leftSection={<IconPhone size={15} />}
                      rightSection={source === 'gsm' ? <IconCheck size={13} /> : undefined}
                      disabled={!hasModem}
                      onClick={() => startPoll('gsm')}
                    >
                      {t('pollViaGsm')}
                      {!hasModem && (
                        <Text size="10px" c="dimmed">
                          {t('pollNoModem')}
                        </Text>
                      )}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Button.Group>
            )}
          </>
        )}
      </Group>

      <Box style={{ display: 'flex', gap: 'var(--mantine-spacing-md)', height: SPLIT_HEIGHT, minHeight: 360 }}>
        <Paper
          withBorder
          radius="md"
          style={{ width: 420, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          <Box p="sm" pb={4}>
            <Group gap={4} wrap="nowrap">
              <TextInput
                ref={searchRef}
                placeholder={t('searchEnterprise')}
                leftSection={<IconSearch size={15} />}
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                size="xs"
                style={{ flex: 1 }}
                /* Down hands the keyboard to the tree, Enter takes the first
                   enterprise found, Esc clears the filter. */
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    if (navRows.length > 0) nav.focusRow(navRows[0].key)
                    return
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const site = navRows.find((r) => r.kind === 'site')
                    if (site?.siteId != null) {
                      nav.focusRow(site.key)
                      setSelected(site.siteId)
                    }
                    return
                  }
                  if (e.key === 'Escape' && search) {
                    e.preventDefault()
                    setSearch('')
                  }
                }}
              />
              {/* A few hundred devices across a dozen branches: opening or
                  closing them one at a time is the slow part of finding one. */}
              <Tooltip label={t('expandAll')} withArrow>
                <ActionIcon variant="default" size="md" onClick={expandAll} aria-label={t('expandAll')}>
                  <IconChevronsDown size={15} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('collapseAll')} withArrow>
                <ActionIcon variant="default" size="md" onClick={collapseAll} aria-label={t('collapseAll')}>
                  <IconChevronsUp size={15} />
                </ActionIcon>
              </Tooltip>
            </Group>
            {/* The same control the lines use: a count on the button and the
                choices as checkboxes, so however much is picked the strip
                stays one row high. */}
            <Group gap={6} mt={6} wrap="wrap">
              <CheckboxFilter
                label={t('correctorShort')}
                options={modelOptions}
                value={models}
                onChange={setModels}
                searchPlaceholder={t('correctorModel')}
                width={280}
              />
              <CheckboxFilter
                label={t('gsmModem')}
                options={gsmOptions}
                value={gsm}
                onChange={setGsm}
                width={220}
              />
            </Group>
          </Box>
          <ScrollArea className="hlv-table-scroll" style={{ flex: 1 }} type="hover">
            {mappingsLoading ? (
              <Center py={40}>
                <Loader size="sm" color="petrol" />
              </Center>
            ) : (
              <Stack gap={2} p="xs" {...nav.containerProps} aria-label={t('enterpriseList')}>
                {tree.map((branch) => {
                  const bOpen = groupOpen(branch.key)
                  return (
                    <Box key={branch.key}>
                      <UnstyledButton
                        {...nav.propsFor(branch.key, { level: 1, className: 'hlv-picker-row' })}
                        onClick={() => {
                          nav.pointerFocus(branch.key)
                          toggleGroup(branch.key)
                        }}
                        px={6}
                        py={5}
                        w="100%"
                        style={{ borderRadius: 6 }}
                      >
                        <Group gap={6} wrap="nowrap">
                          <IconChevronRight
                            size={13}
                            style={{
                              transform: bOpen ? 'rotate(90deg)' : 'none',
                              transition: 'transform 150ms',
                              flexShrink: 0,
                            }}
                          />
                          <IconBuildingCommunity size={13} color="var(--mantine-color-petrol-5)" />
                          <Text size="xs" fw={600} lineClamp={1} style={{ flex: 1 }}>
                            {branch.name}
                          </Text>
                          <Badge size="xs" variant="default">
                            {branch.count}
                          </Badge>
                        </Group>
                      </UnstyledButton>

                      <Collapse expanded={bOpen}>
                        {branch.lines.map((line) => {
                          const lKey = `${branch.key}/${line.key}`
                          const lOpen = groupOpen(lKey)
                          return (
                            <Box key={lKey}>
                              <UnstyledButton
                                {...nav.propsFor(lKey, { level: 2, className: 'hlv-picker-row' })}
                                onClick={() => {
                                  nav.pointerFocus(lKey)
                                  toggleGroup(lKey)
                                }}
                                pl={20}
                                pr={6}
                                py={4}
                                w="100%"
                                style={{ borderRadius: 6 }}
                              >
                                <Group gap={6} wrap="nowrap">
                                  <IconChevronRight
                                    size={12}
                                    style={{
                                      transform: lOpen ? 'rotate(90deg)' : 'none',
                                      transition: 'transform 150ms',
                                      flexShrink: 0,
                                    }}
                                  />
                                  <IconRipple size={12} color="var(--mantine-color-steel-6)" />
                                  <Text
                                    size="11px"
                                    c={line.key === NO_LINE ? 'amber.6' : undefined}
                                    lineClamp={1}
                                    style={{ flex: 1 }}
                                    title={line.name}
                                  >
                                    {line.name}
                                  </Text>
                                  <Text size="10px" c="dimmed">
                                    {line.items.length}
                                  </Text>
                                </Group>
                              </UnstyledButton>

                              <Collapse expanded={lOpen}>
                                {line.items.map((m) => {
                                  const on = selected === m.id
                                  return (
                                    <UnstyledButton
                                      key={m.id}
                                      {...nav.propsFor(`s${m.id}`, {
                                        level: 3,
                                        selected: on,
                                        className: on ? undefined : 'hlv-picker-row',
                                      })}
                                      onClick={() => {
                                        nav.pointerFocus(`s${m.id}`)
                                        setSelected(m.id)
                                      }}
                                      pl={38}
                                      pr={6}
                                      py={4}
                                      w="100%"
                                      style={{
                                        borderRadius: 6,
                                        background: on
                                          ? 'var(--mantine-color-petrol-light)'
                                          : undefined,
                                      }}
                                    >
                                      <Group gap={6} wrap="nowrap">
                                        <Text
                                          size="xs"
                                          fw={on ? 600 : 400}
                                          c={on ? 'petrol' : undefined}
                                          lineClamp={1}
                                          style={{ flex: 1 }}
                                          title={enterpriseLabel(m)}
                                        >
                                          {enterpriseLabel(m)}
                                        </Text>
                                        {/* A site that can be dialled, marked
                                            where it is listed: which ones have
                                            a modem is what somebody choosing
                                            between ДПД and GSM wants to see
                                            before opening each. */}
                                        {m.gsm?.phone && (
                                          <span
                                            title={`${t('gsmModem')}: ${m.gsm.phone}`}
                                            style={{ display: 'inline-flex', flexShrink: 0 }}
                                          >
                                            <IconPhone
                                              size={12}
                                              color="var(--mantine-color-petrol-6)"
                                              aria-label={t('gsmModem')}
                                            />
                                          </span>
                                        )}
                                        {m.active === false && (
                                          <Badge
                                            size="xs"
                                            variant="light"
                                            color="amber"
                                            tt="none"
                                            title={t('inactiveNotInReports')}
                                          >
                                            {t('inactive')}
                                          </Badge>
                                        )}
                                        {currentDevice(m) && (
                                          <Text size="10px" c="dimmed" style={numericStyle}>
                                            {currentDevice(m)!.ser_num}
                                          </Text>
                                        )}
                                      </Group>
                                    </UnstyledButton>
                                  )
                                })}
                              </Collapse>
                            </Box>
                          )
                        })}
                      </Collapse>
                    </Box>
                  )
                })}
                {list.length === 0 && (
                  <Text size="xs" c="dimmed" ta="center" py="md" px="xs">
                    {(mappings ?? []).length === 0
                      ? 'Підприємства не налаштовані — додайте їх в Адмініструванні → Підприємства'
                      : t('noData')}
                  </Text>
                )}
              </Stack>
            )}
          </ScrollArea>
        </Paper>

        <Paper
          withBorder
          radius="md"
          style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          {/* The "no poll" result takes the whole pane: it is a report in its
              own right, and as a modal it covered the tree its rows link into. */}
          {/*
            Which of the two poll panes is on screen follows the poll that was
            started: «Опитати» over the server shows its result, over the modem
            shows the call. It is not a question to answer beforehand, so it is
            not asked in the toolbar — the switch lives here, on the pane it
            switches, for going back to a call's journal without dialling again
            (and it only exists where there is a modem to dial with).
          */}
          {tab === 'poll' && (pane === 'poll' || pane === 'gsm') ? (
            <>
              {hasModem && selectedMapping && (
                <Group
                  px="sm"
                  py={6}
                  gap="sm"
                  style={{ borderBottom: '1px solid var(--hlv-border)', flexShrink: 0 }}
                >
                  <SegmentedControl
                    size="xs"
                    value={pane === 'gsm' ? 'gsm' : 'poll'}
                    onChange={(v) => setPane(v as 'poll' | 'gsm')}
                    data={[
                      { value: 'poll', label: t('pollPaneResult') },
                      { value: 'gsm', label: t('pollPaneGsmLog') },
                    ]}
                  />
                </Group>
              )}
              <Box style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {pane === 'gsm' && hasModem && selectedMapping ? (
                  <GsmPollPanel
                    enterpriseId={selectedMapping.id}
                    enterpriseName={
                      selectedMapping.enterprise_name ?? `Підприємство ${selectedMapping.id}`
                    }
                    runKey={gsmRun}
                  />
                ) : (
                  <DpdPollPane
                    selected={!!selectedMapping}
                    loading={loading}
                    progress={progress}
                    stored={stored}
                    error={error}
                  />
                )}
              </Box>
            </>
          ) : pane === 'accidents' ? (
            <AccidentsReport
              report={acc.report}
              polledAt={acc.polledAt}
              loading={acc.loading}
              progress={acc.progress}
              error={acc.error}
              from={acc.from}
              to={acc.to}
              onFromChange={acc.setFrom}
              onToChange={acc.setTo}
              onRun={() => void acc.run()}
              onStop={acc.stop}
              onClose={() => setPane('poll')}
              onExport={exportAccidents}
            />
          ) : pane === 'unpolled' ? (
            <UnpolledReport
              rows={unp.rows}
              polledAt={unp.polledAt}
              checking={unp.checking}
              progress={unp.progress}
              error={unp.error}
              onStop={unp.stop}
              filters={reportFilters}
              onFiltersChange={setReportFilters}
              checked={unp.checkedRange.count}
              from={unp.checkedRange.from}
              to={unp.checkedRange.to}
              branchName={(id) => (branches ?? []).find((b) => b.id === id)?.name ?? '—'}
              lineLabel={lineLabel}
              correctorName={correctorLabel}
              onSelect={(id) => {
                setSelected(id)
                // Hide, don't discard: the toolbar button brings it straight back.
                setPane('poll')
              }}
              onClose={() => setPane('poll')}
              onExport={exportUnpolled}
              onRefresh={() => void unp.run()}
            />
          ) : (
          <>
          {/* Header of the pane: what was polled, plus the table/chart switch. */}
          <Group
            px="sm"
            py={6}
            gap="sm"
            wrap="wrap"
            style={{ borderBottom: '1px solid var(--hlv-border)', flexShrink: 0 }}
          >
            {rows.length > 0 && (
              <SegmentedControl
                size="xs"
                value={view}
                onChange={(v) => startTransition(() => setView(v as 'table' | 'chart'))}
                data={[
                  { value: 'table', label: t('table') },
                  { value: 'chart', label: t('chart') },
                ]}
              />
            )}
            {selectedMapping && (
              <Group gap="xs" wrap="wrap">
                <Badge variant="light" color="petrol" tt="none">
                  {enterpriseLabel(selectedMapping)}
                </Badge>
                {lineLabel(selectedMapping) && (
                  <Badge variant="outline" color="gray" tt="none">
                    {lineLabel(selectedMapping)}
                  </Badge>
                )}
                {/* Polling one of these works on purpose; what it must not do
                    is look like data the reports counted. */}
                {selectedMapping.active === false && (
                  <Badge variant="light" color="amber" tt="none" title={t('inactiveNotInReports')}>
                    {t('inactive')}
                  </Badge>
                )}
                {currentDevice(selectedMapping) && (
                  <Text size="xs" c="dimmed" style={numericStyle}>
                    S/N {currentDevice(selectedMapping)!.ser_num}
                  </Text>
                )}
                {currentDevice(selectedMapping)?.model_name && (
                  <Text size="xs" c="dimmed">
                    {currentDevice(selectedMapping)!.manufacturer_short_name}{' '}
                    {currentDevice(selectedMapping)!.model_name}
                  </Text>
                )}
              </Group>
            )}
            {rows.length > 0 && (
              <Text size="xs" c="dimmed" ml="auto">
                {t('records')}: {rows.length}
              </Text>
            )}
          </Group>

          {loading ? (
            <Box p="md">
              <PollProgress progress={progress ?? { phase: 'polling' }} />
            </Box>
          ) : error ? (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} m="sm">
              {error}
            </Alert>
          ) : !selectedMapping ? (
            <Center style={{ flex: 1 }}>
              <Text c="dimmed">{t('selectEnterprise')}</Text>
            </Center>
          ) : records && rows.length === 0 ? (
            <Center style={{ flex: 1 }}>
              <Text c="dimmed">{t('enterpriseNoData')}</Text>
            </Center>
          ) : !records ? (
            <Center style={{ flex: 1 }}>
              <Text c="dimmed">{t('noPollData')}</Text>
            </Center>
          ) : (
            <>
              <Box style={{ flex: 1, minHeight: 0, display: view === 'chart' ? 'none' : 'block' }}>
                {/* Scrollbars keep clear of the sticky rows — see global.css. */}
                <ScrollArea
                  ref={containerRef}
                  className="hlv-table-scroll"
                  style={
                    {
                      height: '100%',
                      '--hlv-thead-h': `${theadHeight}px`,
                      '--hlv-tfoot-h': `${tfootHeight}px`,
                    } as React.CSSProperties
                  }
                  type="auto"
                >
                  <Table striped highlightOnHover stickyHeader verticalSpacing={6}>
                    <Table.Thead ref={theadRef}>
                      <Table.Tr>
                        <Table.Th ta="center">Період</Table.Th>
                        <Table.Th ta="center">Обʼєм, м³</Table.Th>
                        <Table.Th ta="center">Температура, °C</Table.Th>
                        {/* The unit under the name, and the way to change
                            it: these records carry whatever their corrector
                            reported, and the fleet reports both. */}
                        <Table.Th ta="center">
                          Тиск
                          <br />
                          <PressureUnitPicker value={pressureUnit} onChange={setUnitChoice} />
                        </Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {visibleRows.map((r, i) => (
                        <Table.Tr key={i}>
                          <td className="hlv-cell hlv-cell-num">
                            {r.period.replace('T', ' ').slice(0, 16)}
                          </td>
                          <td className="hlv-cell hlv-cell-num">{fmtNum(r.volume, 3)}</td>
                          <td className="hlv-cell hlv-cell-num">{fmtNum(r.temperature)}</td>
                          <td className="hlv-cell hlv-cell-num">{fmtNum(r.pressure)}</td>
                        </Table.Tr>
                      ))}
                      {/* Keeps the totals row at the bottom of a short table. */}
                      <Table.Tr className="hlv-table-filler" aria-hidden>
                        <td colSpan={4} />
                      </Table.Tr>
                    </Table.Tbody>
                    <Table.Tfoot
                      ref={tfootRef}
                      style={{
                        position: 'sticky',
                        bottom: 0,
                        background: 'var(--hlv-surface-2)',
                        borderTop: '2px solid var(--hlv-border)',
                      }}
                    >
                      <Table.Tr>
                        <Table.Td ta="center" fw={700}>
                          Разом
                        </Table.Td>
                        {COLUMNS.map((col) => (
                          <Table.Td key={col.key} ta="center" style={numericStyle}>
                            <AggregateCell
                              value={totals[col.key].text}
                              how={totals[col.key].how}
                              onPick={(how) => pickAggregate(col.key, how)}
                              t={t}
                            />
                          </Table.Td>
                        ))}
                      </Table.Tr>
                    </Table.Tfoot>
                  </Table>
                </ScrollArea>
              </Box>
              {/* Always there while the table has rows, the way the daily and
                  hourly archives have it: the control belongs to the view, not
                  to how much happened to come back. Hidden below its own page
                  size, it was all but invisible here — an hourly page is 744
                  readings, so the bar showed up only past a month of them, and
                  the size buttons could not be reached to make it show. */}
              {view !== 'chart' && rows.length > 0 && (
                <TablePagination
                  page={currentPage}
                  pageSize={pageSize}
                  total={rows.length}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  shownLabel={`${t('records')}: ${rows.length.toLocaleString('uk-UA')}`}
                  pageSizes={pageSizeOptions}
                />
              )}
              {view === 'chart' && (
                <ArchiveChart
                  rows={rows as unknown as ArchiveRow[]}
                  type={periodType}
                  // Same unit the table header shows: it comes from the poll
                  // response, not from any line configuration.
                  meta={{ kind: 'dpd', pressure_unit: pressureUnit }}
                  embedded
                />
              )}
            </>
          )}
          </>
          )}
        </Paper>
      </Box>
    </Stack>
  )
}
