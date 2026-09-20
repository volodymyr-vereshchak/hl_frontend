import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Code,
  Divider,
  Group,
  List,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconHelpCircle } from '@tabler/icons-react'
import { cronError, describeCron, nextRuns } from '@/domain/cronSchedule'

/**
 * The cron field explained, in a window beside the field itself.
 *
 * Cron is five numbers and four symbols, and anybody who has not written one
 * this month has to look them up. Sending an operator to a search engine for
 * that is how a schedule ends up as «0 8 * * *» forever — so the reference is
 * here, with the examples clickable: reading what a step means and typing one
 * correctly are two different tasks, and the second is the one that goes wrong.
 *
 * What no general cron reference has, and what matters more than the syntax,
 * is the second half: what this scheduler does with the expression. A missed
 * slot is not lost, a failed call is retried three times, the archive is
 * hourly so a schedule finer than an hour buys nothing.
 */

export const CRON_EXAMPLES: Array<{ cron: string; what: string }> = [
  { cron: '0 * * * *', what: 'Щогодини, рівно о :00' },
  { cron: '30 * * * *', what: 'Щогодини, о :30' },
  { cron: '0 */4 * * *', what: 'Кожні 4 години: 00:00, 04:00, 08:00 …' },
  { cron: '0 8 * * *', what: 'Щодня о 08:00' },
  { cron: '0 8,20 * * *', what: 'Двічі на добу — о 08:00 і 20:00' },
  { cron: '0 7-19 * * *', what: 'Щогодини з 07:00 до 19:00' },
  { cron: '0 7 * * 1-5', what: 'Будні (пн–пт) о 07:00' },
  { cron: '0 9 * * 1', what: 'Щопонеділка о 09:00' },
  { cron: '0 6 1 * *', what: 'Першого числа кожного місяця о 06:00' },
]

const SYMBOLS: Array<{ sign: string; name: string; example: string }> = [
  { sign: '*', name: 'будь-яке значення', example: '* у полі години — щогодини' },
  { sign: ',', name: 'перелік', example: '8,20 — о восьмій і о двадцятій' },
  { sign: '-', name: 'діапазон', example: '7-19 — з сьомої до дев’ятнадцятої' },
  { sign: '/', name: 'крок', example: '*/4 — кожні чотири: 0, 4, 8 …' },
]

const DIAGRAM = [
  '┌───────────── хвилина     (0–59)',
  '│ ┌─────────── година      (0–23)',
  '│ │ ┌───────── день місяця (1–31)',
  '│ │ │ ┌─────── місяць      (1–12)',
  '│ │ │ │ ┌───── день тижня  (0–6, неділя = 0 або 7)',
  '│ │ │ │ │',
  '0 8 * * *     ← щодня о 08:00',
].join('\n')

/** A fire time as an operator reads it: «пн, 21.09 08:00». */
function whenText(when: Date): string {
  const day = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][when.getDay()]
  const date = `${pad(when.getDate())}.${pad(when.getMonth() + 1)}`
  return `${day} ${date} ${pad(when.getHours())}:${pad(when.getMinutes())}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export interface CronHelpButtonProps {
  /** What the form holds now — the try-it field opens on it. */
  value?: string
  /** Filling the field from the window — the half of the help that is not text. */
  onPick?: (cron: string) => void
  disabled?: boolean
}

export function CronHelpButton({ value = '', onPick, disabled }: CronHelpButtonProps) {
  const [opened, { open, close }] = useDisclosure(false)
  // The try-it field starts from whatever the form already holds, so the first
  // question — «а що зараз стоїть і коли воно дзвонить» — is answered by
  // opening the window.
  const [draft, setDraft] = useState(value)
  const draftProblem = cronError(draft)
  const runs = useMemo(
    () => (draftProblem ? [] : nextRuns(draft, new Date(), 5)),
    [draft, draftProblem],
  )

  const show = () => {
    setDraft(value)
    open()
  }

  const pick = (cron: string) => {
    onPick?.(cron)
    close()
  }

  return (
    <>
      <Tooltip label="Як записати розклад" withArrow>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label="Довідка про cron-вирази"
          onClick={show}
        >
          <IconHelpCircle size={15} />
        </ActionIcon>
      </Tooltip>

      <Modal
        opened={opened}
        onClose={close}
        title="Розклад опитування — cron-вираз"
        size="lg"
        radius="md"
      >
        <Stack gap="sm">
          <Text size="sm">
            Розклад записується одним рядком із п’яти полів, розділених
            пробілами. Кожне поле — про свою одиницю часу:
          </Text>

          <Code block style={{ lineHeight: 1.45 }}>
            {DIAGRAM}
          </Code>

          <Table withTableBorder withColumnBorders verticalSpacing={4} fz="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={60}>Знак</Table.Th>
                <Table.Th w={170}>Що означає</Table.Th>
                <Table.Th>Приклад</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {SYMBOLS.map((s) => (
                <Table.Tr key={s.sign}>
                  <Table.Td>
                    <Code>{s.sign}</Code>
                  </Table.Td>
                  <Table.Td>{s.name}</Table.Td>
                  <Table.Td c="dimmed">{s.example}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          <Divider
            label="Приклади — натисніть, щоб приміряти"
            labelPosition="left"
          />

          <Table verticalSpacing={4} fz="xs" highlightOnHover>
            <Table.Tbody>
              {CRON_EXAMPLES.map((e) => (
                <Table.Tr
                  key={e.cron}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setDraft(e.cron)}
                >
                  <Table.Td w={150}>
                    <Badge
                      variant="light"
                      color="petrol"
                      radius="sm"
                      tt="none"
                      styles={{
                        label: { fontFamily: 'var(--mantine-font-family-monospace)' },
                      }}
                    >
                      {e.cron}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{e.what}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          <Divider label="Як це працює тут" labelPosition="left" />

          <List size="xs" spacing={4}>
            <List.Item>
              <b>Порожнє поле</b> — прилад опитується за загальним розкладом
              (Адміністрування → Опитування → Розклад).
            </List.Item>
            <List.Item>
              Слот, який минув, поки машина була вимкнена, <b>не зникає</b>:
              агент, що вийде на зв’язок пізніше, побачить прилад як
              прострочений і подзвонить. Сервер дивиться назад на три доби.
            </List.Item>
            <List.Item>
              Якщо дзвінок не вдався, прилад перенабирається ще <b>двічі з
              паузою 15 хвилин</b>, після чого чекає наступного слота — щоб
              одна недоступна лінія не тримала модем цілу ніч.
            </List.Item>
            <List.Item>
              Архів у приладах <b>годинний</b>, тому розклад дрібніший за
              годину нічого не додає: о :15 і о :45 буде прочитано те саме.
            </List.Item>
            <List.Item>
              Неділя — це <Code>0</Code> або <Code>7</Code>; назви теж
              приймаються: <Code>0 7 * * mon-fri</Code>.
            </List.Item>
            <List.Item>
              Якщо задано <b>і</b> день місяця, <b>і</b> день тижня, спрацює
              кожен із них окремо (правило cron: «або»), а не лише їх збіг.
            </List.Item>
            <List.Item>
              Дзвінок починається протягом хвилини-двох після слота: агент
              перепитує сервер не щосекунди, та й модем має додзвонитися.
            </List.Item>
          </List>

          <Divider label="Перевірити вираз" labelPosition="left" />

          <Text size="xs" c="dimmed">
            Впишіть вираз — нижче видно, коли він спрацює. Рахується тут, у
            браузері, тими самими правилами, що й на сервері: інтернет для
            цього не потрібен.
          </Text>

          <Group gap="xs" align="flex-start" wrap="nowrap">
            <TextInput
              size="xs"
              w={200}
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              placeholder="0 8 * * *"
              error={draftProblem}
              styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
            />
            {onPick && (
              <Button
                size="compact-sm"
                variant="light"
                disabled={disabled || !!draftProblem || !draft.trim()}
                onClick={() => pick(draft.trim())}
              >
                Підставити в розклад
              </Button>
            )}
          </Group>

          {draft.trim() && !draftProblem && (
            <Stack gap={2}>
              <Text size="xs" fw={500}>
                {describeCron(draft)}
              </Text>
              {runs.length > 0 ? (
                <Text size="xs" c="dimmed">
                  Найближчі спрацювання: {runs.map(whenText).join(' · ')}
                </Text>
              ) : (
                <Text size="xs" c="red">
                  Найближчого року такого моменту не буде — перевірте день і
                  місяць.
                </Text>
              )}
            </Stack>
          )}

          <Text size="xs" c="dimmed">
            Планувальник читає рівно п’ять полів і не підтримує ні скорочень на
            кшталт <Code>@daily</Code>, ні секунд. Ця довідка зібрана в самій
            програмі — на сервері без інтернету вона працює так само.
          </Text>
        </Stack>
      </Modal>
    </>
  )
}
