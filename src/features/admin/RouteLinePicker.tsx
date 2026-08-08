import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Collapse,
  Group,
  Modal,
  ScrollArea,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import {
  IconChevronRight,
  IconCpu,
  IconFolder,
  IconPlus,
  IconRipple,
  IconSearch,
} from '@tabler/icons-react'
import type { FreeLine } from '@/types'
import { LoadingState } from '@/components/LoadingState'
import { useAdminTopology } from './useAdminTopology'

export interface PickableLine {
  id: number
  name: string
}

interface Props {
  opened: boolean
  onClose: () => void
  branchId: number | null
  /** Lines of the branch no other route holds. */
  free: FreeLine[]
  loading?: boolean
  /** Already in the form — offered nowhere, so nothing can be added twice. */
  taken: number[]
  onAdd: (lines: PickableLine[]) => void
}

interface PickCalc {
  id: number
  name: string
  lines: PickableLine[]
}

interface PickLumg {
  id: number
  name: string
  calcs: PickCalc[]
  count: number
}

/**
 * Picking the lines of a route, laid out like the archive tree: ЛУМГ → ГРС →
 * лінія.
 *
 * A flat list was unusable at the sizes this actually runs at — a філія brings
 * dozens of lines whose names differ only at the end, with nothing to say which
 * ГРС they belong to. The tree puts that context in the structure instead of in
 * the name.
 *
 * Rows never wrap: the name is clamped to one line with the full text on hover
 * and the + is pinned to the right, so the button stays where the eye expects
 * it however long the name is.
 */
export function RouteLinePicker({
  opened,
  onClose,
  branchId,
  free,
  loading,
  taken,
  onAdd,
}: Props) {
  const { lumgs, calcs, lines, calcIdsOfBranch } = useAdminTopology()
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const q = search.trim().toLowerCase()
  const takenSet = useMemo(() => new Set(taken), [taken])
  const freeSet = useMemo(() => new Set(free.map((f) => f.id)), [free])

  /** ЛУМГ → ГРС → free lines, filtered by the search. */
  const tree = useMemo<PickLumg[]>(() => {
    if (branchId == null) return []
    const branchCalcs = new Set(calcIdsOfBranch(branchId))
    const linesByCalc = new Map<number, PickableLine[]>()
    for (const line of lines) {
      if (line.gas_volume_calc_id == null || !branchCalcs.has(line.gas_volume_calc_id)) continue
      if (!freeSet.has(line.id) || takenSet.has(line.id)) continue
      const name = line.name || `#${line.id}`
      if (!linesByCalc.has(line.gas_volume_calc_id)) linesByCalc.set(line.gas_volume_calc_id, [])
      linesByCalc.get(line.gas_volume_calc_id)!.push({ id: line.id, name })
    }

    const calcsByLumg = new Map<number, PickCalc[]>()
    for (const calc of calcs) {
      if (!branchCalcs.has(calc.id)) continue
      const calcName = calc.name || `#${calc.id}`
      const calcMatches = calcName.toLowerCase().includes(q)
      // A ГРС that matches the search keeps all its lines: the search is for
      // finding a place as often as for finding one line.
      const own = (linesByCalc.get(calc.id) ?? []).filter(
        (l) => !q || calcMatches || l.name.toLowerCase().includes(q) || String(l.id).includes(q),
      )
      if (own.length === 0) continue
      own.sort((a, b) => a.name.localeCompare(b.name, 'uk'))
      const lumgId = calc.lumg_id
      if (lumgId == null) continue
      if (!calcsByLumg.has(lumgId)) calcsByLumg.set(lumgId, [])
      calcsByLumg.get(lumgId)!.push({ id: calc.id, name: calcName, lines: own })
    }

    return lumgs
      .filter((l) => calcsByLumg.has(l.id))
      .map((l) => {
        const own = (calcsByLumg.get(l.id) ?? []).sort((a, b) =>
          a.name.localeCompare(b.name, 'uk'),
        )
        return {
          id: l.id,
          name: l.name || `ЛУМГ ${l.id}`,
          calcs: own,
          count: own.reduce((s, c) => s + c.lines.length, 0),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'uk'))
  }, [branchId, calcIdsOfBranch, calcs, lumgs, lines, freeSet, takenSet, q])

  const totalFree = tree.reduce((s, l) => s + l.count, 0)
  // Searching is pointless if it hides the thing you are looking for, so a
  // search opens everything it matched.
  const isOpen = (key: string) => (q ? true : !collapsed[key])
  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }))

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Додати лінії до маршруту"
      size="lg"
      centered
    >
      <TextInput
        placeholder="Пошук лінії або ГРС…"
        leftSection={<IconSearch size={15} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        data-autofocus
        mb="xs"
      />

      {loading ? (
        <LoadingState py={40} />
      ) : branchId == null ? (
        <Center py="lg">
          <Text size="sm" c="dimmed">
            Спершу оберіть філію
          </Text>
        </Center>
      ) : totalFree === 0 ? (
        <Center py="lg">
          <Text size="sm" c="dimmed" ta="center">
            {q
              ? 'Нічого не знайдено'
              : 'Немає вільних ліній — усі вже входять до інших маршрутів'}
          </Text>
        </Center>
      ) : (
        <ScrollArea.Autosize mah={420} type="auto">
          {tree.map((lumg) => (
            <Box key={lumg.id} mb={2}>
              <NodeRow
                icon={<IconFolder size={14} color="var(--mantine-color-amber-5)" />}
                label={lumg.name}
                count={lumg.count}
                open={isOpen(`l${lumg.id}`)}
                onToggle={() => toggle(`l${lumg.id}`)}
                onAddAll={() => onAdd(lumg.calcs.flatMap((c) => c.lines))}
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
                      onAddAll={() => onAdd(calc.lines)}
                      depth={1}
                    />
                    <Collapse expanded={isOpen(`c${calc.id}`)}>
                      {calc.lines.map((line) => (
                        <Group
                          key={line.id}
                          gap={6}
                          wrap="nowrap"
                          pl={52}
                          pr={6}
                          py={4}
                          className="hlv-picker-row"
                          style={{ borderRadius: 6, cursor: 'pointer' }}
                          onClick={() => onAdd([line])}
                        >
                          <IconRipple
                            size={13}
                            color="var(--mantine-color-steel-6)"
                            style={{ flexShrink: 0 }}
                          />
                          <Text size="sm" lineClamp={1} title={line.name} style={{ flex: 1 }}>
                            {line.name}
                          </Text>
                          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                            {line.id}
                          </Text>
                          {/* Pinned right and never wrapped — the click target
                              stays where the eye put it. */}
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="petrol"
                            style={{ flexShrink: 0 }}
                            aria-label={`Додати ${line.name}`}
                          >
                            <IconPlus size={14} />
                          </ActionIcon>
                        </Group>
                      ))}
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
          Вільних ліній: {totalFree}
        </Text>
        <Button size="xs" variant="subtle" onClick={onClose}>
          Готово
        </Button>
      </Group>
    </Modal>
  )
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
