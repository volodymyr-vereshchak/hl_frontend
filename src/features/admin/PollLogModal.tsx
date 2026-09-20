import { useEffect, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Switch,
  Text,
} from '@mantine/core'
import { IconDownload } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { pollingApi } from '@/api/polling'

/**
 * The journal of one call — the last one, or the one happening right now.
 *
 * One file per site, rewritten by every session, so this is both things at
 * once: the account of what the last call did, and, while an agent is on the
 * phone, the call itself line by line. When it is live the window follows the
 * end of the file the way a terminal does, because a log that has to be
 * scrolled by hand every three seconds is a log nobody watches.
 *
 * Two views of the same call: the operator's account, and every frame it took.
 * The technical one starts closed — it is for working out a fault, and it is
 * read by somebody who is not in the room, which is what the download is for.
 */
export interface PollLogModalProps {
  opened: boolean
  /** The card whose journal to read; null closes the window. */
  deviceId: number | null
  /** What the call is about — the site or line name. */
  label: string
  /** Follow the file: a call is in progress. */
  live?: boolean
  /** A word about the call under the title, e.g. how far it has got. */
  note?: string
  onClose: () => void
}

export function PollLogModal({
  opened,
  deviceId,
  label,
  live = false,
  note,
  onClose,
}: PollLogModalProps) {
  const [technical, setTechnical] = useState(false)
  useEffect(() => {
    if (!opened) setTechnical(false)
  }, [opened])

  const { data, isFetching } = useQuery({
    queryKey: ['admin', 'poll-log', deviceId, technical],
    queryFn: () =>
      technical ? pollingApi.getDebugLog(deviceId!) : pollingApi.getLastLog(deviceId!),
    enabled: opened && deviceId != null,
    // A poll that is running writes into this file as it goes.
    refetchInterval: live ? 3000 : false,
  })

  // Stick to the end while the call runs — but only if the reader is already
  // there. Somebody who has scrolled up is reading something, and yanking the
  // view back every three seconds takes it away from them.
  const viewport = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = viewport.current
    if (!box || !live) return
    const distance = box.scrollHeight - box.scrollTop - box.clientHeight
    if (distance < 120) box.scrollTo({ top: box.scrollHeight })
  }, [data?.text, live])

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`Журнал опитування — ${label}`}
      size="xl"
    >
      <Group justify="space-between" align="center" mb={8} wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          {live && (
            <Badge size="xs" color="blue" variant="light">
              дзвінок триває
            </Badge>
          )}
          <Text size="xs" c="dimmed">
            {note ??
              (data?.updated_at
                ? `Записано ${new Date(data.updated_at).toLocaleString('uk-UA')}`
                : '')}
          </Text>
        </Group>
        <Group gap="sm" wrap="nowrap">
          <Switch
            size="xs"
            checked={technical}
            onChange={(e) => setTechnical(e.currentTarget.checked)}
            label="Технічний журнал"
          />
          {/* The technical journal is read by somebody who is not here: it
              gets sent on. A file is what people attach to a message. */}
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconDownload size={13} />}
            disabled={!data?.text}
            onClick={() => saveJournal(label, data?.text ?? '', technical)}
          >
            Завантажити
          </Button>
        </Group>
      </Group>
      {isFetching && !data ? (
        <Loader size="sm" />
      ) : data?.text ? (
        <ScrollArea h={420} type="auto" viewportRef={viewport}>
          <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
            {data.text}
          </Code>
        </ScrollArea>
      ) : (
        <Text size="sm" c="dimmed">
          {technical
            ? 'Технічного журналу цього дзвінка немає — його пише агент від версії 0.7.0.'
            : live
              ? 'Дзвінок щойно почався — перші рядки з’являться за кілька секунд.'
              : 'Цей об’єкт ще жодного разу не опитували через GSM — журналу немає.'}
        </Text>
      )}
    </Modal>
  )
}

/**
 * Save a journal as a file, named so that a pile of them still makes sense.
 *
 * The site, what kind of journal it is and when it was polled are all in the
 * name, because these travel: the technical one is written for somebody who
 * will read it somewhere else, in a week, next to four others.
 */
export function saveJournal(label: string, text: string, technical: boolean) {
  const site = (label || 'прилад')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 60)
  const when = new Date()
  const stamp = `${String(when.getDate()).padStart(2, '0')}.${String(
    when.getMonth() + 1,
  ).padStart(2, '0')}.${when.getFullYear()}`
  const name = `${technical ? 'технічний' : 'журнал'} ${site} ${stamp}.log`

  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Given back at once: the browser has copied what it needs by now, and a
  // blob left hanging keeps the whole text in memory until the tab closes.
  URL.revokeObjectURL(url)
}
