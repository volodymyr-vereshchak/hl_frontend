import { describe, expect, it } from 'vitest'
import { stateOf } from './PollDevicesTab'
import type { PollDevice } from '@/api/polling'

/**
 * The word the monitor puts on a row, and the value its filter selects on.
 *
 * One function for both, because two would eventually disagree — and a row
 * filtered as «з помилкою» that shows a green last poll is worse than having
 * no filter at all.
 */
const card = (over: Partial<PollDevice> = {}): PollDevice =>
  ({
    id: 1,
    enterprise_id: 7,
    enabled: true,
    auto_poll: true,
    agent_ids: [3],
    last_status: 'ok',
    manual_requested_at: null,
    polling_agent_id: null,
    ...over,
  }) as unknown as PollDevice

describe('stateOf', () => {
  it('reports what is happening now before what happened last', () => {
    // A site being polled right now has a last_status from the call before
    // it, and showing that one would describe the wrong session.
    expect(stateOf(card({ polling_agent_id: 3, last_status: 'error' })))
      .toBe('polling')
    expect(stateOf(card({ manual_requested_at: '2026-09-15T10:00:00' })))
      .toBe('queued')
  })

  it('puts a site nobody dials in its own state', () => {
    // It is not an error and not a success: nothing has been attempted. On
    // every other column it looks exactly like a site that is fine.
    expect(stateOf(card({ agent_ids: [] }))).toBe('unassigned')
  })

  it('separates never polled from polled and failed', () => {
    expect(stateOf(card({ last_status: null }))).toBe('never')
    expect(stateOf(card({ last_status: 'error' }))).toBe('error')
    expect(stateOf(card())).toBe('ok')
  })

  it('reports a disabled card as disabled, whatever its history', () => {
    expect(stateOf(card({ enabled: false, last_status: 'ok' }))).toBe('off')
  })
})
