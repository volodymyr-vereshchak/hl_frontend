import { Group, Text, Badge, Menu, UnstyledButton, Avatar } from '@mantine/core'
import { IconLogout, IconChevronDown } from '@tabler/icons-react'
import { useLanguage } from '@/locales/LanguageContext'
import { useUser } from './UserContext'

/** Current-user chip with a logout menu. */
export function UserBadge() {
  const { user, logout } = useUser()
  const { t } = useLanguage()
  if (!user) return null

  const isAdmin = user.role === 'admin'
  // Show the person, not the account: the login is an implementation detail
  // and only stands in when no name was filled in.
  const name = user.display_name?.trim() || user.username
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return (
    <Menu shadow="md" width={220} position="bottom-end">
      <Menu.Target>
        <UnstyledButton>
          <Group gap="xs">
            <Avatar size={30} radius="xl" color={isAdmin ? 'amber' : 'petrol'}>
              {initials}
            </Avatar>
            <div style={{ lineHeight: 1.15 }}>
              <Text size="sm" fw={600} title={user.username}>
                {name}
              </Text>
              <Badge size="xs" variant="light" color={isAdmin ? 'amber' : 'petrol'}>
                {isAdmin ? t('roleAdmin') : t('roleViewer')}
              </Badge>
            </div>
            <IconChevronDown size={14} />
          </Group>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<IconLogout size={16} />}
          color="red"
          onClick={() => void logout()}
        >
          {t('logout')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
