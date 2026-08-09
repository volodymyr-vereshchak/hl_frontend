import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
  Collapse,
  Group,
  Modal,
  ScrollArea,
  Switch,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import {
  IconBuildingCommunity,
  IconChevronRight,
  IconCpu,
  IconFolder,
  IconPlus,
  IconSearch,
  IconTargetArrow,
} from '@tabler/icons-react'
import { LoadingState } from '@/components/LoadingState'
import type { StoredSelection } from '@/domain/lineComparisonSelection'
import { addMany, isSelected, promoteToMain, toggleLine } from '@/domain/lineComparisonSelection'
import { useTreeData, type TreeBranch } from '@/features/archive/useTreeData'
import { normalizeUnit } from '@/domain/pressureUnits'

interface Props {
  opened: boolean
  onClose: () => void
  /** The report's branch; the picker starts scoped to it. */
  branchId: number | null
  selection: StoredSelection
  onChange: (next: StoredSelection) => void
}

interface PickLine {
  id: number
  name: string
  unit: string | null
}
interface PickCalc {
  id: number
  name: string
  lines: PickLine[]
}
interface PickLumg {
  id: number
  name: string
  branchName: string
  calcs: PickCalc[]
  count: number
}

/**
 * Choosing the main line and its duplicates, laid out like the archive tree:
 * ЛУМГ → ГРС → лінія.
 *
 * Sourced from `useTreeData` rather than `useAdminTopology` — that is what
 * makes it usable on a report page, where the viewer has no admin reads.
 *
 * PHYSICAL lines only: кільця carry volume but no pressure or temperature, and
 * ДПД lines come from other endpoints with their unit in the row, so neither
 * can be compared against a physical line.
 */
export function LineComparisonPicker({
  opened,
  onClose,
  branchId,
  selection,
  onChange,
}: Props) {
  const { data: tree, isLoading } = useTreeData()
  const [search, setSearch] = useState('')
  const [allBranches, setAllBranches] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const q = search.trim().toLowerCase()

  const lumgs = useMemo<PickLumg[]>(
    () => buildTree(tree, allBranches ? null : branchId, q),
    [tree, allBranches, branchId, q],
  )

  const total = lumgs.reduce((s, l) => s + l.count, 0)
  // A search that hides what it matched is useless, so it opens everything.
  const isOpen = (key: string) => (q ? true : !collapsed[key])
  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }))

  const dupCount = selection.duplicateIds.length

  return (
    <Modal opened={opened} onClose={onClose} title="Лінії для порівняння" size="lg" centered>
      <Group gap="sm" mb="xs" wrap="nowrap">
        <TextInput
          placeholder="Пошук лінії або ГРС…"
          leftSection={<IconSearch size={15} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          data-autofocus
          style={{ flex: 1 }}
        />
        <Switch
          size="xs"
          label="Усі філії"
          checked={allBranches}
          onChange={(e) => setAllBranches(e.currentTarget.checked)}
        />
      </Group>

      <Text size="xs" c="dimmed" mb={6}>
        Позначте лінії прапорцем, а мішенню — ту, що буде основою. Решта звіряється з нею
      </Text>

      {isLoading ? (
        <LoadingState py={40} />
      ) : total === 0 ? (
        <Center py="lg">
          <Text size="sm" c="dimmed" ta="center">
            {q ? 'Нічого не знайдено' : 'Немає доступних ліній'}
          </Text>
        </Center>
      ) : (
        <ScrollArea.Autosize mah={420} type="auto">
          {lumgs.map((lumg) => (
            <Box key={lumg.id} mb={2}>
              <NodeRow
                icon={
                  allBranches ? (
                    <IconBuildingCommunity size={14} color="var(--mantine-color-petrol-5)" />
                  ) : (
                    <IconFolder size={14} color="var(--mantine-color-amber-5)" />
                  )
                }
                label={allBranches ? `${lumg.branchName} · ${lumg.name}` : lumg.name}
                count={lumg.count}
                open={isOpen(`l${lumg.id}`)}
                onToggle={() => toggle(`l${lumg.id}`)}
                onAddAll={() =>
                  onChange(addMany(selection, lumg.calcs.flatMap((c) => c.lines.map((x) => x.id))))
                }
                depth={0}
              />
              <Collapse expanded={isOpen(`l${lumg.id}`)}>
                {lumg.calcs.map((calc) => (
                  <Box key={calc.id}>
                    <NodeRow
                      icon={<IconCpu size={14} color="var(--mantine-color-steel-6)" />}
                      label={calc.name}
                      count={calc.lines.length}
                      open={isOpen(`c${calc.id}`)}
                      onToggle={() => toggle(`c${calc.id}`)}
                      onAddAll={() => onChange(addMany(selection, calc.lines.map((x) => x.id)))}
                      depth={1}
                    />
                    <Collapse expanded={isOpen(`c${calc.id}`)}>
                      {calc.lines.map((line) => {
                        const chosen = isSelected(selection, line.id)
                        const main = selection.mainId === line.id
                        return (
                          <Group
                            key={line.id}
                            gap={8}
                            wrap="nowrap"
                            pl={52}
                            pr={6}
                            py={4}
                            className="hlv-picker-row"
                            style={{
                              borderRadius: 6,
                              background: main
                                ? 'var(--mantine-color-petrol-light)'
                                : undefined,
                            }}
                          >
                            <Checkbox
                              size="xs"
                              checked={chosen}
                              onChange={() => onChange(toggleLine(selection, line.id))}
                              style={{ flexShrink: 0 }}
                              aria-label={`Порівнювати ${line.name}`}
                            />
                            <Text
                              size="sm"
                              lineClamp={1}
                              title={line.name}
                              style={{ flex: 1, minWidth: 0 }}
                              onClick={() => onChange(toggleLine(selection, line.id))}
                            >
                              {line.name}
                            </Text>
                            {line.unit && line.unit !== 'кгс/см²' && (
                              <Badge size="xs" variant="light" color="grape" style={{ flexShrink: 0 }}>
                                {line.unit}
                              </Badge>
                            )}
                            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                              {line.id}
                            </Text>
                            <Tooltip label={main ? 'Це основа' : 'Зробити основою'} withArrow>
                              <ActionIcon
                                size="sm"
                                variant={main ? 'filled' : 'subtle'}
                                color="petrol"
                                style={{ flexShrink: 0 }}
                                onClick={() => onChange(promoteToMain(selection, line.id))}
                                aria-label={`Зробити основою: ${line.name}`}
                              >
                                <IconTargetArrow size={14} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        )
                      })}
                    </Collapse>
                  </Box>
                ))}
              </Collapse>
            </Box>
          ))}
        </ScrollArea.Autosize>
      )}

      <Group justify="space-between" mt="sm">
        <Text size="xs" c="dimmed">
          {selection.mainId == null
            ? 'Основу не обрано'
            : `Обрано: основа + ${dupCount} ${dupCount === 1 ? 'дубль' : 'дублів'}`}
        </Text>
        <Button size="xs" variant="subtle" onClick={onClose}>
          Готово
        </Button>
      </Group>
    </Modal>
  )
}

function buildTree(
  tree: TreeBranch[] | undefined,
  branchId: number | null,
  q: string,
): PickLumg[] {
  const out: PickLumg[] = []
  for (const branch of tree ?? []) {
    if (branchId != null && branch.id !== branchId) continue
    for (const lumg of branch.lumgs) {
      const calcs: PickCalc[] = []
      for (const calc of lumg.calcs) {
        const calcMatches = calc.name.toLowerCase().includes(q)
        const lines = calc.lines
          .filter((l) => l.kind === 'physical')
          .filter(
            (l) =>
              !q ||
              calcMatches ||
              l.name.toLowerCase().includes(q) ||
              String(l.id).includes(q),
          )
          .map((l) => ({
            id: l.id,
            name: l.name,
            unit: normalizeUnit(l.meta?.pressure_unit),
          }))
        if (lines.length > 0) calcs.push({ id: calc.id, name: calc.name, lines })
      }
      if (calcs.length > 0) {
        out.push({
          id: lumg.id,
          name: lumg.name,
          branchName: branch.name,
          calcs,
          count: calcs.reduce((s, c) => s + c.lines.length, 0),
        })
      }
    }
  }
  return out
}

/** ЛУМГ or ГРС row: folds its children and can add all of them at once. */
function NodeRow({
  icon,
  label,
  count,
  open,
  onToggle,
  onAddAll,
  depth,
}: {
  icon: React.ReactNode
  label: string
  count: number
  open: boolean
  onToggle: () => void
  onAddAll: () => void
  depth: number
}) {
  return (
    <Group gap={4} wrap="nowrap" pl={8 + depth * 16} pr={6} style={{ borderRadius: 6 }}>
      <UnstyledButton
        onClick={onToggle}
        py={5}
        style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}
      >
        <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <IconChevronRight
            size={13}
            style={{
              flexShrink: 0,
              transform: open ? 'rotate(90deg)' : 'none',
              transition: 'transform 150ms',
            }}
          />
          {icon}
          <Text size="sm" fw={600} lineClamp={1} title={label} style={{ flex: 1 }}>
            {label}
          </Text>
          <Badge size="xs" variant="default" style={{ flexShrink: 0 }}>
            {count}
          </Badge>
        </Group>
      </UnstyledButton>
      <Tooltip label="Додати всі" withArrow>
        <ActionIcon
          size="sm"
          variant="light"
          color="petrol"
          onClick={onAddAll}
          style={{ flexShrink: 0 }}
          aria-label={`Додати всі лінії: ${label}`}
        >
          <IconPlus size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  )
}
