import { Box, Divider, Group, Kbd, Modal, Stack, Text } from '@mantine/core'
import { MAIN_NAV } from '@/app/navItems'
import { useLanguage } from '@/locales/LanguageContext'
import type { TranslationKey } from '@/locales'

interface Row {
  /** Each entry is one key; several entries read as "or". */
  keys: string[][]
  label: string
}

/** `Alt` `1` — one chord, drawn as its keys with a + between them. */
function Chord({ keys }: { keys: string[] }) {
  return (
    <Group gap={3} wrap="nowrap">
      {keys.map((k, i) => (
        <Box key={i} component="span">
          {i > 0 && (
            <Text component="span" size="xs" c="dimmed" mr={3}>
              +
            </Text>
          )}
          <Kbd size="xs">{k}</Kbd>
        </Box>
      ))}
    </Group>
  )
}

function Section({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <Box>
      <Text fw={700} size="sm" mb={6}>
        {title}
      </Text>
      <Box className="hlv-keys">
        {rows.map((row, i) => (
          <Box key={i} style={{ display: 'contents' }}>
            <Group gap={6} wrap="nowrap">
              {row.keys.map((chord, j) => (
                <Group key={j} gap={6} wrap="nowrap">
                  {j > 0 && (
                    <Text component="span" size="xs" c="dimmed">
                      /
                    </Text>
                  )}
                  <Chord keys={chord} />
                </Group>
              ))}
            </Group>
            <Text size="sm">{row.label}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/**
 * The shortcut list, opened with "?" or from the header. Written from the same
 * nav array the header draws, so the numbers in it cannot drift from the
 * buttons they stand for.
 */
export function HotkeysHelpModal({
  opened,
  onClose,
  isAdmin,
}: {
  opened: boolean
  onClose: () => void
  isAdmin: boolean
}) {
  const { t } = useLanguage()
  const tr = (key: TranslationKey) => t(key)

  const navRows: Row[] = MAIN_NAV.map((item, i) => ({
    keys: [['Alt', String(i + 1)]],
    label: tr(item.labelKey),
  }))
  navRows.push({ keys: [['Alt', '8']], label: `${tr('navReports')} — ${tr('hkOpenMenu')}` })
  if (isAdmin) navRows.push({ keys: [['Alt', '9']], label: tr('navAdmin') })
  navRows.push({ keys: [['?']], label: tr('hkThisList') })

  const treeRows: Row[] = [
    { keys: [['Alt', 'T']], label: tr('hkFocusTree') },
    { keys: [['Tab']], label: tr('hkTreeEnter') },
    { keys: [['↑'], ['↓']], label: tr('hkTreeMove') },
    { keys: [['→']], label: tr('hkTreeExpand') },
    { keys: [['←']], label: tr('hkTreeCollapse') },
    { keys: [['Enter']], label: tr('hkTreeSelect') },
    { keys: [['Home'], ['End']], label: tr('hkTreeEnds') },
    { keys: [['PgUp'], ['PgDn']], label: tr('hkTreePage') },
    { keys: [['*']], label: tr('hkTreeStar') },
    { keys: [['A'], ['Б']], label: tr('hkTreeTypeAhead') },
    { keys: [['/']], label: tr('hkTreeSearch') },
    { keys: [['Esc']], label: tr('hkTreeEscape') },
  ]

  const archiveRows: Row[] = [
    { keys: [['Alt', 'F']], label: tr('activateDate') },
    { keys: [['Alt', 'E']], label: tr('hkExport') },
    { keys: [['Alt', 'G']], label: tr('hkToggleChart') },
    { keys: [['['], [']']], label: tr('hkPaging') },
    { keys: [['↑'], ['↓']], label: tr('hkTableMove') },
    { keys: [['Enter']], label: tr('hkTableDrill') },
  ]

  return (
    <Modal opened={opened} onClose={onClose} title={t('hotkeysTitle')} centered size="lg">
      <Stack gap="md">
        <Section title={t('hkSectionNav')} rows={navRows} />
        <Divider />
        <Section title={t('hkSectionTree')} rows={treeRows} />
        <Divider />
        <Section title={t('hkSectionArchive')} rows={archiveRows} />
        <Text size="xs" c="dimmed">
          {t('hkFootnote')}
        </Text>
      </Stack>
    </Modal>
  )
}
