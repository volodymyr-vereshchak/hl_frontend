import { Group, Switch, Button, Title, Badge } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { IconCalendar, IconFileSpreadsheet } from '@tabler/icons-react'
import { useSelectionStore } from '@/store/selectionStore'
import { useLanguage } from '@/locales/LanguageContext'

interface Props {
  title: string
  kindBadge?: 'virtual' | 'dpd' | null
  onExport: () => void
  canExport: boolean
}

/**
 * Single-line archive toolbar: title · date pickers · filter switch · Excel
 * (pushed to the right edge). Mantine v9 dates are strings ('YYYY-MM-DD').
 */
export function DateRangeControls({ title, kindBadge, onExport, canExport }: Props) {
  const { t } = useLanguage()
  const { dateRange, setDateRange, dateFilterEnabled, setDateFilterEnabled } = useSelectionStore()

  return (
    <Group gap="md" wrap="nowrap" align="center">
      <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
        <Title order={4} style={{ whiteSpace: 'nowrap' }}>
          {title}
        </Title>
        {kindBadge && (
          <Badge variant="light" color={kindBadge === 'virtual' ? 'grape' : 'blue'} size="sm">
            {kindBadge === 'virtual' ? 'Virtual' : 'DPD'}
          </Badge>
        )}
      </Group>

      <DatePickerInput
        aria-label={t('from')}
        leftSection={<IconCalendar size={15} />}
        value={dateRange.fromDate}
        onChange={(v) => v && setDateRange({ ...dateRange, fromDate: v })}
        valueFormat="DD.MM.YYYY"
        w={140}
        size="xs"
        popoverProps={{ zIndex: 500, withinPortal: true }}
      />
      <DatePickerInput
        aria-label={t('to')}
        leftSection={<IconCalendar size={15} />}
        value={dateRange.toDate}
        onChange={(v) => v && setDateRange({ ...dateRange, toDate: v })}
        valueFormat="DD.MM.YYYY"
        w={140}
        size="xs"
        popoverProps={{ zIndex: 500, withinPortal: true }}
      />

      <Switch
        checked={dateFilterEnabled}
        onChange={(e) => setDateFilterEnabled(e.currentTarget.checked)}
        label={t('activateDate')}
        color="petrol"
        size="sm"
        styles={{ label: { whiteSpace: 'nowrap' } }}
      />

      <Button
        variant="light"
        color="teal"
        leftSection={<IconFileSpreadsheet size={16} />}
        onClick={onExport}
        disabled={!canExport}
        size="xs"
        ml="auto"
        style={{ flexShrink: 0 }}
      >
        {t('excel')}
      </Button>
    </Group>
  )
}
