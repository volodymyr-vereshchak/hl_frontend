import { describe, it, expect } from 'vitest'
import { formatDetail } from './apiClient'

describe('formatDetail', () => {
  it('passes a plain HTTPException detail through', () => {
    expect(formatDetail('Обчислювач з такою адресою вже існує')).toBe(
      'Обчислювач з такою адресою вже існує',
    )
  })

  it('names the field of a 422 instead of dumping its JSON', () => {
    const body = [
      { type: 'missing', loc: ['body', 'c_time'], msg: 'Field required' },
      { type: 'missing', loc: ['body', 'address'], msg: 'Field required' },
    ]
    expect(formatDetail(body)).toBe('c_time: Field required; address: Field required')
  })

  it('keeps the message when the issue carries no location', () => {
    expect(formatDetail([{ msg: 'Value error, address must be positive' }])).toBe(
      'Value error, address must be positive',
    )
  })

  it('falls back to JSON for a shape it does not know', () => {
    expect(formatDetail({ code: 17 })).toBe('{"code":17}')
  })
})
