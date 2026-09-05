/**
 * The list of invalidated roots and the list of cached keys used to be two
 * lists, and they drifted: `['report-topology']` and `['flow-calc-topology']`
 * were cached but never invalidated, so a renamed line kept its old name on
 * the ФХП and flow-rate screens for five minutes.
 *
 * These tests fail when a screen caches topology under a key nothing clears —
 * which is the only way that bug can come back.
 */
import { describe, expect, it, vi } from 'vitest'

import { invalidateTopology } from './invalidateTopology'
import { TOPOLOGY_KEYS, TOPOLOGY_ROOTS, reportLinesKey } from './topologyKeys'

/** A QueryClient stub that records what it was asked to invalidate. */
function recordingClient() {
  const cleared: unknown[][] = []
  const qc = {
    invalidateQueries: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      cleared.push([...queryKey])
    },
  }
  return { qc, cleared }
}

/** TanStack matches by key prefix, which is what makes root keys work. */
const isCleared = (cleared: unknown[][], key: readonly unknown[]) =>
  cleared.some((root) => root.every((part, i) => part === key[i]))

describe('invalidateTopology', () => {
  it('clears every key the topology hooks cache under', () => {
    const { qc, cleared } = recordingClient()
    invalidateTopology(qc as never)

    for (const [name, key] of Object.entries(TOPOLOGY_KEYS)) {
      expect(isCleared(cleared, key), `${name} (${JSON.stringify(key)})`).toBe(true)
    }
  })

  it('clears the per-branch line list whatever branch it is for', () => {
    const { qc, cleared } = recordingClient()
    invalidateTopology(qc as never)

    for (const branchId of [1, 9, null]) {
      expect(isCleared(cleared, reportLinesKey(branchId))).toBe(true)
    }
  })

  it('clears the overview summary as well as the tree behind it', () => {
    const { qc, cleared } = recordingClient()
    invalidateTopology(qc as never)

    // Two different roots on purpose: ['overview'] is the branch summary,
    // ['topology'] is the tree it is derived from.
    expect(isCleared(cleared, ['overview', 9])).toBe(true)
    expect(isCleared(cleared, TOPOLOGY_KEYS.overview)).toBe(true)
  })

  it('asks the client once per root and nothing more', () => {
    const invalidateQueries = vi.fn()
    invalidateTopology({ invalidateQueries } as never)
    expect(invalidateQueries).toHaveBeenCalledTimes(TOPOLOGY_ROOTS.length)
  })
})

describe('TOPOLOGY_KEYS', () => {
  it('has no duplicate keys', () => {
    const serialised = Object.values(TOPOLOGY_KEYS).map((k) => JSON.stringify(k))
    expect(new Set(serialised).size).toBe(serialised.length)
  })
})
