import { Chip, Group, Input, Stack, Text, TextInput } from '@mantine/core'
import { CRON_PRESETS, cronError, describeCron } from '@/domain/cronSchedule'

/**
 * When a device is polled, as cron — with the usual rhythms one click away.
 *
 * It replaced a list of hours, which was two scrolling lists and a row of
 * badges: fine for "twice a day", awful for "every hour", which meant adding
 * twenty-four slots by hand. The presets cover what the fleet is actually set
 * to; the field underneath takes anything cron takes, for the schedules that
 * are not a daily rhythm at all — weekdays only, a day of the month.
 *
 * The expression is read back in words as it is typed. The server refuses what
 * it cannot parse, but a field that only says so after «Зберегти» is one
 * people stop trusting.
 */
export interface PollCronFieldProps {
  /** The expression, or empty to follow the schedule set globally. */
  value: string
  onChange: (next: string) => void
  /** Off when the device is not polled on a schedule. */
  disabled?: boolean
}

export function PollCronField({ value, onChange, disabled }: PollCronFieldProps) {
  const problem = cronError(value)
  const words = describeCron(value)
  const preset = CRON_PRESETS.find((p) => p.value === value.trim())

  return (
    <Input.Wrapper
      label="Коли опитувати"
      size="xs"
      description="Порожньо — за загальним розкладом"
    >
      <Stack gap={6} mt={4}>
        <Group gap={4}>
          {CRON_PRESETS.map((option) => (
            <Chip
              key={option.value}
              size="xs"
              radius="sm"
              checked={preset?.value === option.value}
              disabled={disabled}
              onChange={() =>
                onChange(preset?.value === option.value ? '' : option.value)
              }
            >
              {option.label}
            </Chip>
          ))}
        </Group>
        <TextInput
          size="xs"
          w={260}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.currentTarget.value)}
          placeholder="0 8 * * *"
          error={problem}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
        />
        {!problem && (
          <Text size="11px" c={value.trim() ? 'petrol' : 'dimmed'}>
            {words}
          </Text>
        )}
      </Stack>
    </Input.Wrapper>
  )
}
