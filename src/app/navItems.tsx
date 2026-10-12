/**
 * The header's navigation, in the order it is drawn.
 *
 * Its own module because two things read it now: the header itself and the
 * shortcuts dialog, which numbers the main items Alt+1…Alt+7 and so must see
 * exactly the same order the buttons are in.
 */
import {
  IconAdjustments,
  IconAlertTriangle,
  IconBuildingFactory2,
  IconCalculator,
  IconCalendar,
  IconChartHistogram,
  IconClockHour4,
  IconFlask,
  IconGauge,
  IconGitCompare,
  IconMoon,
  IconPencil,
} from '@tabler/icons-react'
import type { TranslationKey } from '@/locales'

export interface NavItem {
  to: string
  labelKey: TranslationKey
  icon: React.ReactNode
}

export const MAIN_NAV: NavItem[] = [
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
export const REPORTS_NAV: NavItem[] = [
  { to: '/reports/grs-trends', labelKey: 'grsTrends', icon: <IconChartHistogram size={16} /> },
  { to: '/reports/night-consumption', labelKey: 'nightConsumption', icon: <IconMoon size={16} /> },
  { to: '/reports/accidents', labelKey: 'accidents', icon: <IconAlertTriangle size={16} /> },
  { to: '/reports/fhp-comparison', labelKey: 'fhpComparison', icon: <IconFlask size={16} /> },
  { to: '/reports/line-comparison', labelKey: 'lineComparison', icon: <IconGitCompare size={16} /> },
  { to: '/flow-calc', labelKey: 'navFlowCalc', icon: <IconCalculator size={16} /> },
]
