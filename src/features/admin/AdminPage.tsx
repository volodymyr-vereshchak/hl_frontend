import { Box, NavLink, Paper, ScrollArea, Text, Alert } from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import {
  IconUsers,
  IconBuildingCommunity,
  IconFolder,
  IconFolders,
  IconRefresh,
  IconKey,
  IconRipple,
  IconCpu,
  IconCircles,
  IconRoute,
  IconApi,
  IconBuildingFactory2,
  IconDeviceDesktop,
  IconListDetails,
  IconAlertTriangle,
  IconCategory,
  IconPackageExport,
} from '@tabler/icons-react'
import { useUser } from '@/features/auth/UserContext'
import {
  BranchesTab,
  LumgsTab,
  LinesConfigTab,
  CalcsTab,
  CalcTypesTab,
  DeviceMappingsTab,
  CorrectorTypesTab,
} from './tabs/SimpleTabs'
import { EventTypesTab } from './tabs/EventTypesTab'
import { UpdateTab } from './tabs/UpdateTab'
import { DataPathsTab } from './tabs/DataPathsTab'
import { DpdCredentialsTab } from './tabs/DpdCredentialsTab'
import { RingsTab } from './tabs/RingsTab'
import { DpdLinesTab } from './tabs/DpdLinesTab'
import { RoutesTab } from './tabs/RoutesTab'
import { EnterprisesTab } from './tabs/EnterprisesTab'
import { UsersTab } from './tabs/UsersTab'
import { BranchTransferTab } from './tabs/BranchTransferTab'

interface TabDef {
  id: string
  label: string
  icon: React.ReactNode
  element: React.ReactNode
}

interface GroupDef {
  label: string
  tabs: TabDef[]
}

const GROUPS: GroupDef[] = [
  {
    label: 'Система',
    tabs: [{ id: 'users', label: 'Користувачі', icon: <IconUsers size={16} />, element: <UsersTab /> }],
  },
  {
    label: 'Мережа',
    tabs: [
      { id: 'branches', label: 'Філії', icon: <IconBuildingCommunity size={16} />, element: <BranchesTab /> },
      { id: 'lumgs', label: 'ЛУМГ', icon: <IconFolder size={16} />, element: <LumgsTab /> },
      { id: 'paths', label: 'Шляхи до даних', icon: <IconFolders size={16} />, element: <DataPathsTab /> },
      { id: 'dpd-cred', label: 'Доступ ДПД', icon: <IconKey size={16} />, element: <DpdCredentialsTab /> },
      { id: 'update', label: 'Оновлення даних', icon: <IconRefresh size={16} />, element: <UpdateTab /> },
      {
        id: 'transfer',
        label: 'Перенесення філії',
        icon: <IconPackageExport size={16} />,
        element: <BranchTransferTab />,
      },
    ],
  },
  {
    label: 'Лінії',
    tabs: [
      { id: 'lines', label: 'Лінії', icon: <IconRipple size={16} />, element: <LinesConfigTab /> },
      { id: 'calcs', label: 'Обчислювачі', icon: <IconCpu size={16} />, element: <CalcsTab /> },
      { id: 'virtual', label: 'Кільця', icon: <IconCircles size={16} />, element: <RingsTab /> },
      { id: 'dpd-lines', label: 'Лінії ДПД', icon: <IconApi size={16} />, element: <DpdLinesTab /> },
      { id: 'routes', label: 'Маршрути', icon: <IconRoute size={16} />, element: <RoutesTab /> },
    ],
  },
  {
    label: 'Довідники',
    tabs: [
      { id: 'enterprises', label: 'Підприємства', icon: <IconBuildingFactory2 size={16} />, element: <EnterprisesTab /> },
      { id: 'calc-types', label: 'Типи обчислювачів', icon: <IconCategory size={16} />, element: <CalcTypesTab /> },
      { id: 'event-types', label: 'Типи подій', icon: <IconListDetails size={16} />, element: <EventTypesTab /> },
      { id: 'manufacturers', label: 'Виробники', icon: <IconDeviceDesktop size={16} />, element: <DeviceMappingsTab /> },
      { id: 'correctors', label: 'Типи коректорів', icon: <IconDeviceDesktop size={16} />, element: <CorrectorTypesTab /> },
    ],
  },
]

const ALL_TABS = GROUPS.flatMap((g) => g.tabs)

export function AdminPage() {
  const { user } = useUser()
  const [activeTab, setActiveTab] = useLocalStorage({ key: 'hlv-admin-tab', defaultValue: 'users' })

  if (user?.role !== 'admin') {
    return (
      <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
        Доступ лише для адміністраторів
      </Alert>
    )
  }

  const active = ALL_TABS.find((t) => t.id === activeTab) ?? ALL_TABS[0]

  return (
    <Box
      style={{
        display: 'flex',
        gap: 'var(--mantine-spacing-md)',
        height: 'calc(100dvh - 100px)',
        minHeight: 420,
      }}
    >
      <Paper
        withBorder
        radius="md"
        style={{ width: 250, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <ScrollArea style={{ flex: 1 }} type="hover">
          <Box p={6}>
            {GROUPS.map((group) => (
              <Box key={group.label} mb={4}>
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" px="xs" py={6}>
                  {group.label}
                </Text>
                {group.tabs.map((tab) => (
                  <NavLink
                    key={tab.id}
                    label={tab.label}
                    leftSection={tab.icon}
                    active={tab.id === active.id}
                    onClick={() => setActiveTab(tab.id)}
                    color="petrol"
                    variant="light"
                    style={{ borderRadius: 6 }}
                  />
                ))}
              </Box>
            ))}
          </Box>
        </ScrollArea>
      </Paper>

      {/*
        A plain scrollable box rather than a ScrollArea: tabs whose tables scroll
        internally set height:100%, which only resolves against a parent with a
        definite height. With a nested ScrollArea viewport it did not, so those
        tables grew to full length and the whole panel scrolled instead.
      */}
      <Paper
        withBorder
        radius="md"
        style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <Box p="md" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {active.element}
        </Box>
      </Paper>
    </Box>
  )
}
