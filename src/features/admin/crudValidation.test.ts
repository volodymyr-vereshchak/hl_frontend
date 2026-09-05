import { describe, expect, it } from 'vitest'

import { isFieldMissing, missingFieldLabels } from './crudValidation'

const req = (over: Partial<Parameters<typeof isFieldMissing>[0]> = {}) => ({
  key: 'name',
  label: "Ім'я",
  required: true,
  ...over,
})

describe('isFieldMissing', () => {
  it('an optional field is never missing', () => {
    expect(isFieldMissing({ key: 'name', label: "Ім'я" }, {})).toBe(false)
  })

  it('an unanswered required field is missing', () => {
    expect(isFieldMissing(req(), {})).toBe(true)
    expect(isFieldMissing(req(), { name: null })).toBe(true)
    expect(isFieldMissing(req(), { name: '' })).toBe(true)
  })

  it('an answered one is not', () => {
    expect(isFieldMissing(req(), { name: 'ГРС-1' })).toBe(false)
  })

  it('a checkbox is never missing — false is an answer', () => {
    // Treating it as empty made "не показувати" impossible to save.
    expect(isFieldMissing(req({ type: 'checkbox' }), { name: false })).toBe(false)
    expect(isFieldMissing(req({ type: 'checkbox' }), {})).toBe(false)
  })

  it('an empty list IS missing', () => {
    // The plain null/'' test lets [] through, and the API then rejects the
    // save naming a column the person never saw.
    expect(isFieldMissing(req({ key: 'members' }), { members: [] })).toBe(true)
    expect(isFieldMissing(req({ key: 'members' }), { members: [1] })).toBe(false)
  })

  it('zero and false are answers, not blanks', () => {
    expect(isFieldMissing(req({ type: 'number' }), { name: 0 })).toBe(false)
  })
})

describe('missingFieldLabels', () => {
  it('names the fields still to fill in, in field order', () => {
    const fields = [
      req({ key: 'a', label: 'A' }),
      req({ key: 'b', label: 'B' }),
      { key: 'c', label: 'C' },
    ]
    expect(missingFieldLabels(fields, { b: 'set' })).toEqual(['A'])
  })

  it('never asks for a field the form does not show', () => {
    const fields = [req({ key: 'hidden', label: 'Прихований', hideInForm: true })]
    expect(missingFieldLabels(fields, {})).toEqual([])
  })

  it('is empty when everything is answered', () => {
    expect(missingFieldLabels([req()], { name: 'x' })).toEqual([])
  })
})

describe('the cases the extension was written for', () => {
  it('a branch-access list counts as answered once a branch is picked', () => {
    // UsersTab: the field that could not be expressed as text/number/checkbox/
    // select, and the reason that tab reimplemented the whole table.
    const field = { key: 'branch_ids', label: 'Філії', required: true }
    expect(isFieldMissing(field, { branch_ids: [] })).toBe(true)
    expect(isFieldMissing(field, { branch_ids: [9] })).toBe(false)
  })

  it('a ring with no members is not saveable', () => {
    // RingsTab: "its whole point is the member list".
    const field = { key: 'members', label: 'Лінії кільця', required: true }
    expect(missingFieldLabels([field], { members: [] })).toEqual(['Лінії кільця'])
  })
})
