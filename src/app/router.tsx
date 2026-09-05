import { lazy, useEffect } from 'react'
import { createBrowserRouter, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { AppShellLayout } from '@/components/AppShellLayout'

/**
 * Screens load on demand. Statically imported, every page was in the entry
 * graph, so the browser fetched xlsx (324 KB) and recharts (358 KB) before it
 * could paint anything — though xlsx is only wanted the moment someone presses
 * «Excel», and recharts only in chart view. vite.config already splits those
 * two into their own vendor chunks; splitting the ROUTES is what stops those
 * chunks being pulled in by the entry.
 *
 * The pages are named exports, hence the `.then` — React.lazy resolves a
 * module's default.
 */
const OverviewPage = lazy(() =>
  import('@/features/overview/OverviewPage').then((m) => ({ default: m.OverviewPage })),
)
const ArchivePage = lazy(() =>
  import('@/features/archive/ArchivePage').then((m) => ({ default: m.ArchivePage })),
)
const AdminPage = lazy(() =>
  import('@/features/admin/AdminPage').then((m) => ({ default: m.AdminPage })),
)
const EnterprisePollPage = lazy(() =>
  import('@/features/enterprise-poll/EnterprisePollPage').then((m) => ({
    default: m.EnterprisePollPage,
  })),
)
const AccidentsPage = lazy(() =>
  import('@/features/reports/AccidentsPage').then((m) => ({ default: m.AccidentsPage })),
)
const GrsTrendsPage = lazy(() =>
  import('@/features/reports/GrsTrendsPage').then((m) => ({ default: m.GrsTrendsPage })),
)
const NightConsumptionPage = lazy(() =>
  import('@/features/reports/NightConsumptionPage').then((m) => ({
    default: m.NightConsumptionPage,
  })),
)
const FhpComparisonPage = lazy(() =>
  import('@/features/reports/FhpComparisonPage').then((m) => ({
    default: m.FhpComparisonPage,
  })),
)
const LineComparisonPage = lazy(() =>
  import('@/features/reports/LineComparisonPage').then((m) => ({
    default: m.LineComparisonPage,
  })),
)
const FlowCalcPage = lazy(() =>
  import('@/features/flow-calc/FlowCalcPage').then((m) => ({ default: m.FlowCalcPage })),
)

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
