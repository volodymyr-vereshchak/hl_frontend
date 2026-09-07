import { useEffect, useState } from 'react'
import { Text, Tooltip } from '@mantine/core'
import { isReportStale } from '@/store/enterpriseReportsStore'
import { useLanguage } from '@/locales/LanguageContext'

/**
 * When this report was actually polled.
 *
 * It earns its place only because the reports now outlive the screen: they
 * survive navigation and F5 for as long as the tab is open, so an operator can
 * step away and come back to numbers that look current and are not. The line
 * turns amber once the report is an hour old — at that point how old it is
 * matters more than what it says.
 */
export function PolledAt({ at }: { at: number | null }) {
  const { t, getLocale } = useLanguage()
  // Re-renders every minute so a report cannot sit on screen looking fresh
  // while it ages past the threshold.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  if (at == null) return null
  const when = new Date(at)
  const locale = getLocale()
  const time = when.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  // A tab left open overnight: the hour alone would read as "this morning".
  const sameDay = new Date(now).toDateString() === when.toDateString()
  const label = sameDay
    ? time
    : `${when.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })} ${time}`
  const stale = isReportStale(at, now)

  return (
    <Tooltip label={stale ? t('reportStale') : when.toLocaleString(locale)} withArrow>
      <Text size="xs" c={stale ? 'amber.5' : 'dimmed'} style={{ whiteSpace: 'nowrap' }}>
        {t('polledAt')}: {label}
      </Text>
    </Tooltip>
  )
}
