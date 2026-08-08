import { Group, Menu, Text, Tooltip, UnstyledButton } from '@mantine/core'
import {
  IconMathAvg,
  IconMathMax,
  IconMathMin,
  IconSum,
} from '@tabler/icons-react'
import { AGGREGATES, AGGREGATE_LABELS, type Aggregate } from '@/domain/aggregate'

/** The mode's mark in the footer: a glyph, not a word — it sits in a data cell. */
const AGGREGATE_ICONS: Record<Aggregate, typeof IconSum> = {
  sum: IconSum,
  avg: IconMathAvg,
  max: IconMathMax,
  min: IconMathMin,
}

/**
 * One footer cell: the folded value, marked with how it was folded, and the
 * mark is the way to change it. Per column, because a row that sums volumes
 * and averages pressure is the only row that means anything.
 *
 * Shared by the archive tables and «Звірка ФХП», which need the same footer
 * for different columns.
 */
export function AggregateCell({
  value,
  how,
  onPick,
  t,
}: {
  value: string
  how: Aggregate
  onPick: (how: Aggregate) => void
  t: (key: string) => string
}) {
  const Icon = AGGREGATE_ICONS[how]
  return (
    <Menu shadow="md" position="top" withinPortal>
      <Menu.Target>
        <Tooltip label={`${t(AGGREGATE_LABELS[how])} — ${t('aggregateChange')}`} withArrow>
          <UnstyledButton aria-label={t(AGGREGATE_LABELS[how])} style={{ width: '100%' }}>
            <Group gap={4} justify="center" wrap="nowrap">
              <Icon size={13} stroke={1.8} style={{ color: 'var(--mantine-color-dimmed)' }} />
              <Text fw={700} size="sm">
                {value}
              </Text>
            </Group>
          </UnstyledButton>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        {AGGREGATES.map((key) => {
          const ItemIcon = AGGREGATE_ICONS[key]
          return (
            <Menu.Item
              key={key}
              leftSection={<ItemIcon size={14} stroke={1.8} />}
              onClick={() => onPick(key)}
              fw={key === how ? 700 : undefined}
            >
              {t(AGGREGATE_LABELS[key])}
            </Menu.Item>
          )
        })}
      </Menu.Dropdown>
    </Menu>
  )
}
