import { useEffect, useState } from 'react'
import { ActionIcon, Popover, TextInput } from '@mantine/core'
import { DatePicker } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import { DATE_FORMAT_HINT, parseTypedDate } from './deviceHistoryForm'

interface Props {
  label: string
  /** `YYYY-MM-DD`, or '' for "not set". */
  value: string
  onChange: (value: string) => void
  /** Shown when the field is empty — here that state means something. */
  placeholder?: string
  width?: number
}

/** `YYYY-MM-DD` → what the field shows. */
function toText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

/**
 * Digits in, `дд.мм.рррр` out.
 *
 * The separators are put in by the field, not by the person typing: eight bare
 * digits are the fastest thing to type and the hardest thing to read back, and
 * a wrong `10102025` goes unnoticed in a way a wrong `10.10.2025` does not.
 * Everything that is not a digit is dropped, so a pasted `10/10/2025` and a
 * typed `10102025` arrive at the same text — and a slash can never be read as
 * a separator whose meaning depends on the country.
 */
function mask(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)]
  return parts.filter((p) => p !== '').join('.')
}

/**
 * A date field where typing only aims the calendar, and the calendar decides.
 *
 * Typing does not set the date: it moves the calendar to that day and marks it,
 * and a click confirms. That is what makes the format stop mattering — a
 * half-typed or nonsensical date simply aims at nothing, instead of being
 * guessed at and saved. It also removes the trap in `@mantine/dates`'
 * `DateInput`, where clicking the day already selected DESELECTS it, so typing
 * a date and clicking it to confirm cleared the field.
 *
 * Emptying the text is the one thing that does commit, because an empty field
 * is not a date to be confirmed — it is the absence of one, which here means
 * «стоїть від початку» / «не знято».
 */
export function DateField({ label, value, onChange, placeholder, width = 150 }: Props) {
  const [text, setText] = useState(() => toText(value))
  const [opened, setOpened] = useState(false)

  // Follow the value when it changes from the outside: a different row, a form
  // reset, a click in the calendar.
  useEffect(() => {
    setText(toText(value))
  }, [value])

  /** The day the calendar points at: what is being typed, else what is set. */
  const aimed = parseTypedDate(text) ?? (value || null)

  // The displayed month follows what is typed but stays steerable by hand:
  // fully controlling it would pin the calendar to `aimed` and leave the month
  // arrows dead.
  const [viewDate, setViewDate] = useState<string | undefined>(value || undefined)
  useEffect(() => {
    if (aimed) setViewDate(aimed)
  }, [aimed])

  const close = () => {
    setOpened(false)
    // Never leave the field showing a date that was never confirmed — the
    // record would hold something else than the person is reading.
    setText(toText(value))
  }

  return (
    <Popover
      opened={opened}
      onChange={(o) => (o ? setOpened(true) : close())}
      position="bottom-start"
      withinPortal
      // Above the modal it is opened from — the history window sits at 200+.
      zIndex={500}
      shadow="md"
      transitionProps={{ duration: 0 }}
    >
      <Popover.Target>
        <TextInput
          label={label}
          size="xs"
          w={width}
          value={text}
          placeholder={placeholder ?? DATE_FORMAT_HINT}
          title="Наберіть дату, щоб знайти її в календарі, і оберіть у календарі"
          onFocus={() => setOpened(true)}
          onChange={(e) => {
            const next = mask(e.currentTarget.value)
            setText(next)
            setOpened(true)
            if (next === '') onChange('')
          }}
          rightSection={
            <ActionIcon
              variant="subtle"
              size="sm"
              aria-label="Календар"
              onClick={() => setOpened((o) => !o)}
            >
              <IconCalendar size={15} />
            </ActionIcon>
          }
        />
      </Popover.Target>
      <Popover.Dropdown
        p="sm"
        style={{ background: 'var(--hlv-surface)', border: '1px solid var(--hlv-border)' }}
      >
        <DatePicker
          value={aimed}
          /* Without this the calendar opens on the current month whatever is
             selected — `value` alone does not move the view, and following the
             typing is the whole point of the field. */
          date={viewDate}
          onDateChange={setViewDate}
          onChange={(v) => {
            if (!v) return // a click on the marked day confirms it, never clears
            onChange(v)
            setOpened(false)
          }}
          size="sm"
        />
      </Popover.Dropdown>
    </Popover>
  )
}
