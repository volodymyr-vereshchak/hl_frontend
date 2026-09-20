import { api, apiBaseUrl } from '@/lib/apiClient'

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
export type PollTargetKind = 'enterprise' | 'dpd_device' | 'dpd_line'

export interface PollDevice {
  id: number
  /** The usual target: the modem stands at the enterprise, and which
   *  corrector is under it is resolved at poll time from the installation
   *  history. A replacement then needs nobody to repoint anything. */
  enterprise_id: number | null
  dpd_device_id: number | null
  dpd_line_id: number | null
  target_kind: PollTargetKind
  /** Where the corrector stands: the metering point, or the DPD line. */
  target_label: string | null
  /** What the modem expects to hear back. A reply from another serial is
   *  refused, so this is the whole point of the card. */
  ser_num: number | null
  /** What answers the call. The model decides the driver, whether the network
   *  address is a question, and how the alarm codes are read. */
  model_name: string | null
  manufacturer: string | null
  /** False when the corrector this card names is no longer fitted — a
   *  replacement entered in Підприємства and not here. */
  still_installed: boolean
  /** Agents that took this card. Empty means nobody polls it at all. */
  agent_ids: number[]

  enabled: boolean
  auto_poll: boolean
  /** "HH:MM" list; null = use the global hours. */
  poll_cron: string | null

  channel: string
  is_modem: boolean
  phone: string | null
  init_str: string
  dial_prefix: string
  tcp_host: string | null
  tcp_port: number | null

  /** From the corrector's model, never typed on the card. null = no Ask2
   *  driver covers that model, so it cannot be polled by modem. */
  protocol_id: number | null
  device_address: number | null
  /** Whether the address is a real choice for this driver — only Floutek,
   *  where several correctors share a line. */
  address_matters: boolean
  answer_timeout_sec: number
  pause_between_ms: number
  repeat_count: number
  preamble_count: number
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

  /** What the corrector called itself on the last call that reached it —
   *  not always what the catalogue calls it. Null until one did. */
  detected_model: string | null
  detected_protocol: number | null

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
  /** How far the running session has got, in records. */
  progress_done: number | null
  progress_total: number | null
}

/** The call an agent is on right now, from the claim it holds on a card. */
export interface PollAgentBusy {
  poll_device_id: number
  label: string | null
  since: string | null
  phase: 'hourly' | 'daily' | null
  done: number | null
  total: number | null
}

export interface PollAgent {
  id: number
  name: string
  branch_id: number | null
  active: boolean
  last_seen_at: string | null
  version: string | null
  host: string | null
  device_count: number
  /** Heard from within the last minute — decided by the server, by the same
   *  rule that refuses an immediate poll when no modem is free. */
  online: boolean
  /** False when this agent is not the build the server hands out. */
  version_ok: boolean
  expected_version: string | null
  /** Whom this agent is dialling at this moment, or null when it is free.
   *  Online and busy are different questions, and the screen used to answer
   *  only the first. */
  busy: PollAgentBusy | null
}

/** The one response that carries the key in clear — it exists nowhere else. */
export interface PollAgentCreated extends PollAgent {
  key: string
}

/**
 * The packaged agent (.exe) the server hands out.
 *
 * A build artifact, not source: it is put on the server the way a frontend
 * build is, so "there is no build here yet" is a normal answer and the screen
 * has to be able to say it.
 */
export interface AgentInstaller {
  available: boolean
  filename: string | null
  version: string | null
  size: number | null
  built_at: string | null
}

export interface PollJournal {
  poll_device_id: number
  /** null — this site has never been polled from here. */
  text: string | null
  updated_at: string | null
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
  /** What build is on the server — asked before the button is drawn. */
  getAgentInstaller: () =>
    api.get<AgentInstaller>('/polling/agents/installer/info'),
  /** Straight to the browser: the JSON client cannot save a file, and the
   *  cookie travels with the navigation. */
  downloadAgent: () =>
    window.open(`${apiBaseUrl()}/polling/agents/installer`, '_blank'),
  createAgent: (data: Record<string, unknown>) =>
    api.post<PollAgentCreated>('/polling/agents', data),
  updateAgent: (id: number, data: Record<string, unknown>) =>
    api.put<PollAgent>(`/polling/agents/${id}`, data),
  /** Issues a new key; the old one stops working at once. */
  rotateKey: (id: number) =>
    api.post<PollAgentCreated>(`/polling/agents/${id}/key`),
  removeAgent: (id: number) => api.delete<true>(`/polling/agents/${id}`),

  getAgentDevices: (id: number) => api.get<number[]>(`/polling/agents/${id}/devices`),

  /** The log of the last session, kept in a file per site: the live one is
   *  wiped when the next poll starts. */
  getLastLog: (deviceId: number) =>
    api.get<PollJournal>(`/polling/devices/${deviceId}/log/last`),

  /** The same call frame by frame — kept the same way, one file per site,
   *  the last call only. For working out why a poll failed, not for reading. */
  getDebugLog: (deviceId: number) =>
    api.get<PollJournal>(`/polling/devices/${deviceId}/log/debug`),

  /** Which machines dial one site. The mirror of setAgentDevices, and the
   *  shape the monitor needs: there a row is a site, not an agent, so moving
   *  one site between two machines must not rewrite either machine's set. */
  setDeviceAgents: (deviceId: number, agentIds: number[]) =>
    api.put<number[]>(`/polling/devices/${deviceId}/agents`, { agent_ids: agentIds }),
  setAgentDevices: (id: number, deviceIds: number[]) =>
    api.put<number[]>(`/polling/agents/${id}/devices`, { device_ids: deviceIds }),

  getSchedule: () => api.get<{ poll_cron: string }>('/polling/schedule'),
  setSchedule: (pollCron: string) =>
    api.put<{ poll_cron: string }>('/polling/schedule', { poll_cron: pollCron }),
}

/**
 * Polling one enterprise over its own modem, and watching it happen.
 *
 * The call is made on an operator's workstation, not here, so «опитати» is a
 * request rather than an action: the agent beside the modem picks it up on its
 * next look, seconds later, and the screen follows the session through the
 * log it pushes as it goes.
 */
export interface EnterprisePollStart {
  poll_device_id: number
  ser_num: number | null
  model_name: string | null
  /** Which machine will make the call — worth showing, because on a bad day
   *  the answer to "why is nothing happening" is that it is somebody else's. */
  agent_name: string | null
}

export interface PollLogLine {
  seq: number
  /** null for a line the journal could not date — one written by an older
   *  version, or by the corrector itself. */
  ts: string | null
  level: string
  message: string
}

export interface PollWatch {
  poll_device_id: number
  /** waiting — the request is in, nobody has picked it up yet;
   *  polling — an agent holds the device and is on the phone;
   *  ok / error — how the last session ended. */
  status: 'waiting' | 'polling' | 'ok' | 'error'
  agent_name: string | null
  ser_num: number | null
  started_at: string | null
  finished_at: string | null
  error_code: string | null
  error_text: string | null
  rows: Record<string, number>
  /** Records read and records to read. A month of hours is seven hundred
   *  requests down a phone line, so this is the only thing that moves. */
  done: number | null
  total: number | null
  /** Which archive those numbers count. Without it the bar counted days
   *  under a caption that said hours. */
  phase: 'hourly' | 'daily' | null
  /** Somebody asked this call to stop and the agent has not hung up yet. */
  cancelling: boolean
  lines: PollLogLine[]
}

/** What stopping a poll actually did. */
export interface PollCancelled {
  /** queued — withdrawn before any agent took it; asked — the agent has been
   *  told to hang up; idle — there was nothing running. */
  outcome: 'queued' | 'asked' | 'idle'
  detail: string
}

export const enterprisePollApi = {
  /** Ask for a poll now. Refuses, with a sentence, when there is no modem,
   *  nothing fitted, or no agent on the line. */
  start: (enterpriseId: number) =>
    api.post<EnterprisePollStart>(`/polling/enterprises/${enterpriseId}/poll`),

  /** Everything after `afterSeq`, so a screen refreshing every second asks
   *  only for what it does not already have. */
  watch: (enterpriseId: number, afterSeq = 0) =>
    api.get<PollWatch>(`/polling/enterprises/${enterpriseId}/poll`, {
      after_seq: afterSeq,
    }),

  /** Stop it. A request nobody took is withdrawn; a call in progress is asked
   *  to hang up, and the agent does so between records. */
  cancel: (enterpriseId: number) =>
    api.post<PollCancelled>(`/polling/enterprises/${enterpriseId}/poll/cancel`),
}
