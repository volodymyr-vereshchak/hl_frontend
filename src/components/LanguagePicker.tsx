import { Menu, ActionIcon, Tooltip } from '@mantine/core'
import { useLanguage } from '@/locales/LanguageContext'
import { languages, type Language } from '@/locales'

/** Compact flag-based language switcher (ru / uk). */
export function LanguagePicker() {
  const { currentLanguage, changeLanguage, t } = useLanguage()
  const current = languages.find((l) => l.code === currentLanguage) ?? languages[0]

  return (
    <Menu shadow="md" width={180} position="bottom-end">
      <Menu.Target>
        <Tooltip label={t('languageLabel')} withArrow>
          <ActionIcon variant="default" size="lg" radius="md" aria-label={t('languageLabel')}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>{current.flag}</span>
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        {languages.map((lang) => (
          <Menu.Item
            key={lang.code}
            leftSection={<span style={{ fontSize: 16 }}>{lang.flag}</span>}
            onClick={() => changeLanguage(lang.code as Language)}
            bg={lang.code === currentLanguage ? 'var(--mantine-color-petrol-light)' : undefined}
          >
            {lang.name}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}
