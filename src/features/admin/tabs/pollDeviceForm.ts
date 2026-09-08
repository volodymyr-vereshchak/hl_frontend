/**
 * Form values of the polling card → the request body.
 *
 * Split out of the tab because one field is not a straight copy and gets it
 * wrong in a way nobody would notice: the poll hours are typed as free text
 * ("06:00, 18:00" is how they are written down), and an EMPTY box does not
 * mean "no hours" — it means "use the global ones", which the API spells as
 * null. Sending `[]` instead would produce a device that is scheduled and
 * never due.
 */
export interface PollDeviceFormValues {
  enabled?: unknown
  auto_poll?: unknown
  poll_times?: unknown
  phone?: unknown
  protocol_id?: unknown
  device_address?: unknown
  baud?: unknown
  priority?: unknown
  depth_days?: unknown
  note?: unknown
}

/** "06:00, 18:00" → ["06:00", "18:00"]; blank → null (the global hours). */
export function parsePollTimes(raw: unknown): string[] | null {
  const times = String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return times.length ? times : null
}

const text = (v: unknown): string | null => String(v ?? '').trim() || null

export function pollDevicePayload(v: PollDeviceFormValues): Record<string, unknown> {
  return {
    // Checkboxes arrive as undefined until touched, and both of these default
    // to on: a card created with the box untouched has to be enabled.
    enabled: v.enabled !== false,
    auto_poll: v.auto_poll !== false,
    poll_times: parsePollTimes(v.poll_times),
    phone: text(v.phone),
    protocol_id: v.protocol_id ?? null,
    device_address: v.device_address ?? null,
    baud: v.baud ?? 9600,
    priority: v.priority ?? 0,
    depth_days: v.depth_days ?? null,
    note: text(v.note),
  }
}
