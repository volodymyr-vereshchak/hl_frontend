import { useEffect, useState } from 'react'
import {
  ActionIcon,
  Box,
  Button,
  Group,
  List,
  Modal,
  Text,
  Tooltip,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconChevronLeft, IconChevronRight, IconInfoCircle } from '@tabler/icons-react'
import { useLanguage } from '@/locales/LanguageContext'
import { CHANGELOG, CHANGELOG_KEY, CHANGELOG_SEEN_STORAGE } from '@/domain/changelog'

/** 'YYYY-MM-DD' → 'DD.MM.YYYY', without going through Date (no timezone shift). */
function formatDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : date
}

/**
 * "What's new" — the changelog, one entry per page, newest first. A dot marks
 * entries the user has not opened yet; opening the dialog clears it.
 */
export function WhatsNewButton() {
  const { t, currentLanguage } = useLanguage()
  const lang = currentLanguage === 'uk' ? 'uk' : 'ru'
  const [opened, { open, close }] = useDisclosure(false)
  const [page, setPage] = useState(0)
  const [unread, setUnread] = useState(false)

  useEffect(() => {
    try {
      setUnread(localStorage.getItem(CHANGELOG_SEEN_STORAGE) !== CHANGELOG_KEY)
    } catch {
      // Private mode or a blocked storage — the dot simply never shows.
    }
  }, [])

  const handleOpen = () => {
    setPage(0)
    open()
    setUnread(false)
    try {
      localStorage.setItem(CHANGELOG_SEEN_STORAGE, CHANGELOG_KEY)
    } catch {
      // Not being able to remember is not a reason to fail the click.
    }
  }

  const total = CHANGELOG.length
  const entry = CHANGELOG[page]

  return (
    <>
      <Tooltip label={t('whatsNewTitle')} withArrow>
        <Box style={{ position: 'relative' }}>
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={handleOpen}>
            <IconInfoCircle size={18} />
          </ActionIcon>
          {unread && (
            <Box
              aria-hidden
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--mantine-color-red-6)',
                border: '1.5px solid var(--hlv-page-bg)',
                pointerEvents: 'none',
              }}
            />
          )}
        </Box>
      </Tooltip>

      <Modal opened={opened} onClose={close} title={t('whatsNewTitle')} centered size="lg">
        {entry && (
          <>
            <Text size="xs" c="dimmed">
              {formatDate(entry.date)}
            </Text>
            <Text fw={600} mt={2} mb="sm">
              {entry.title[lang]}
            </Text>
            <List size="sm" spacing="xs">
              {entry.items[lang].map((item, i) => (
                <List.Item key={i}>{item}</List.Item>
              ))}
            </List>
          </>
        )}

        {total > 1 && (
          <Group justify="center" gap="sm" mt="lg">
            <Button
              size="compact-xs"
              variant="default"
              leftSection={<IconChevronLeft size={14} />}
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              {t('whatsNewNewer')}
            </Button>
            <Text size="xs" c="dimmed">
              {page + 1} / {total}
            </Text>
            <Button
              size="compact-xs"
              variant="default"
              rightSection={<IconChevronRight size={14} />}
              disabled={page >= total - 1}
              onClick={() => setPage((p) => Math.min(total - 1, p + 1))}
            >
              {t('whatsNewOlder')}
            </Button>
          </Group>
        )}
      </Modal>
    </>
  )
}
