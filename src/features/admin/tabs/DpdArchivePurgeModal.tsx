import { Stack, Text } from '@mantine/core'
import { dpdLineAdminApi, type DpdLineArchiveCounts } from '@/api/admin'
import type { DpdLine } from '@/types'
import { ArchiveRangePurgeModal } from './ArchiveRangePurgeModal'

const KINDS: Array<{ key: keyof DpdLineArchiveCounts; label: string }> = [
  { key: 'daily', label: 'Добові' },
  { key: 'hourly', label: 'Годинні' },
]

/**
 * What a DPD line gets back afterwards differs from a hostlib line: nothing
 * re-reads files, the scheduled update polls each line from its newest stored
 * period on. So a stretch cleared at the end of the archive returns by itself,
 * and one cleared before the newest record stays gone until initialization.
 */
const WARNING = (
  <Stack gap={4}>
    <Text size="sm">
      Видаляються добові та годинні архіви разом. Доби — комерційні: з 07:00 до 07:00
      наступного дня.
    </Text>
    <Text size="sm">
      Що видалено в кінці архіву, наступне оновлення начитає з ДПД знову. Що видалено
      раніше за останній запис — не повернеться саме: лише «Ініціалізація» лінії.
    </Text>
  </Stack>
)

export function DpdLineArchivePurgeModal({
  line,
  onClose,
}: {
  line: DpdLine | null
  onClose: () => void
}) {
  return (
    <ArchiveRangePurgeModal<DpdLineArchiveCounts>
      opened={!!line}
      onClose={onClose}
      title="Очистити архів лінії ДПД"
      subject={
        <Text size="sm">
          Лінія ДПД: <b>{line?.name}</b>
        </Text>
      }
      target={`dpd-line-${line?.id}`}
      kinds={KINDS}
      preview={(range) => dpdLineAdminApi.previewArchive(line!.id, range)}
      purge={(range) => dpdLineAdminApi.purgeArchive(line!.id, range)}
      wholeLabel="Усього в лінії"
      warning={WARNING}
    />
  )
}

/** Every DPD line under the branch filter: one branch's, or all of them. */
export function BulkDpdArchivePurgeModal({
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
    <ArchiveRangePurgeModal<DpdLineArchiveCounts>
      opened={opened}
      onClose={onClose}
      title={branch ? 'Очистити архіви всіх ліній ДПД філії' : 'Очистити архіви ліній ДПД усіх філій'}
      subject={
        <Text size="sm">
          {branch ? (
            <>
              Філія: <b>{branch.name}</b>
            </>
          ) : (
            <b>Усі філії</b>
          )}{' '}
          — усі лінії ДПД ({lineCount})
        </Text>
      }
      target={`bulk-dpd-${branch?.id ?? 'all'}`}
      kinds={KINDS}
      preview={(range) => dpdLineAdminApi.previewBulkArchive(branch?.id ?? null, range)}
      purge={(range) => dpdLineAdminApi.purgeBulkArchive(branch?.id ?? null, range)}
      wholeLabel={branch ? 'Усього у філії' : 'Усього в усіх філіях'}
      warning={WARNING}
      confirm={(total) => (
        <Text size="sm">
          Буде видалено <b>{total}</b> записів з архівів <b>усіх {lineCount} ліній ДПД</b>{' '}
          {scope}. Це незворотно.
        </Text>
      )}
    />
  )
}
