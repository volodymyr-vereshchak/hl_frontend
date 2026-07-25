import { Group, Switch, Button } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { IconCalendar, IconFileSpreadsheet } from '@tabler/icons-react'
import { useSelectionStore } from '@/store/selectionStore'
import { useLanguage } from '@/locales/LanguageContext'

// Mantine v9 dates are string-based ('YYYY-MM-DD'), matching our store format.
export function DateRangeControls({ onExport, canExport }: { onExport: () => void; canExport: boolean }) {
  const { t } = useLanguage()
  const { dateRange, setDateRange, dateFilterEnabled, setDateFilterEnabled } = useSelectionStore()

  return (
    <Group gap="md" align="flex-end" wrap="wrap">
      <Switch
        checked={dateFilterEnabled}
        onChange={(e) => setDateFilterEnabled(e.currentTarget.checked)}
        label={t('activateDate')}
        color="petrol"
      />
      <DatePickerInput
        label={t('from')}
        leftSection={<IconCalendar size={15} />}
        value={dateRange.fromDate}
        onChange={(v) => v && setDateRange({ ...dateRange, fromDate: v })}
        valueFormat="DD.MM.YYYY"
        w={150}
        size="sm"
      />
      <DatePickerInput
        label={t('to')}
        leftSection={<IconCalendar size={15} />}
        value={dateRange.toDate}
        onChange={(v) => v && setDateRange({ ...dateRange, toDate: v })}
        valueFormat="DD.MM.YYYY"
        w={150}
        size="sm"
      />
      <Button
        variant="light"
        color="teal"
        leftSection={<IconFileSpreadsheet size={16} />}
        onClick={onExport}
        disabled={!canExport}
        size="sm"
      >
        {t('excel')}
      </Button>
    </Group>
  )
}
