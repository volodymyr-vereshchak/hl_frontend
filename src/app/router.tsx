import { createBrowserRouter, Navigate, useSearchParams } from 'react-router-dom'
import { AppShellLayout } from '@/components/AppShellLayout'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { ArchivePage } from '@/features/archive/ArchivePage'
import { AdminPage } from '@/features/admin/AdminPage'
import { EnterprisePollPage } from '@/features/enterprise-poll/EnterprisePollPage'
import { AccidentsPage } from '@/features/reports/AccidentsPage'
import { GrsTrendsPage } from '@/features/reports/GrsTrendsPage'
import { NightConsumptionPage } from '@/features/reports/NightConsumptionPage'
import { FlowCalcPage } from '@/features/flow-calc/FlowCalcPage'

// Map old ?archiveType= deep links to the new routes (backward compatibility).
const LEGACY_ROUTE: Record<string, string> = {
  overview: '/overview',
  daily: '/archive/daily',
  hourly: '/archive/hourly',
  sys: '/archive/sys',
  edit: '/archive/edit',
  param: '/archive/param',
  poll: '/enterprise-poll',
  admin: '/admin',
  'grs-trends': '/reports/grs-trends',
  'night-consumption': '/reports/night-consumption',
  accidents: '/reports/accidents',
  'flow-calc': '/flow-calc',
}

/** Entry redirect that honors legacy ?archiveType= / ?lineId= query params. */
function RootRedirect() {
  const [params] = useSearchParams()
  const archiveType = params.get('archiveType')
  const target = archiveType ? LEGACY_ROUTE[archiveType] : undefined
  if (target) {
    const lineId = params.get('lineId')
    const suffix = lineId ? `?lineId=${lineId}` : ''
    return <Navigate to={`${target}${suffix}`} replace />
  }
  return <Navigate to="/overview" replace />
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShellLayout />,
    children: [
      { index: true, element: <RootRedirect /> },
      { path: 'overview', element: <OverviewPage /> },
      { path: 'archive/:type', element: <ArchivePage /> },
      { path: 'enterprise-poll', element: <EnterprisePollPage /> },
      { path: 'reports/grs-trends', element: <GrsTrendsPage /> },
      { path: 'reports/night-consumption', element: <NightConsumptionPage /> },
      { path: 'reports/accidents', element: <AccidentsPage /> },
      { path: 'flow-calc', element: <FlowCalcPage /> },
      { path: 'admin', element: <AdminPage /> },
      { path: '*', element: <Navigate to="/overview" replace /> },
    ],
  },
])
