import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocalStorage } from '@mantine/hooks'
import {
  Box,
  TextInput,
  UnstyledButton,
  Group,
  Text,
  Collapse,
  Badge,
  ScrollArea,
  Loader,
  Center,
  ThemeIcon,
} from '@mantine/core'
import {
  IconChevronRight,
  IconSearch,
  IconBuildingCommunity,
  IconFolder,
  IconCpu,
  IconRipple,
} from '@tabler/icons-react'
import { useSelectionStore, type GroupSelection } from '@/store/selectionStore'
import { useLanguage } from '@/locales/LanguageContext'
import { useHotkeys } from '@/lib/hotkeys'
import { useTreeNav, type TreeRowAria } from '@/lib/treeNav'
import { useTreeData, type TreeLine } from './useTreeData'
import {
  branchKey,
  calcKey,
  flattenTree,
  isNodeOpen,
  lineKey,
  lumgKey,
  type OpenMap,
  type TreeRow,
} from './treeRows'

/** Props the keyboard needs on the element drawing one row. */
type RowProps = TreeRowAria

function LineRow({
  line,
  rowProps,
  onPointerFocus,
}: {
  line: TreeLine
  rowProps: RowProps
  onPointerFocus: (key: string) => void
}) {
  const { lineId, selectLine } = useSelectionStore()
  const active = lineId === line.id
  const badge =
    line.kind === 'virtual' ? (
      <Badge size="xs" color="grape" variant="light">
        V
      </Badge>
    ) : line.kind === 'dpd' ? (
      <Badge size="xs" color="blue" variant="light">
        D
      </Badge>
    ) : null

  return (
    <UnstyledButton
      {...rowProps}
      onClick={() => {
        onPointerFocus(lineKey(line))
        selectLine(line.id, line.meta)
      }}
      pl={40}
      pr="xs"
      py={5}
      w="100%"
      style={{
        borderRadius: 6,
        background: active ? 'var(--mantine-color-petrol-light)' : undefined,
      }}
    >
      <Group gap={6} wrap="nowrap">
        <IconRipple size={13} color="var(--mantine-color-steel-6)" />
        {/* Clamped to one line; the full name shows on hover. */}
        <Text
          size="sm"
          fw={active ? 600 : 400}
          c={active ? 'petrol' : undefined}
          lineClamp={1}
          title={line.name}
        >
          {line.name}
        </Text>
        {badge}
      </Group>
    </UnstyledButton>
  )
}

/** Details of the currently selected line, pinned under the tree. */
function SelectionInfo({ line }: { line: TreeLine | null }) {
  const { t } = useLanguage()
  if (!line) return null
  const info = line.info ?? {}
  const chips: { label: string; value: string }[] = []
  if (info.branchName) chips.push({ label: t('branch'), value: info.branchName })
  if (info.calcName) chips.push({ label: t('calcObject'), value: info.calcName })
  if (info.typeName) chips.push({ label: t('calculator'), value: info.typeName })
  if (info.address != null) chips.push({ label: t('calcAddress'), value: String(info.address) })
  if (info.lineNo != null) chips.push({ label: t('calcLine'), value: String(info.lineNo) })

  return (
    <Box
      pt="xs"
      mt="xs"
      style={{ borderTop: '1px solid var(--hlv-border)', flexShrink: 0 }}
    >
      <Group gap={6} wrap="nowrap" mb={6}>
        {line.kind === 'virtual' && (
          <Badge size="xs" color="grape" variant="light">
            V
          </Badge>
        )}
        {line.kind === 'dpd' && (
          <Badge size="xs" color="blue" variant="light">
            D
          </Badge>
        )}
        <Text size="sm" fw={600} c="petrol" lineClamp={2} title={line.name}>
          {line.name}
        </Text>
      </Group>
      <Group gap={4} wrap="wrap">
        {chips.map((c) => (
          <Badge key={c.label} variant="default" size="xs" tt="none" style={{ fontWeight: 400 }}>
            <Text component="span" size="9px" c="dimmed">
              {c.label}:
            </Text>{' '}
            {c.value}
          </Badge>
        ))}
        <Badge variant="light" color="steel" size="xs" tt="none">
          ID: {line.id}
        </Badge>
      </Group>
    </Box>
  )
}

interface NodeProps {
  /** Stable id used to remember this node's open state across reloads. */
  nodeKey: string
  label: string
  icon: React.ReactNode
  depth: number
  count?: number
  defaultOpen?: boolean
  forceOpen?: boolean
  openMap: OpenMap
  onToggle: (key: string, open: boolean) => void
  /** Selecting the node shows every line under it in the daily/hourly archive. */
  onSelect?: () => void
  selected?: boolean
  rowProps: RowProps
  onPointerFocus: (key: string) => void
  children: React.ReactNode
}

function TreeNode({
  nodeKey,
  label,
  icon,
  depth,
  count,
  defaultOpen,
  forceOpen,
  openMap,
  onToggle,
  onSelect,
  selected,
  rowProps,
  onPointerFocus,
  children,
}: NodeProps) {
  // Open state lives in the parent's persisted map, so re-mounting the tree
  // (navigating away and back, or a reload) does not collapse everything.
  // Read through the same helper the keyboard's flat row list uses — the two
  // must never disagree about what is on screen.
  const open = isNodeOpen(openMap, nodeKey, { defaultOpen })
  const setOpen = (next: boolean) => onToggle(nodeKey, next)
  const isOpen = isNodeOpen(openMap, nodeKey, { defaultOpen, forceOpen })
  return (
    <Box>
      {/*
        Two targets side by side rather than one: the chevron folds the node,
        the label selects it. A single button had to mean one or the other, and
        making a click do both would have taken folding away from a tree whose
        whole job is navigation. Siblings, not nested buttons — a button inside
        a button is invalid and swallows the inner click.

        For the keyboard the whole row is the target instead (role="treeitem",
        the tab stop), with → / ← and Enter folding and Enter selecting; the two
        buttons are taken out of the tab order so the row stays a single stop.
      */}
      <Group
        {...rowProps}
        gap={4}
        wrap="nowrap"
        pl={8 + depth * 16}
        pr="xs"
        style={{
          borderRadius: 6,
          background: selected ? 'var(--mantine-color-petrol-light)' : undefined,
        }}
      >
        <UnstyledButton
          tabIndex={-1}
          onClick={() => {
            onPointerFocus(nodeKey)
            setOpen(!open)
          }}
          py={6}
          aria-label={isOpen ? 'Згорнути' : 'Розгорнути'}
          style={{ display: 'flex', alignItems: 'center' }}
        >
          <IconChevronRight
            size={14}
            style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
          />
        </UnstyledButton>
        <UnstyledButton
          tabIndex={-1}
          onClick={() => {
            onPointerFocus(nodeKey)
            if (!onSelect) {
              setOpen(!open)
              return
            }
            onSelect()
            // Selecting a folded node and leaving it folded hides the very
            // lines the pane is about to show.
            if (!open) setOpen(true)
          }}
          py={6}
          style={{ flex: 1, minWidth: 0 }}
        >
          <Group gap={6} wrap="nowrap">
            {icon}
            <Text
              size="sm"
              fw={600}
              c={selected ? 'petrol' : undefined}
              lineClamp={1}
              style={{ flex: 1 }}
              title={label}
            >
              {label}
            </Text>
            {count != null && (
              <Badge size="xs" variant="default">
                {count}
              </Badge>
            )}
          </Group>
        </UnstyledButton>
      </Group>
      <Collapse expanded={isOpen}>
        <div role="group">{children}</div>
      </Collapse>
    </Box>
  )
}

export function TreeView({ fill = false }: { fill?: boolean } = {}) {
  const { data, isLoading } = useTreeData()
  const { t } = useLanguage()
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const { lineId, lineMeta, selectLine, groupSel, selectGroup } = useSelectionStore()
  const isGroup = (kind: GroupSelection['kind'], id: number) =>
    groupSel?.kind === kind && groupSel.id === id

  // Which nodes are unfolded, kept across reloads and page changes.
  const [openMap, setOpenMap] = useLocalStorage<OpenMap>({
    key: 'hlv-tree-open',
    defaultValue: {},
  })
  const toggleNode = useCallback(
    (key: string, open: boolean) => setOpenMap((prev) => ({ ...prev, [key]: open })),
    [setOpenMap],
  )

  // Locate the selected line in the (unfiltered) tree for the info panel.
  const selectedLine = useMemo(() => {
    if (lineId == null || !data) return null
    for (const branch of data) {
      for (const lumg of branch.lumgs) {
        for (const calc of lumg.calcs) {
          const hit = calc.lines.find((l) => l.id === lineId)
          if (hit) return hit
        }
        const other = [...lumg.virtualLines, ...lumg.dpdLines].find((l) => l.id === lineId)
        if (other) return other
      }
    }
    return null
  }, [data, lineId])

  /**
   * The selection is persisted in localStorage, meta and all — so a line
   * renamed (or re-unitised) in the admin panel kept showing its old name in
   * the toolbar and the export file name until it was picked again. The tree is
   * the source of truth; when it disagrees, adopt it.
   */
  useEffect(() => {
    if (!selectedLine || lineId == null) return
    if (JSON.stringify(selectedLine.meta) === JSON.stringify(lineMeta)) return
    selectLine(lineId, selectedLine.meta)
  }, [selectedLine, lineId, lineMeta, selectLine])

  const filtered = useMemo(() => {
    if (!data) return []
    if (!q) return data
    const matchLine = (l: TreeLine) => l.name.toLowerCase().includes(q)
    return data
      .map((b) => ({
        ...b,
        lumgs: b.lumgs
          .map((lm) => ({
            ...lm,
            calcs: lm.calcs
              .map((c) => ({ ...c, lines: c.lines.filter(matchLine) }))
              .filter((c) => c.lines.length > 0 || c.name.toLowerCase().includes(q)),
            virtualLines: lm.virtualLines.filter(matchLine),
            dpdLines: lm.dpdLines.filter(matchLine),
          }))
          .filter(
            (lm) =>
              lm.calcs.length > 0 ||
              lm.virtualLines.length > 0 ||
              lm.dpdLines.length > 0 ||
              lm.name.toLowerCase().includes(q),
          ),
      }))
      .filter((b) => b.lumgs.length > 0 || b.name.toLowerCase().includes(q))
  }, [data, q])

  // ——— Keyboard navigation ———————————————————————————————————————————————
  // The rows as they appear on screen, in that order, from the same inputs the
  // markup below renders — so the arrows can never reach a row nobody can see.
  const rows = useMemo(() => flattenTree(filtered, openMap, !!q), [filtered, openMap, q])

  const selectedKey = selectedLine ? lineKey(selectedLine) : null
  const groupKey = groupSel
    ? groupSel.kind === 'branch'
      ? branchKey(groupSel.id)
      : groupSel.kind === 'lumg'
        ? lumgKey(groupSel.id)
        : calcKey(groupSel.id)
    : null

  const searchRef = useRef<HTMLInputElement>(null)

  const nav = useTreeNav<TreeRow>({
    rows,
    preferredKey: selectedKey ?? groupKey,
    onToggle: toggleNode,
    canFold: !q,
    onEscape: search ? () => setSearch('') : undefined,
    onExpandMany: (keys) =>
      setOpenMap((prev) => {
        const next = { ...prev }
        for (const key of keys) next[key] = true
        return next
      }),
    onActivate: (row) => {
      if (row.line) {
        selectLine(row.line.id, row.line.meta)
        return
      }
      if (!row.group) return
      selectGroup(row.group)
      // Enter both selects the node and turns it over: an unfolded node folds,
      // a folded one opens — otherwise the only way to fold from the keyboard
      // would be ←, and Enter on an open node would do nothing visible.
      toggleNode(row.key, !row.expanded)
    },
  })

  useHotkeys([
    // "/" puts the cursor in the tree's search box — the fastest way to a line
    // when the tree holds three hundred of them.
    { key: ['/'], run: () => searchRef.current?.focus() },
    // Alt+T hands the keyboard to the tree itself, on the row it was last on,
    // without tabbing past the toolbar first.
    { alt: true, key: ['t', 'T'], code: ['KeyT'], run: () => nav.focusTree() },
  ])

  const list = (
    <Box {...nav.containerProps} aria-label={t('nodeListTitle')}>
      {filtered.map((branch) => (
            <TreeNode
              key={branch.id}
              nodeKey={branchKey(branch.id)}
              openMap={openMap}
              onToggle={toggleNode}
              label={branch.name}
              depth={0}
              defaultOpen
              forceOpen={!!q}
              onSelect={() =>
                selectGroup({ kind: 'branch', id: branch.id, name: branch.name })
              }
              selected={isGroup('branch', branch.id)}
              rowProps={nav.propsFor(branchKey(branch.id), { level: 1, selected: isGroup('branch', branch.id) })}
              onPointerFocus={nav.pointerFocus}
              icon={
                <ThemeIcon size="sm" variant="transparent" color="petrol">
                  <IconBuildingCommunity size={15} />
                </ThemeIcon>
              }
              count={branch.lumgs.length}
            >
              {branch.lumgs.map((lumg) => (
                <TreeNode
                  key={lumg.id}
                  nodeKey={lumgKey(lumg.id)}
                  openMap={openMap}
                  onToggle={toggleNode}
                  label={lumg.name}
                  depth={1}
                  forceOpen={!!q}
                  onSelect={() => selectGroup({ kind: 'lumg', id: lumg.id, name: lumg.name })}
                  selected={isGroup('lumg', lumg.id)}
                  rowProps={nav.propsFor(lumgKey(lumg.id), { level: 2, selected: isGroup('lumg', lumg.id) })}
                  onPointerFocus={nav.pointerFocus}
                  icon={<IconFolder size={14} color="var(--mantine-color-amber-5)" />}
                >
                  {lumg.calcs.map((calc) => (
                    <TreeNode
                      key={calc.id}
                      nodeKey={calcKey(calc.id)}
                      openMap={openMap}
                      onToggle={toggleNode}
                      label={calc.typeName ? `${calc.name} · ${calc.typeName}` : calc.name}
                      depth={2}
                      forceOpen={!!q}
                      onSelect={() =>
                        selectGroup({ kind: 'calc', id: calc.id, name: calc.name })
                      }
                      selected={isGroup('calc', calc.id)}
                      rowProps={nav.propsFor(calcKey(calc.id), { level: 3, selected: isGroup('calc', calc.id) })}
                      onPointerFocus={nav.pointerFocus}
                      icon={<IconCpu size={14} color="var(--mantine-color-steel-6)" />}
                    >
                      {calc.lines.map((line) => (
                        <LineRow
                          key={line.id}
                          line={line}
                          rowProps={nav.propsFor(lineKey(line), { level: 4, selected: lineId === line.id })}
                          onPointerFocus={nav.pointerFocus}
                        />
                      ))}
                    </TreeNode>
                  ))}
                  {lumg.virtualLines.map((line) => (
                    <LineRow
                      key={`v${line.id}`}
                      line={line}
                      rowProps={nav.propsFor(lineKey(line), { level: 3, selected: lineId === line.id })}
                      onPointerFocus={nav.pointerFocus}
                    />
                  ))}
                  {lumg.dpdLines.map((line) => (
                    <LineRow
                      key={`d${line.id}`}
                      line={line}
                      rowProps={nav.propsFor(lineKey(line), { level: 3, selected: lineId === line.id })}
                      onPointerFocus={nav.pointerFocus}
                    />
                  ))}
                </TreeNode>
              ))}
            </TreeNode>
          ))}
    </Box>
  )

  const search_input = (
    <TextInput
      ref={searchRef}
      placeholder={t('searchLinePlaceholder')}
      leftSection={<IconSearch size={15} />}
      value={search}
      onChange={(e) => setSearch(e.currentTarget.value)}
      size="sm"
      mb="xs"
      // ↓ hands the keyboard to the list, Enter takes the first line it found,
      // Esc clears the filter — so a search never has to end at the mouse.
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          if (rows.length > 0) nav.focusRow(rows[0].key)
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          const line = rows.find((r) => r.kind === 'line')
          if (line?.line) {
            nav.focusRow(line.key)
            selectLine(line.line.id, line.line.meta)
          }
          return
        }
        if (e.key === 'Escape' && search) {
          e.preventDefault()
          setSearch('')
        }
      }}
    />
  )

  if (isLoading) {
    return (
      <Center py={40}>
        <Loader size="sm" color="petrol" />
      </Center>
    )
  }

  // fill: occupy the parent's height with the list scrolling internally.
  if (fill) {
    return (
      <Box style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {search_input}
        <ScrollArea style={{ flex: 1, minHeight: 0 }} type="hover">
          {list}
        </ScrollArea>
        <SelectionInfo line={selectedLine} />
      </Box>
    )
  }

  return (
    <Box>
      {search_input}
      <ScrollArea.Autosize mah="calc(100dvh - 200px)" type="hover">
        {list}
      </ScrollArea.Autosize>
    </Box>
  )
}
