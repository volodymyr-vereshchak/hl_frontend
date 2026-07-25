import { describe, it, expect } from 'vitest'
import { convertIntToHexToFloat, formatEditValue } from './valueConverter'

describe('convertIntToHexToFloat', () => {
  it('reinterprets an int32 bit pattern as a big-endian float32', () => {
    // 0x3F800000 == 1.0f
    expect(convertIntToHexToFloat(0x3f800000)).toBeCloseTo(1.0, 6)
    // 0x40490FDB ≈ 3.14159f
    expect(convertIntToHexToFloat(0x40490fdb)).toBeCloseTo(3.14159, 4)
  })

  it('handles null/undefined as 0', () => {
    expect(convertIntToHexToFloat(null)).toBe(0)
    expect(convertIntToHexToFloat(undefined)).toBe(0)
  })
})

describe('formatEditValue', () => {
  it('shows small integers (|v| <= 32767) as-is', () => {
    expect(formatEditValue(0)).toBe('0')
    expect(formatEditValue(2)).toBe('2')
    expect(formatEditValue(-15)).toBe('-15')
  })

  it('decodes large ints as float with 4 decimals', () => {
    // 0x40490FDB ≈ 3.14159 → "3.1416"
    expect(formatEditValue(0x40490fdb)).toBe('3.1416')
  })

  it('returns em dash for null', () => {
    expect(formatEditValue(null)).toBe('—')
  })
})
