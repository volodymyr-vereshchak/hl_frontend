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
  IconFlask,
  IconMoon,
  IconCalculator,
} from '@tabler/icons-react'
import { NavLink as RouterNavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useRememberRoute } from '@/app/router'
import { useLanguage } from '@/locales/LanguageContext'
import { useUser } from '@/features/auth/UserContext'
import { ColorSchemeToggle } from './ColorSchemeToggle'
import { LanguagePicker } from './LanguagePicker'
import { WhatsNewButton } from './WhatsNewButton'
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

/** The "Звіти" dropdown. `/flow-calc` lives outside /reports — hence the
 *  explicit list rather than a prefix match. */
const REPORTS_NAV: NavItem[] = [
  { to: '/reports/grs-trends', labelKey: 'grsTrends', icon: <IconChartHistogram size={16} /> },
  { to: '/reports/night-consumption', labelKey: 'nightConsumption', icon: <IconMoon size={16} /> },
  { to: '/reports/accidents', labelKey: 'accidents', icon: <IconAlertTriangle size={16} /> },
  { to: '/reports/fhp-comparison', labelKey: 'fhpComparison', icon: <IconFlask size={16} /> },
  { to: '/flow-calc', labelKey: 'navFlowCalc', icon: <IconCalculator size={16} /> },
]

/**
 * Shared look for the top-level nav buttons. The tinted background alone was
 * too quiet to find at a glance in a row of eight, so the active one also gets
 * bold text and an underline anchored to the header edge — the same cue a
 * browser tab uses, read before the colour registers.
 */
function navButtonProps(active: boolean) {
  return {
    variant: active ? 'light' : 'subtle',
    color: active ? 'petrol' : 'gray',
    size: 'sm',
    px: 'sm',
    fw: active ? 700 : 500,
    styles: {
      root: {
        position: 'relative' as const,
        '--hlv-nav-underline': active ? 'var(--mantine-color-petrol-6)' : 'transparent',
      },
    },
    className: 'hlv-nav-button',
  }
}

function NavButton({ item }: { item: NavItem }) {
  const { t } = useLanguage()
  const location = useLocation()
  const active = location.pathname === item.to
  return (
    <Button component={RouterNavLink} to={item.to} leftSection={item.icon} {...navButtonProps(active)}>
      {t(item.labelKey)}
    </Button>
  )
}

export function AppShellLayout() {
  const { t } = useLanguage()
  const { user } = useUser()
  const navigate = useNavigate()
  const location = useLocation()
  // /flow-calc sits under this menu too, so the button lights up for it as well.
  const reportsActive = REPORTS_NAV.some((item) => location.pathname === item.to)

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
                    leftSection={<IconReportAnalytics size={16} />}
                    rightSection={<IconChevronDown size={14} />}
                    {...navButtonProps(reportsActive)}
                  >
                    {t('navReports')}
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  {/* Which report you are on is invisible once the menu closes,
                      so the open dropdown has to say it. */}
                  {REPORTS_NAV.map((item) => (
                    <Menu.Item
                      key={item.to}
                      leftSection={item.icon}
                      onClick={() => navigate(item.to)}
                      c={location.pathname === item.to ? 'petrol' : undefined}
                      fw={location.pathname === item.to ? 700 : undefined}
                      bg={
                        location.pathname === item.to
                          ? 'var(--mantine-color-petrol-light)'
                          : undefined
                      }
                    >
                      {t(item.labelKey)}
                    </Menu.Item>
                  ))}
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
            <WhatsNewButton />
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
