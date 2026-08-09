import { ActionIcon, Badge, Box, Group, Text, Tooltip } from '@mantine/core'
import { IconTargetArrow, IconX } from '@tabler/icons-react'
import type { ResolvedLine } from '@/domain/lineComparisonSelection'

interface Props {
  main: ResolvedLine | null
  duplicates: ResolvedLine[]
  /** Chart colour of each duplicate, so the strip and the plot agree. */
  colorOf: (index: number) => string
  onPromote: (id: number) => void
  onRemove: (id: number) => void
}

/**
 * The current selection as chips: the main line, then the duplicates in the
 * colours they carry on the chart.
 *
 * The modal builds the set; this strip is for working with it — swapping which
 * line is the baseline is one click here, and that is the question this report
 * gets asked most («а якщо еталоном вважати другу?»).
 */
export function SelectedLinesBar({ main, duplicates, colorOf, onPromote, onRemove }: Props) {
  if (!main && duplicates.length === 0) return null

  return (
    <Group gap={6} wrap="wrap" style={{ minWidth: 0 }}>
      {main && (
        <Tooltip label={context(main)} withArrow>
          <Badge
            size="lg"
            variant="filled"
            color="petrol"
            leftSection={<IconTargetArrow size={12} />}
            rightSection={
              <ActionIcon
                size="xs"
                variant="transparent"
                color="white"
                onClick={() => onRemove(main.id)}
                aria-label={`Прибрати ${main.name}`}
              >
                <IconX size={11} />
              </ActionIcon>
            }
            style={{ textTransform: 'none' }}
          >
            {main.name}
          </Badge>
        </Tooltip>
      )}

      {duplicates.map((line, i) => (
        <Tooltip key={line.id} label={`${context(line)} · клік — зробити основою`} withArrow>
          <Badge
            size="lg"
            variant="light"
            color="gray"
            leftSection={
              <Box
                w={8}
                h={8}
                style={{ borderRadius: 2, background: colorOf(i), display: 'inline-block' }}
              />
            }
            rightSection={
              <ActionIcon
                size="xs"
                variant="transparent"
                color="gray"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(line.id)
                }}
                aria-label={`Прибрати ${line.name}`}
              >
                <IconX size={11} />
              </ActionIcon>
            }
            style={{ textTransform: 'none', cursor: 'pointer' }}
            onClick={() => onPromote(line.id)}
          >
            {line.name}
          </Badge>
        </Tooltip>
      ))}

      {!main && (
        <Text size="xs" c="orange">
          Оберіть основну лінію
        </Text>
      )}
    </Group>
  )
}

function context(line: ResolvedLine): string {
  return [line.calcName, line.lumgName, line.branchName].filter(Boolean).join(' · ')
}
