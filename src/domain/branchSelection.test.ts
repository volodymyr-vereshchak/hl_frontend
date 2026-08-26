import { describe, it, expect } from 'vitest'
import { resolveBranchId } from './branchSelection'

describe('resolveBranchId', () => {
  const branches = [{ id: 2 }, { id: 9 }]

  it('keeps a selection the server still knows about', () => {
    expect(resolveBranchId(9, branches)).toBe(9)
  })

  it('replaces a branch that no longer exists', () => {
    // What actually happened: branch 1 was left in localStorage, the branch
    // list came back as 2 and 9, and every report queried branch 1.
    expect(resolveBranchId(1, branches)).toBe(2)
  })

  it('picks the first branch when nothing is selected', () => {
    expect(resolveBranchId(null, branches)).toBe(2)
  })

  it('has nothing to pick when the user may see no branch at all', () => {
    expect(resolveBranchId(9, [])).toBeNull()
    expect(resolveBranchId(null, [])).toBeNull()
  })
})
