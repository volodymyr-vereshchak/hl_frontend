import { Menu, Text, UnstyledButton } from '@mantine/core'
import { IconChevronDown } from '@tabler/icons-react'
import { SWITCHABLE_UNITS } from '@/domain/pressureUnits'
import { useLanguage } from '@/locales/LanguageContext'

interface Props {
  /** The unit the column is showing right now. */
  value: string
  onChange: (unit: string) => void
}

/**
 * The unit under a pressure column's name, and the way to change it.
 *
 * It sits in the header because that is where the question is asked: the
 * archive holds whatever each corrector reported — this fleet reports both
 * МПа and кгс/см², and twelve devices report both within one history — so the
 * column has to say which unit the numbers in it are in. Saying it is half the
 * job; the other half is letting the reader pick, which is one click away
 * rather than a trip to a settings form.
 */
export function PressureUnitPicker({ value, onChange }: Props) {
  const { t } = useLanguage()
  // The current unit is always in the list, even when it is not one of the
  // four offered — a meter reporting мм рт.ст. must not be unable to name it.
  const units = SWITCHABLE_UNITS.includes(value) ? SWITCHABLE_UNITS : [value, ...SWITCHABLE_UNITS]
  return (
    <Menu shadow="md" width={120} withinPortal zIndex={500} position="bottom">
      <Menu.Target>
        <UnstyledButton
          // The header cell sorts on click; this is a different question.
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}
          title={t('pressureUnits')}
        >
          <Text size="xs" c="dimmed" fw={400} style={{ textDecoration: 'underline dotted' }}>
            {value}
          </Text>
          <IconChevronDown size={11} />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        {units.map((unit) => (
          <Menu.Item
            key={unit}
            onClick={() => onChange(unit)}
            fw={unit === value ? 600 : 400}
            py={4}
          >
            {unit}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}
