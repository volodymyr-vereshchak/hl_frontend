/**
 * Reading a metering point's current corrector.
 *
 * These helpers exist because the corrector is no longer a property of the
 * point: it has its own history and a foreign key into the catalog, so both the
 * serial and the model name have to be taken from the last entry of `devices[]`.
 */
import { describe, expect, it } from 'vitest'
import {
  correctorLabel,
  currentDevice,
  type EnterpriseDeviceRow,
  type EnterpriseMappingRow,
} from './enterprise'

const device = (over: Partial<EnterpriseDeviceRow> = {}): EnterpriseDeviceRow => ({
  id: 1,
  device_id: 1,
  ser_num: 4501,
  ch_num: 0,
  installed_from: '2000-01-01T00:00:00',
  manufacturer_short_name: 'ВЕГА',
  model_name: 'ВЕГА-1.01',
  ...over,
})

const point = (devices: EnterpriseDeviceRow[]): EnterpriseMappingRow => ({
  id: 10,
  enterprise_name: 'Хлібзавод',
  devices,
})

describe('correctorLabel', () => {
  it('joins the manufacturer and the model of the fitted corrector', () => {
    expect(correctorLabel(point([device()]))).toBe('ВЕГА ВЕГА-1.01')
  })

  it('follows a replacement — the name comes from the device standing there now', () => {
    const p = point([
      device({ id: 1, removed_at: '2026-04-01T08:00:00' }),
      device({
        id: 2,
        device_id: 2,
        installed_from: '2026-04-01T08:00:00',
        manufacturer_short_name: 'ФЛОУТЕК',
        model_name: 'ТМ-Р',
      }),
    ])
    expect(currentDevice(p)?.device_id).toBe(2)
    expect(correctorLabel(p)).toBe('ФЛОУТЕК ТМ-Р')
  })

  it('is empty for a point with no history at all', () => {
    expect(correctorLabel(point([]))).toBe('')
    expect(correctorLabel({ id: 11 })).toBe('')
  })

  it('is empty for a device the catalog does not know', () => {
    // Not linked to a corector_type: the migration left rows whose raw DPD
    // codes matched nothing, and they carry no names to show.
    const unlinked = device({
      corector_type_id: null,
      manufacturer_short_name: null,
      model_name: null,
      mf_dev: 12,
      type_dev: 3,
    })
    expect(correctorLabel(point([unlinked]))).toBe('')
  })

  it('shows whichever half is known rather than nothing', () => {
    expect(correctorLabel(point([device({ manufacturer_short_name: null })]))).toBe('ВЕГА-1.01')
  })
})
