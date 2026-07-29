import { Group } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import { useLanguage } from '@/locales/LanguageContext'
import { getContractHour } from '@/domain/commercialDay'
import { HourDateTimePicker } from './HourDateTimePicker'

interface Props {
  /** Daily/param archives pick whole days; hourly and event archives need time. */
  withTime: boolean
  from: string
  to: string
  onChange: (next: { from: string; to: string }) => void
  /** Locked while a report is being built — the period is part of what is
   *  being computed, so it must not move mid-run. */
  disabled?: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')

function todayDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDaysStr(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + delta))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/**
 * Period selector. Mantine v9 dates are strings: "YYYY-MM-DD HH:mm:ss" with
 * time, "YYYY-MM-DD" without. Locale comes from DatesProvider.
 *
 * The "today" preset is inside each picker's dropdown (not a separate button):
 * for time-enabled archives it lands on the commercial-day bounds — the start
 * picker on today CONTRACT_HOUR:00, the end picker on the next day's
 * (CONTRACT_HOUR-1):00, i.e. the default 07:00 → 06:00 window.
 */
export function PeriodPicker({ withTime, from, to, onChange, disabled }: Props) {
  const { t } = useLanguage()
  const h = getContractHour()
  const today = todayDate()

  const common = {
    leftSection: <IconCalendar size={15} />,
    size: 'xs' as const,
    popoverProps: { zIndex: 500, withinPortal: true },
    disabled,
  }

  if (!withTime) {
    const preset = [{ value: today, label: t('today') }]
    return (
      <Group gap="xs" wrap="nowrap">
        <DatePickerInput
          {...common}
          aria-label={t('from')}
          value={from}
          onChange={(v) => v && onChange({ from: v, to })}
          valueFormat="DD.MM.YYYY"
          presets={preset}
          w={150}
        />
        <DatePickerInput
          {...common}
          aria-label={t('to')}
          value={to}
          onChange={(v) => v && onChange({ from, to: v })}
          valueFormat="DD.MM.YYYY"
          presets={preset}
          w={150}
        />
      </Group>
    )
  }

  // Hour-granular archives: a 24-cell hour grid beats scrolling a time list.
  return (
    <Group gap="xs" wrap="nowrap">
      <HourDateTimePicker
        ariaLabel={t('from')}
        value={from}
        onChange={(v) => onChange({ from: v, to })}
        todayValue={`${today} ${pad(h)}:00:00`}
        disabled={disabled}
      />
      <HourDateTimePicker
        ariaLabel={t('to')}
        value={to}
        onChange={(v) => onChange({ from, to: v })}
        todayValue={`${addDaysStr(today, 1)} ${pad(h - 1)}:00:00`}
        disabled={disabled}
      />
    </Group>
  )
}
