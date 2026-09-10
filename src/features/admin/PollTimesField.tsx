import { useState } from 'react'
import { ActionIcon, Badge, Group, Select, Stack, Text } from '@mantine/core'
import { IconPlus, IconX } from '@tabler/icons-react'

/**
 * The hours a device is polled at: two scrolling lists and a list of slots.
 *
 * Typed as free text before, which is how "6", "06.00" and "25:00" got in — a
 * slot that is not an hour is one the agent silently never reaches, and nothing
 * on screen would have said so. Picking from lists removes the whole class.
 *
 * Minutes step by five. A corrector's archive is hourly and the poll takes
 * minutes to run, so a one-minute choice is precision nobody can use and sixty
 * entries to scroll past.
 *
 * Disabled when the schedule is off, because hours mean nothing then — and an
 * editable field that changes nothing is worse than a greyed one.
 */
const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h).padStart(2, '0'),
  label: String(h).padStart(2, '0'),
}))

const MINUTES = Array.from({ length: 12 }, (_, i) => ({
  value: String(i * 5).padStart(2, '0'),
  label: String(i * 5).padStart(2, '0'),
}))

export interface PollTimesFieldProps {
  /** Slots already chosen, as "HH:MM". */
  value: string[]
  onChange: (next: string[]) => void
  /** Off when the device is not polled on a schedule. */
  disabled?: boolean
}

export function PollTimesField({ value, onChange, disabled }: PollTimesFieldProps) {
  const [hour, setHour] = useState<string | null>('06')
  const [minute, setMinute] = useState<string | null>('00')

  const add = () => {
    if (!hour || !minute) return
    const slot = `${hour}:${minute}`
    // A slot twice is one slot, and the agent would otherwise count it twice.
    if (value.includes(slot)) return
    onChange([...value, slot].sort())
  }

  const remove = (slot: string) => onChange(value.filter((s) => s !== slot))

  return (
    <Stack gap={6}>
      <Group gap={6} align="flex-end" wrap="nowrap">
        <Select
          data={HOURS}
          value={hour}
          onChange={setHour}
          disabled={disabled}
          size="xs"
          w={78}
          label="Год."
          maxDropdownHeight={220}
          comboboxProps={{ withinPortal: true, zIndex: 400 }}
        />
        <Text size="sm" pb={6}>
          :
        </Text>
        <Select
          data={MINUTES}
          value={minute}
          onChange={setMinute}
          disabled={disabled}
          size="xs"
          w={78}
          label="Хв."
          maxDropdownHeight={220}
          comboboxProps={{ withinPortal: true, zIndex: 400 }}
        />
        <ActionIcon
          variant="light"
          size="lg"
          onClick={add}
          disabled={disabled}
          aria-label="Додати час"
        >
          <IconPlus size={16} />
        </ActionIcon>
      </Group>

      {value.length > 0 ? (
        <Group gap={6}>
          {value.map((slot) => (
            <Badge
              key={slot}
              size="sm"
              variant="light"
              rightSection={
                !disabled && (
                  <IconX
                    size={12}
                    style={{ cursor: 'pointer', display: 'block' }}
                    onClick={() => remove(slot)}
                  />
                )
              }
            >
              {slot}
            </Badge>
          ))}
        </Group>
      ) : (
        <Text size="xs" c="dimmed">
          {disabled
            ? 'Опитування за розкладом вимкнено'
            : 'Не задано — використовуються загальні години'}
        </Text>
      )}
    </Stack>
  )
}
