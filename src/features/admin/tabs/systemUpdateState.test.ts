import { describe, expect, it } from 'vitest'
import type { CommitInfo, UpdateCheck } from '@/api/systemUpdate'
import { checkIsStale, pendingCommits, updateBlocker, updateTarget } from './systemUpdateState'

const commit = (sha: string): CommitInfo => ({
  sha,
  short: sha.slice(0, 8),
  date: '2026-10-28T10:00:00+02:00',
  author: 't',
  subject: 's',
})

const NOW = Date.parse('2026-10-28T12:00:00+02:00')

function check(over: Partial<UpdateCheck> = {}): UpdateCheck {
  return {
    checked_at: '2026-10-28T11:50:00+02:00',
    problems: [],
    notes: [],
    repos: {
      backend: {
        url: 'u',
        branch: 'master',
        error: null,
        head: commit('a'.repeat(40)),
        remote: commit('b'.repeat(40)),
        ahead: 2,
      },
      frontend: {
        url: 'u',
        branch: 'main',
        error: null,
        head: commit('c'.repeat(40)),
        remote: commit('c'.repeat(40)),
        ahead: 0,
      },
    },
    ...over,
  }
}

describe('updateTarget', () => {
  it('takes only the repositories with something new, at the commit shown', () => {
    expect(updateTarget(check())).toEqual({ backend: 'b'.repeat(40) })
  })
})

describe('updateBlocker', () => {
  it('allows a fresh check with new commits and no problems', () => {
    expect(updateBlocker(check(), false, NOW)).toBeNull()
    expect(pendingCommits(check())).toBe(2)
  })

  it('names the reason otherwise', () => {
    expect(updateBlocker(null, false, NOW)).toMatch(/перевірте/)
    expect(updateBlocker(check(), true, NOW)).toMatch(/виконується/)
    expect(updateBlocker(check({ problems: ['dirty'] }), false, NOW)).toMatch(/перешкоди/)
    const nothing = check()
    nothing.repos.backend!.ahead = 0
    expect(updateBlocker(nothing, false, NOW)).toMatch(/Нових змін немає/)
  })

  it('asks for a new check when the last one is old', () => {
    const old = check({ checked_at: '2026-10-28T09:00:00+02:00' })
    expect(checkIsStale(old, NOW)).toBe(true)
    expect(updateBlocker(old, false, NOW)).toMatch(/застаріла/)
  })
})
