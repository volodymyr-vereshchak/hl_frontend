import { useMemo, useState } from 'react'
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
import { useSelectionStore } from '@/store/selectionStore'
import { useTreeData, type TreeLine } from './useTreeData'

function LineRow({ line }: { line: TreeLine }) {
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
      onClick={() => selectLine(line.id, line.meta)}
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
        <Text size="sm" fw={active ? 600 : 400} c={active ? 'petrol' : undefined} lineClamp={1}>
          {line.name}
        </Text>
        {badge}
      </Group>
    </UnstyledButton>
  )
}

interface NodeProps {
  label: string
  icon: React.ReactNode
  depth: number
  count?: number
  defaultOpen?: boolean
  forceOpen?: boolean
  children: React.ReactNode
}

function TreeNode({ label, icon, depth, count, defaultOpen, forceOpen, children }: NodeProps) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const isOpen = forceOpen || open
  return (
    <Box>
      <UnstyledButton
        onClick={() => setOpen((o) => !o)}
        pl={8 + depth * 16}
        pr="xs"
        py={6}
        w="100%"
        style={{ borderRadius: 6 }}
      >
        <Group gap={6} wrap="nowrap">
          <IconChevronRight
            size={14}
            style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
          />
          {icon}
          <Text size="sm" fw={600} lineClamp={1} style={{ flex: 1 }}>
            {label}
          </Text>
          {count != null && (
            <Badge size="xs" variant="default">
              {count}
            </Badge>
          )}
        </Group>
      </UnstyledButton>
      <Collapse expanded={isOpen}>{children}</Collapse>
    </Box>
  )
}

export function TreeView({ fill = false }: { fill?: boolean } = {}) {
  const { data, isLoading } = useTreeData()
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()

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

  const list = (
    <>
      {filtered.map((branch) => (
            <TreeNode
              key={branch.id}
              label={branch.name}
              depth={0}
              defaultOpen
              forceOpen={!!q}
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
                  label={lumg.name}
                  depth={1}
                  forceOpen={!!q}
                  icon={<IconFolder size={14} color="var(--mantine-color-amber-5)" />}
                >
                  {lumg.calcs.map((calc) => (
                    <TreeNode
                      key={calc.id}
                      label={calc.typeName ? `${calc.name} · ${calc.typeName}` : calc.name}
                      depth={2}
                      forceOpen={!!q}
                      icon={<IconCpu size={14} color="var(--mantine-color-steel-6)" />}
                    >
                      {calc.lines.map((line) => (
                        <LineRow key={line.id} line={line} />
                      ))}
                    </TreeNode>
                  ))}
                  {lumg.virtualLines.map((line) => (
                    <LineRow key={`v${line.id}`} line={line} />
                  ))}
                  {lumg.dpdLines.map((line) => (
                    <LineRow key={`d${line.id}`} line={line} />
                  ))}
                </TreeNode>
              ))}
            </TreeNode>
          ))}
    </>
  )

  const search_input = (
    <TextInput
      placeholder="Пошук лінії..."
      leftSection={<IconSearch size={15} />}
      value={search}
      onChange={(e) => setSearch(e.currentTarget.value)}
      size="sm"
      mb="xs"
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
