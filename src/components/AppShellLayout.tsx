import { AppShell, Group, Text, Button, Menu, Box, ScrollArea, ActionIcon, Tooltip } from '@mantine/core'
import {
  IconGauge,
  IconReportAnalytics,
  IconSettings,
  IconChevronDown,
  IconKeyboard,
} from '@tabler/icons-react'
import { Suspense, useState } from 'react'
import { NavLink as RouterNavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useRememberRoute } from '@/app/router'
import { MAIN_NAV, REPORTS_NAV, type NavItem } from '@/app/navItems'
import { useHotkeys } from '@/lib/hotkeys'
import { useLanguage } from '@/locales/LanguageContext'
import { useUser } from '@/features/auth/UserContext'
import { ColorSchemeToggle } from './ColorSchemeToggle'
import { LoadingState } from './LoadingState'
import { LanguagePicker } from './LanguagePicker'
import { WhatsNewButton } from './WhatsNewButton'
import { HotkeysHelpModal } from './HotkeysHelpModal'
import { UserBadge } from '@/features/auth/UserBadge'

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

function NavButton({ item, hotkey }: { item: NavItem; hotkey?: string }) {
  const { t } = useLanguage()
  const location = useLocation()
  const active = location.pathname === item.to
  return (
    <Button
      component={RouterNavLink}
      to={item.to}
      leftSection={item.icon}
      /* The shortcut goes in the native tooltip rather than on the button: a
         row of eight buttons has no room for a badge each, and "?" lists them
         all anyway. */
      title={hotkey ? `${t(item.labelKey)} (${hotkey})` : undefined}
      {...navButtonProps(active)}
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
  // /flow-calc sits under this menu too, so the button lights up for it as well.
  const reportsActive = REPORTS_NAV.some((item) => location.pathname === item.to)
  // Controlled so Alt+8 can open it; from there the arrows walk the items.
  const [reportsOpen, setReportsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const isAdmin = user?.role === 'admin'

  // Remember the screen so a reload returns here instead of the overview.
  useRememberRoute()

  /**
   * Alt+digit for the sections, in the order the buttons are drawn. Alt rather
   * than Ctrl because Ctrl+digit is the browser's own tab switcher, and digits
   * rather than letters because they are the same keys on a Cyrillic layout.
   */
  useHotkeys([
    ...MAIN_NAV.map((item, i) => ({
      alt: true,
      key: [String(i + 1)],
      code: [`Digit${i + 1}`],
      run: () => navigate(item.to),
    })),
    { alt: true, key: ['8'], code: ['Digit8'], run: () => setReportsOpen((o) => !o) },
    {
      alt: true,
      key: ['9'],
      code: ['Digit9'],
      enabled: isAdmin,
      run: () => navigate('/admin'),
    },
    // "?" is Shift+/ on a Latin layout and Shift+7 on a Cyrillic one; both
    // report '?' as the character, which is why this matches the character.
    { key: ['?'], run: () => setHelpOpen(true) },
  ])

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
              {MAIN_NAV.map((item, i) => (
                <NavButton key={item.to} item={item} hotkey={`Alt+${i + 1}`} />
              ))}

              <Menu
                shadow="md"
                width={220}
                position="bottom-start"
                opened={reportsOpen}
                onChange={setReportsOpen}
              >
                <Menu.Target>
                  <Button
                    leftSection={<IconReportAnalytics size={16} />}
                    rightSection={<IconChevronDown size={14} />}
                    title={`${t('navReports')} (Alt+8)`}
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

              {isAdmin && (
                <NavButton
                  item={{ to: '/admin', labelKey: 'navAdmin', icon: <IconSettings size={16} /> }}
                  hotkey="Alt+9"
                />
              )}
            </Group>
          </ScrollArea>

          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            <Tooltip label={`${t('hotkeysTitle')} (?)`} withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                onClick={() => setHelpOpen(true)}
                aria-label={t('hotkeysTitle')}
              >
                <IconKeyboard size={18} />
              </ActionIcon>
            </Tooltip>
            <WhatsNewButton />
            <LanguagePicker />
            <ColorSchemeToggle />
            <UserBadge />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Box>
          {/* Routes are code-split, so the first visit to a screen waits on
              its chunk. The app's own loader keeps that wait looking like
              every other wait in the app rather than a blank page. */}
          <Suspense fallback={<LoadingState />}>
            <Outlet />
          </Suspense>
        </Box>
      </AppShell.Main>

      <HotkeysHelpModal opened={helpOpen} onClose={() => setHelpOpen(false)} isAdmin={!!isAdmin} />
    </AppShell>
  )
}
