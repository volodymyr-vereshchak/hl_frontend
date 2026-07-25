import { ActionIcon, useMantineColorScheme, Tooltip } from '@mantine/core'
import { IconMoon, IconSun } from '@tabler/icons-react'

/** Light/dark switch. Choice persists via Mantine's localStorage manager. */
export function ColorSchemeToggle() {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()
  const dark = colorScheme === 'dark'
  return (
    <Tooltip label={dark ? 'Світла тема' : 'Темна тема'} withArrow>
      <ActionIcon
        variant="default"
        size="lg"
        radius="md"
        onClick={toggleColorScheme}
        aria-label="Перемкнути тему"
      >
        {dark ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  )
}
