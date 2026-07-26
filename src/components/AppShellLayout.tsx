import { AppShell, Group, Text, Button, Menu, Box, ScrollArea } from '@mantine/core'
import {
  IconGauge,
  IconCalendar,
  IconClockHour4,
  IconAlertTriangle,
  IconPencil,
  IconAdjustments,
  IconBuildingFactory2,
  IconReportAnalytics,
  IconSettings,
  IconChevronDown,
  IconChartHistogram,
  IconMoon,
  IconCalculator,
} from '@tabler/icons-react'
import { NavLink as RouterNavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useRememberRoute } from '@/app/router'
import { useLanguage } from '@/locales/LanguageContext'
import { useUser } from '@/features/auth/UserContext'
import { ColorSchemeToggle } from './ColorSchemeToggle'
import { LanguagePicker } from './LanguagePicker'
import { UserBadge } from '@/features/auth/UserBadge'
import type { TranslationKey } from '@/locales'

interface NavItem {
  to: string
  labelKey: TranslationKey
  icon: React.ReactNode
}

const MAIN_NAV: NavItem[] = [
  { to: '/overview', labelKey: 'overview', icon: <IconGauge size={16} /> },
  { to: '/archive/daily', labelKey: 'daily', icon: <IconCalendar size={16} /> },
  { to: '/archive/hourly', labelKey: 'hourly', icon: <IconClockHour4 size={16} /> },
  { to: '/archive/sys', labelKey: 'sys', icon: <IconAlertTriangle size={16} /> },
  { to: '/archive/edit', labelKey: 'edit', icon: <IconPencil size={16} /> },
  { to: '/archive/param', labelKey: 'param', icon: <IconAdjustments size={16} /> },
  { to: '/enterprise-poll', labelKey: 'navPoll', icon: <IconBuildingFactory2 size={16} /> },
]

function NavButton({ item }: { item: NavItem }) {
  const { t } = useLanguage()
  const location = useLocation()
  const active = location.pathname === item.to
  return (
    <Button
      component={RouterNavLink}
      to={item.to}
      variant={active ? 'light' : 'subtle'}
      color={active ? 'petrol' : 'gray'}
      size="sm"
      leftSection={item.icon}
      px="sm"
    >
      {t(item.labelKey)}
    </Button>
  )
}

export function AppShellLayout() {
  const { t } = useLanguage()
  const { user } = useUser()
  const navigate = useNavigate()
  const location = useLocation()
  const reportsActive = location.pathname.startsWith('/reports')

  // Remember the screen so a reload returns here instead of the overview.
  useRememberRoute()

  return (
    <AppShell header={{ height: 56 }} padding="lg">
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm" wrap="nowrap">
          <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
            <IconGauge size={22} color="var(--mantine-color-petrol-6)" />
            <Text fw={700} ff="'Space Grotesk Variable', sans-serif" size="lg" visibleFrom="sm">
              HLViewer
            </Text>
          </Group>

          <ScrollArea type="never" style={{ flex: 1 }}>
            <Group gap={4} wrap="nowrap">
              {MAIN_NAV.map((item) => (
                <NavButton key={item.to} item={item} />
              ))}

              <Menu shadow="md" width={220} position="bottom-start">
                <Menu.Target>
                  <Button
                    variant={reportsActive ? 'light' : 'subtle'}
                    color={reportsActive ? 'petrol' : 'gray'}
                    size="sm"
                    leftSection={<IconReportAnalytics size={16} />}
                    rightSection={<IconChevronDown size={14} />}
                    px="sm"
                  >
                    {t('navReports')}
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={<IconChartHistogram size={16} />}
                    onClick={() => navigate('/reports/grs-trends')}
                  >
                    {t('grsTrends')}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconMoon size={16} />}
                    onClick={() => navigate('/reports/night-consumption')}
                  >
                    {t('nightConsumption')}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconAlertTriangle size={16} />}
                    onClick={() => navigate('/reports/accidents')}
                  >
                    {t('accidents')}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconCalculator size={16} />}
                    onClick={() => navigate('/flow-calc')}
                  >
                    {t('navFlowCalc')}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>

              {user?.role === 'admin' && (
                <NavButton
                  item={{ to: '/admin', labelKey: 'navAdmin', icon: <IconSettings size={16} /> }}
                />
              )}
            </Group>
          </ScrollArea>

          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            <LanguagePicker />
            <ColorSchemeToggle />
            <UserBadge />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Box>
          <Outlet />
        </Box>
      </AppShell.Main>
    </AppShell>
  )
}
