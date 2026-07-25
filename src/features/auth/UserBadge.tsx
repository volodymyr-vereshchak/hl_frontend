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

  return (
    <Menu shadow="md" width={200} position="bottom-end">
      <Menu.Target>
        <UnstyledButton>
          <Group gap="xs">
            <Avatar size={30} radius="xl" color={isAdmin ? 'amber' : 'petrol'}>
              {user.username.slice(0, 2).toUpperCase()}
            </Avatar>
            <div style={{ lineHeight: 1.15 }}>
              <Text size="sm" fw={600}>
                {user.username}
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
