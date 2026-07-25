/**
 * Overview Calculator — GRS overview metrics (ported 1:1 from the old
 * utils/overviewCalculator.js). Pure functions over hourly archive records.
 */

import {
  PRESSURE_UNIT_DEFAULT,
  DP_UNIT_DEFAULT,
  convertPressureValue,
} from './pressureUnits'
import type { Line } from '@/types'

export interface HourlyRecord {
  line_id: number
  period: string
  volume?: number
  pressure?: number
  w_volume_dp?: number
  temperature?: number
  density?: number
  [key: string]: number | string | null | undefined
}

export interface VolumeComparison {
  current: number
  previous: number
  change: number
  changePercent: number
  isIncrease: boolean
  isDecrease: boolean
  isEqual: boolean
}

export interface FlowComparison {
  lineId: number
  lastHour: number
  previousHour: number
  change: number
  changePercent: number
  isIncrease: boolean
  isDecrease: boolean
}

export interface LineVolumeComparison {
  lineId: number
  current24h: number
  previous24h: number
  change: number
  changePercent: number
  isIncrease: boolean
  isDecrease: boolean
}

export interface DpData {
  currentDp: number
  maxDp24h: number
  minDp: number
  maxDp: number
  hasDpData: boolean
  isMeter: boolean
}

export interface PressureReading {
  pressure: number
  minPressure24h: number | null
  maxPressure24h: number | null
  timestamp: Date
  isHighPressure: boolean
  recordCount: number
  dpData: DpData | null
  pressureUnit: string
  dpUnit: string
}

export type ParamsMap = Record<number, { min_dp: number; max_dp: number }>

const round3 = (n: number) => Math.round(n * 1000) / 1000

export class OverviewCalculator {
  static calculate24hTotal(data: HourlyRecord[], lineIds: number[]): number {
    if (!Array.isArray(data)) return 0
    const total = data
      .filter((r) => lineIds.includes(r.line_id))
      .reduce((sum, r) => sum + (r.volume || 0), 0)
    return round3(total)
  }

  static calculateComparison(current: number, previous: number): VolumeComparison {
    const change = current - previous
    const changePercent = previous !== 0 ? (change / previous) * 100 : 0
    return {
      current: round3(current),
      previous: round3(previous),
      change: round3(change),
      changePercent: Math.round(changePercent * 10) / 10,
      isIncrease: change > 0,
      isDecrease: change < 0,
      isEqual: Math.abs(change) < 0.001,
    }
  }

  static calculateLastHourFlow(data: HourlyRecord[], lineIds: number[]): FlowComparison[] {
    if (!Array.isArray(data) || !Array.isArray(lineIds)) return []
    const results: FlowComparison[] = []
    for (const lineId of lineIds) {
      const lineRecords = data
        .filter((r) => r.line_id === lineId)
        .map((r) => ({ ...r, periodDate: new Date(r.period) }))
        .filter((r) => !isNaN(r.periodDate.getTime()))
        .sort((a, b) => b.periodDate.getTime() - a.periodDate.getTime())
      if (lineRecords.length < 2) continue
      const lastHour = lineRecords[0].volume || 0
      const previousHour = lineRecords[1].volume || 0
      const change = lastHour - previousHour
      const changePercent = previousHour !== 0 ? (change / previousHour) * 100 : 0
      results.push({
        lineId,
        lastHour,
        previousHour,
        change,
        changePercent,
        isIncrease: change > 0,
        isDecrease: change < 0,
      })
    }
    return results
  }

  static calculate24hVolumeByLine(
    currentData: HourlyRecord[],
    previousData: HourlyRecord[],
    lineIds: number[],
  ): LineVolumeComparison[] {
    if (!Array.isArray(currentData) || !Array.isArray(previousData) || !Array.isArray(lineIds)) {
      return []
    }
    const results: LineVolumeComparison[] = []
    for (const lineId of lineIds) {
      const current24h = currentData
        .filter((r) => r.line_id === lineId)
        .reduce((sum, r) => sum + (r.volume || 0), 0)
      const previous24h = previousData
        .filter((r) => r.line_id === lineId)
        .reduce((sum, r) => sum + (r.volume || 0), 0)
      const change = current24h - previous24h
      const changePercent = previous24h !== 0 ? (change / previous24h) * 100 : 0
      results.push({
        lineId,
        current24h,
        previous24h,
        change,
        changePercent,
        isIncrease: change > 0,
        isDecrease: change < 0,
      })
    }
    return results
  }

  static getLastPressures(
    data: HourlyRecord[],
    lineIds: number[],
    lines: Line[],
    paramsMap: ParamsMap | null = null,
  ): Record<number, PressureReading> {
    if (!Array.isArray(data) || !lines) return {}
    const pressures: Record<number, PressureReading> = {}

    for (const lineId of lineIds) {
      const lineRecords = data
        .filter((r) => r.line_id === lineId)
        .map((r) => ({ ...r, periodDate: r.period ? new Date(r.period) : null }))
        .filter((r): r is HourlyRecord & { periodDate: Date } =>
          r.periodDate !== null && !isNaN(r.periodDate.getTime()),
        )
        .sort((a, b) => b.periodDate.getTime() - a.periodDate.getTime())

      if (lineRecords.length === 0) continue

      const lastRecord = lineRecords[0]
      const line = lines.find((l) => l.id === lineId)

      const windowStart = lastRecord.periodDate.getTime() - 24 * 60 * 60 * 1000
      const records24h = lineRecords.filter((r) => r.periodDate.getTime() >= windowStart)

      const isHighPressure = line ? line.is_high_pressure || false : false
      const pressureUnit = (line && line.pressure_unit) || PRESSURE_UNIT_DEFAULT
      const dpUnit = (line && line.dp_unit) || DP_UNIT_DEFAULT

      let pressure = lastRecord.pressure || 0
      const wVolumeDp = lastRecord.w_volume_dp || 0
      if (!isHighPressure && line && !line.meter) {
        pressure = pressure - convertPressureValue(wVolumeDp, dpUnit, pressureUnit)
      }
      pressure = round3(pressure)

      const maxDp24h = records24h.reduce((max, r) => {
        const dp = r.w_volume_dp || 0
        return dp > max ? dp : max
      }, 0)

      const dpData: DpData | null =
        line && paramsMap && paramsMap[lineId]
          ? {
              currentDp: Math.round(wVolumeDp * 100) / 100,
              maxDp24h: Math.round(maxDp24h * 100) / 100,
              minDp: paramsMap[lineId].min_dp || 0,
              maxDp: paramsMap[lineId].max_dp || paramsMap[lineId].min_dp + 100 || 100,
              hasDpData: (paramsMap[lineId].max_dp || 0) > (paramsMap[lineId].min_dp || 0),
              isMeter: line.meter === true,
            }
          : null

      const pressureValues = records24h.map((r) => {
        let p = r.pressure || 0
        if (!isHighPressure && line && !line.meter) {
          p = p - convertPressureValue(r.w_volume_dp || 0, dpUnit, pressureUnit)
        }
        return round3(p)
      })
      const minPressure24h = pressureValues.length ? Math.min(...pressureValues) : null
      const maxPressure24h = pressureValues.length ? Math.max(...pressureValues) : null

      pressures[lineId] = {
        pressure,
        minPressure24h,
        maxPressure24h,
        timestamp: lastRecord.periodDate,
        isHighPressure,
        recordCount: lineRecords.length,
        dpData,
        pressureUnit,
        dpUnit,
      }
    }
    return pressures
  }

  static getPressureRange(isHighPressure: boolean): { min: number; max: number } {
    return isHighPressure ? { min: 0, max: 50 } : { min: 0, max: 7 }
  }
}
