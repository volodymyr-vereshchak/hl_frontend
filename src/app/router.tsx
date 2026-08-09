import { useEffect } from 'react'
import { createBrowserRouter, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { AppShellLayout } from '@/components/AppShellLayout'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { ArchivePage } from '@/features/archive/ArchivePage'
import { AdminPage } from '@/features/admin/AdminPage'
import { EnterprisePollPage } from '@/features/enterprise-poll/EnterprisePollPage'
import { AccidentsPage } from '@/features/reports/AccidentsPage'
import { GrsTrendsPage } from '@/features/reports/GrsTrendsPage'
import { NightConsumptionPage } from '@/features/reports/NightConsumptionPage'
import { FhpComparisonPage } from '@/features/reports/FhpComparisonPage'
import { LineComparisonPage } from '@/features/reports/LineComparisonPage'
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

const LAST_ROUTE_KEY = 'hlv-last-route'

/** Every known route, so a stale stored path can never strand the user. */
const KNOWN_ROUTES = [
  '/overview',
  '/enterprise-poll',
  '/reports/grs-trends',
  '/reports/night-consumption',
  '/reports/accidents',
  '/reports/fhp-comparison',
  '/reports/line-comparison',
  '/flow-calc',
  '/admin',
]
const isKnownRoute = (p: string) =>
  KNOWN_ROUTES.includes(p) || /^\/archive\/(daily|hourly|sys|edit|param)$/.test(p)

/**
 * Entry redirect: legacy `?archiveType=` deep links win, then the screen the
 * user was last on, then the overview. Reloading in the middle of a report
 * should land back in that report, not on the front page.
 */
function RootRedirect() {
  const [params] = useSearchParams()
  const archiveType = params.get('archiveType')
  const target = archiveType ? LEGACY_ROUTE[archiveType] : undefined
  if (target) {
    const lineId = params.get('lineId')
    const suffix = lineId ? `?lineId=${lineId}` : ''
    return <Navigate to={`${target}${suffix}`} replace />
  }
  const last = localStorage.getItem(LAST_ROUTE_KEY)
  return <Navigate to={last && isKnownRoute(last) ? last : '/overview'} replace />
}

/** Records the current path so a reload can come back to it. */
export function useRememberRoute() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (isKnownRoute(pathname)) localStorage.setItem(LAST_ROUTE_KEY, pathname)
  }, [pathname])
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
      { path: 'reports/fhp-comparison', element: <FhpComparisonPage /> },
      { path: 'reports/line-comparison', element: <LineComparisonPage /> },
      { path: 'flow-calc', element: <FlowCalcPage /> },
      { path: 'admin', element: <AdminPage /> },
      { path: '*', element: <Navigate to="/overview" replace /> },
    ],
  },
])
