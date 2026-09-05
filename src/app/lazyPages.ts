import { lazy } from 'react'

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
export const OverviewPage = lazy(() =>
  import('@/features/overview/OverviewPage').then((m) => ({ default: m.OverviewPage })),
)
export const ArchivePage = lazy(() =>
  import('@/features/archive/ArchivePage').then((m) => ({ default: m.ArchivePage })),
)
export const AdminPage = lazy(() =>
  import('@/features/admin/AdminPage').then((m) => ({ default: m.AdminPage })),
)
export const EnterprisePollPage = lazy(() =>
  import('@/features/enterprise-poll/EnterprisePollPage').then((m) => ({
    default: m.EnterprisePollPage,
  })),
)
export const AccidentsPage = lazy(() =>
  import('@/features/reports/AccidentsPage').then((m) => ({ default: m.AccidentsPage })),
)
export const GrsTrendsPage = lazy(() =>
  import('@/features/reports/GrsTrendsPage').then((m) => ({ default: m.GrsTrendsPage })),
)
export const NightConsumptionPage = lazy(() =>
  import('@/features/reports/NightConsumptionPage').then((m) => ({
    default: m.NightConsumptionPage,
  })),
)
export const FhpComparisonPage = lazy(() =>
  import('@/features/reports/FhpComparisonPage').then((m) => ({
    default: m.FhpComparisonPage,
  })),
)
export const LineComparisonPage = lazy(() =>
  import('@/features/reports/LineComparisonPage').then((m) => ({
    default: m.LineComparisonPage,
  })),
)
export const FlowCalcPage = lazy(() =>
  import('@/features/flow-calc/FlowCalcPage').then((m) => ({ default: m.FlowCalcPage })),
)
