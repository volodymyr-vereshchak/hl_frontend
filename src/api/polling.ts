import { api } from '@/lib/apiClient'

/**
 * GSM polling settings: which correctors get dialled, and from which machines.
 *
 * Nothing here starts a poll. The modem lives on an operator's workstation, so
 * the server only keeps the register; the agent service pulls its work from
 * its own routes and reports back there.
 */

/**
 * A card binds a phone number to the CORRECTOR it reaches. When the device is
 * replaced, the operator repoints the card at the new serial and the poll
 * follows it from that moment; the point's own history stays continuous in
 * Підприємства. ЛУМГ correctors are not polled over GSM at all — Ask2 keeps
 * doing that.
 */
export type PollTargetKind = 'dpd_device' | 'dpd_line'

export interface PollDevice {
  id: number
  dpd_device_id: number | null
  dpd_line_id: number | null
  target_kind: PollTargetKind
  /** Where the corrector stands: the metering point, or the DPD line. */
  target_label: string | null
  /** What the modem expects to hear back. A reply from another serial is
   *  refused, so this is the whole point of the card. */
  ser_num: number | null
  /** False when the corrector this card names is no longer fitted — a
   *  replacement entered in Підприємства and not here. */
  still_installed: boolean
  /** Agents that took this card. Empty means nobody polls it at all. */
  agent_ids: number[]

  enabled: boolean
  auto_poll: boolean
  /** "HH:MM" list; null = use the global hours. */
  poll_times: string[] | null

  channel: string
  is_modem: boolean
  phone: string | null
  init_str: string
  dial_prefix: string
  tcp_host: string | null
  tcp_port: number | null

  protocol_id: number | null
  device_address: number | null
  answer_timeout_sec: number
  pause_between_ms: number
  repeat_count: number
  preamble_count: number
  depth_days: number | null
  priority: number
  note: string | null

  modem_connect_timeout_sec: number
  modem_repeat_call_count: number
  modem_pause_after_connect_ms: number

  is_adapter: boolean
  adapter_line: number | null
  adapter_speed: number | null
  adapter_level_in: number | null
  adapter_level_out: number | null
  adapter_is_frequency: boolean
  adapter_is_radio: boolean

  last_poll_at: string | null
  last_attempt_at: string | null
  last_status: string | null
  last_error_code: string | null
  last_error_text: string | null
  last_agent_id: number | null
  last_rows: Record<string, number>
  last_duration_ms: number | null
  last_connect_ms: number | null
  manual_requested_at: string | null
  polling_agent_id: number | null
  polling_since: string | null
}

export interface PollAgent {
  id: number
  name: string
  kind: string
  branch_id: number | null
  active: boolean
  last_seen_at: string | null
  version: string | null
  host: string | null
  device_count: number
}

/** The one response that carries the key in clear — it exists nowhere else. */
export interface PollAgentCreated extends PollAgent {
  key: string
}

export const pollingApi = {
  /** Readable by anyone signed in: which devices are polled and by whom. */
  getDevices: () => api.get<PollDevice[]>('/polling/devices'),
  createDevice: (data: Record<string, unknown>) =>
    api.post<PollDevice>('/polling/devices', data),
  updateDevice: (id: number, data: Record<string, unknown>) =>
    api.put<PollDevice>(`/polling/devices/${id}`, data),
  removeDevice: (id: number) => api.delete<true>(`/polling/devices/${id}`),
  /**
   * Ask for an out-of-turn poll — allowed to any signed-in user, not just an
   * admin. Answers 202: nothing starts here, the request waits for the agent
   * that owns the modem to come asking for its plan.
   */
  requestPoll: (id: number) =>
    api.post<{ requested_at: string | null }>(`/polling/devices/${id}/poll`),
  cancelPoll: (id: number) =>
    api.post<{ requested_at: string | null }>(
      `/polling/devices/${id}/poll?cancel=true`,
    ),

  getAgents: () => api.get<PollAgent[]>('/polling/agents'),
  createAgent: (data: Record<string, unknown>) =>
    api.post<PollAgentCreated>('/polling/agents', data),
  updateAgent: (id: number, data: Record<string, unknown>) =>
    api.put<PollAgent>(`/polling/agents/${id}`, data),
  /** Issues a new key; the old one stops working at once. */
  rotateKey: (id: number) =>
    api.post<PollAgentCreated>(`/polling/agents/${id}/key`),
  removeAgent: (id: number) => api.delete<true>(`/polling/agents/${id}`),

  getAgentDevices: (id: number) => api.get<number[]>(`/polling/agents/${id}/devices`),
  setAgentDevices: (id: number, deviceIds: number[]) =>
    api.put<number[]>(`/polling/agents/${id}/devices`, { device_ids: deviceIds }),

  getSchedule: () => api.get<{ poll_times: string[] }>('/polling/schedule'),
  setSchedule: (pollTimes: string[]) =>
    api.put<{ poll_times: string[] }>('/polling/schedule', { poll_times: pollTimes }),
}
