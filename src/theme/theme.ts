import { createTheme, type MantineColorsTuple, rem } from '@mantine/core'
import type { CSSProperties } from 'react'

/**
 * HLViewer design language — "control room / instrument panel".
 *
 * A gas-distribution-station telemetry console: brushed-steel neutrals, a calm
 * petrol-teal signal accent (digital HMI), and amber/red reserved for gauge
 * needles and alarms. Deliberately NOT the previous acid-lime-on-black look.
 */

// Primary — petrol teal. Reads as an instrument/HMI screen. primaryShade below.
const petrol: MantineColorsTuple = [
  '#e3f6f5',
  '#c6ebe9',
  '#98dcd9',
  '#66cbc7',
  '#3ebcb7',
  '#22adaa',
  '#0e8f8f', // 6 — primary (light)
  '#0b7474',
  '#085a5a',
  '#04403f',
]

// Signal amber — gauge needles, "attention" states.
const amber: MantineColorsTuple = [
  '#fff4e2',
  '#ffe6c2',
  '#fbcb87',
  '#f8b048',
  '#f59a1e',
  '#e8961e', // 5
  '#cf7f12',
  '#a5630a',
  '#7d4b06',
  '#553300',
]

// Cool steel gray — surfaces, borders, muted text (tuned for dark + light).
const steel: MantineColorsTuple = [
  '#f3f5f6',
  '#e6eaec',
  '#cbd3d7',
  '#adbac1',
  '#94a4ad',
  '#84959f',
  '#7b8e99',
  '#687a85',
  '#5a6b75',
  '#4a5a64',
]

export const theme = createTheme({
  primaryColor: 'petrol',
  primaryShade: { light: 6, dark: 5 },
  colors: {
    petrol,
    amber,
    steel,
  },
  white: '#ffffff',
  black: '#12161b',

  defaultRadius: 'md',
  radius: {
    xs: rem(3),
    sm: rem(5),
    md: rem(8),
    lg: rem(12),
    xl: rem(18),
  },

  // Space Grotesk for headings (technical grotesque), Inter for UI text,
  // JetBrains Mono for tabular numeric data (aligned digits in tables/metrics).
  fontFamily:
    "'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontFamilyMonospace:
    "'JetBrains Mono Variable', ui-monospace, 'SF Mono', 'Cascadia Code', monospace",
  headings: {
    fontFamily: "'Space Grotesk Variable', 'Inter Variable', sans-serif",
    fontWeight: '600',
  },

  fontSizes: {
    xs: rem(11),
    sm: rem(13),
    md: rem(14),
    lg: rem(16),
    xl: rem(19),
  },

  defaultGradient: { from: 'petrol.6', to: 'petrol.8', deg: 135 },

  cursorType: 'pointer',

  components: {
    Card: {
      defaultProps: { withBorder: true, radius: 'md' },
    },
    Paper: {
      defaultProps: { withBorder: true },
    },
    Table: {
      defaultProps: { verticalSpacing: 'xs', horizontalSpacing: 'md' },
    },
    // Every report opens on a date range, so "where is today" is the first
    // thing the eye looks for in an open calendar. Set here rather than on each
    // picker so the archives, reports, poll and admin tabs cannot drift apart.
    DatePickerInput: {
      defaultProps: { highlightToday: true },
    },
    DateTimePicker: {
      defaultProps: { highlightToday: true },
    },
    DatePicker: {
      defaultProps: { highlightToday: true },
    },
  },
})

/** Mono, tabular-figures style for numeric data cells/metrics. */
export const numericStyle: CSSProperties = {
  fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: "'tnum' 1",
}
