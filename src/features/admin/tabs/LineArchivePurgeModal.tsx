import { Text } from '@mantine/core'
import { lineAdminApi, type LineArchiveCounts } from '@/api/admin'
import type { Line } from '@/types'
import { ArchiveRangePurgeModal } from './ArchiveRangePurgeModal'

/** The five archives, in the order the screen names them. */
const KINDS: Array<{ key: keyof LineArchiveCounts; label: string }> = [
  { key: 'daily', label: 'Добові' },
  { key: 'hourly', label: 'Годинні' },
  { key: 'edits', label: 'Зміни' },
  { key: 'alarms', label: 'Аварії та події' },
  { key: 'params', label: 'Параметри' },
]

const WARNING =
  "Видаляються всі п'ять архівів разом: добові, годинні, зміни, аварії та " +
  'параметри. Доби — комерційні: з 07:00 до 07:00 наступного дня, тож нічні ' +
  'години до 07:00 належать попередній добі. Це незворотно — повернути їх може ' +
  'лише повторне читання файлів хостлібів, тобто «Оновити» по цьому шляху в адмінці.'

/** Clearing a stretch of one line's archive — all five of them together. */
export function LineArchivePurgeModal({
  line,
  onClose,
}: {
  line: Line | null
  onClose: () => void
}) {
  return (
    <ArchiveRangePurgeModal<LineArchiveCounts>
      opened={!!line}
      onClose={onClose}
      title="Очистити архів лінії"
      subject={
        <Text size="sm">
          Лінія: <b>{line?.name}</b>
        </Text>
      }
      target={`line-${line?.id}`}
      kinds={KINDS}
      preview={(range) => lineAdminApi.previewArchive(line!.id, range)}
      purge={(range) => lineAdminApi.purgeArchive(line!.id, range)}
      wholeLabel="Усього в лінії"
      warning={WARNING}
    />
  )
}

/**
 * The same range cleared on many lines at once — whatever the branch filter of
 * the lines screen shows: one branch's lines when a branch is picked, every
 * line of every branch when it is not.
 */
export function BulkLinesArchivePurgeModal({
  opened,
  branch,
  lineCount,
  onClose,
}: {
  opened: boolean
  /** null — all branches. */
  branch: { id: number; name: string } | null
  lineCount: number
  onClose: () => void
}) {
  const scope = branch ? `філії «${branch.name}»` : 'УСІХ філій'
  return (
    <ArchiveRangePurgeModal<LineArchiveCounts>
      opened={opened}
      onClose={onClose}
      title={branch ? 'Очистити архіви всіх ліній філії' : 'Очистити архіви ліній усіх філій'}
      subject={
        <Text size="sm">
          {branch ? (
            <>
              Філія: <b>{branch.name}</b>
            </>
          ) : (
            <b>Усі філії</b>
          )}{' '}
          — усі лінії ({lineCount})
        </Text>
      }
      target={`bulk-lines-${branch?.id ?? 'all'}`}
      kinds={KINDS}
      preview={(range) => lineAdminApi.previewBulkArchive(branch?.id ?? null, range)}
      purge={(range) => lineAdminApi.purgeBulkArchive(branch?.id ?? null, range)}
      wholeLabel={branch ? 'Усього у філії' : 'Усього в усіх філіях'}
      warning={WARNING}
      confirm={(total) => (
        <Text size="sm">
          Буде видалено <b>{total}</b> записів з архівів <b>усіх {lineCount} ліній</b> {scope}.
          Це незворотно.
        </Text>
      )}
    />
  )
}
