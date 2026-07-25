import { Button, Group } from '@mantine/core'
import { DateTimePicker, DatePickerInput } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import { useLanguage } from '@/locales/LanguageContext'

interface Props {
  /** Daily/param archives pick whole days; hourly and event archives need time. */
  withTime: boolean
  from: string
  to: string
  onChange: (next: { from: string; to: string }) => void
}

const pad = (n: number) => String(n).padStart(2, '0')

function nowLocal(endOfDay = false): string {
  const d = new Date()
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return endOfDay ? `${date} 23:59:00` : `${date} 00:00:00`
}

function todayDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Period selector. Mantine v9 dates are strings; the time-enabled variant uses
 * "YYYY-MM-DD HH:mm:ss", the date-only one "YYYY-MM-DD". Locale (labels, month
 * names, week start) comes from DatesProvider in app/providers.
 */
export function PeriodPicker({ withTime, from, to, onChange }: Props) {
  const { t } = useLanguage()

  const setToday = () => {
    onChange(
      withTime
        ? { from: nowLocal(false), to: nowLocal(true) }
        : { from: todayDate(), to: todayDate() },
    )
  }

  const common = {
    leftSection: <IconCalendar size={15} />,
    size: 'xs' as const,
    popoverProps: { zIndex: 500, withinPortal: true },
  }

  return (
    <Group gap="xs" wrap="nowrap">
      {withTime ? (
        <>
          <DateTimePicker
            {...common}
            aria-label={t('from')}
            value={from}
            onChange={(v) => v && onChange({ from: v, to })}
            valueFormat="DD.MM.YYYY HH:mm"
            withSeconds={false}
            w={185}
          />
          <DateTimePicker
            {...common}
            aria-label={t('to')}
            value={to}
            onChange={(v) => v && onChange({ from, to: v })}
            valueFormat="DD.MM.YYYY HH:mm"
            withSeconds={false}
            w={185}
          />
        </>
      ) : (
        <>
          <DatePickerInput
            {...common}
            aria-label={t('from')}
            value={from}
            onChange={(v) => v && onChange({ from: v, to })}
            valueFormat="DD.MM.YYYY"
            w={150}
          />
          <DatePickerInput
            {...common}
            aria-label={t('to')}
            value={to}
            onChange={(v) => v && onChange({ from, to: v })}
            valueFormat="DD.MM.YYYY"
            w={150}
          />
        </>
      )}
      <Button variant="default" size="xs" onClick={setToday} style={{ flexShrink: 0 }}>
        {t('today')}
      </Button>
    </Group>
  )
}
