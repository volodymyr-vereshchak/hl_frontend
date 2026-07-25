/**
 * GRS domain config — runtime-injected by the Python server via
 * window.APP_CONFIG.GRS_CONFIG, with build-time fallbacks.
 * CONTRACT_HOUR (commercial-day start) is also refreshed at boot from GET /config.
 */

export interface GrsConfig {
  CONTRACT_HOUR: number
  LUMG_ID: number
  LINES_IDS: number[]
  HIGH_P_LINES_IDS: number[]
  TRENDS_IDS: number[]
  PRESSURE_DIVISOR: number
}

declare global {
  interface Window {
    APP_CONFIG?: {
      API_URL?: string
      GRS_CONFIG?: Partial<GrsConfig>
    }
  }
}

const DEFAULT_CONFIG: GrsConfig = {
  CONTRACT_HOUR: 7,
  LUMG_ID: 2,
  LINES_IDS: [1, 4, 5, 21, 20, 19, 18, 16, 6, 8, 15, 17, 12, 10, 11],
  HIGH_P_LINES_IDS: [1, 6, 8, 12],
  TRENDS_IDS: [6, 11, 16, 17, 18, 19, 20, 21, 1001, 1002, 1003, 1004],
  PRESSURE_DIVISOR: 10000,
}

export const grsConfig: GrsConfig = {
  ...DEFAULT_CONFIG,
  ...(typeof window !== 'undefined' ? window.APP_CONFIG?.GRS_CONFIG : undefined),
}
