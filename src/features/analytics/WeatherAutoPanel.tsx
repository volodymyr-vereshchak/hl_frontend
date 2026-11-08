import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Badge, Button, Group, Paper, Stack, Switch, Text } from '@mantine/core'
import { TimeInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconPlayerPlay } from '@tabler/icons-react'
import { weatherAutoApi, type WeatherAuto } from '@/api/weather'
import { useLanguage } from '@/locales/LanguageContext'

const KEY = ['weather-auto'] as const

const fmt = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '—'

/**
 * The server downloads the missing weather by itself once a day. Needs the
 * SERVER to reach the internet — the manual download below stays for one that
 * cannot.
 */
export function WeatherAutoPanel() {
  const { t, getLocale } = useLanguage()
  const qc = useQueryClient()
  const status = useQuery({
    queryKey: KEY,
    queryFn: weatherAutoApi.get,
    // Follow a run while it lasts; otherwise a minute is plenty.
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 3000 : 60_000),
  })
  const [time, setTime] = useState('12:00')
  useEffect(() => {
    if (status.data) setTime(status.data.refresh_time)
  }, [status.data?.refresh_time]) // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (data: WeatherAuto) => {
    qc.setQueryData(KEY, data)
    if (data.status !== 'running') {
      void qc.invalidateQueries({ queryKey: ['weather-points'] })
      void qc.invalidateQueries({ queryKey: ['weather-plan'] })
    }
  }
  const save = useMutation({
    mutationFn: weatherAutoApi.save,
    onSuccess: apply,
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red' }),
  })
  const run = useMutation({
    mutationFn: weatherAutoApi.runNow,
    onSuccess: apply,
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red' }),
  })

  // A run that just finished refreshes the coverage shown on this page.
  const st = status.data
  const [wasRunning, setWasRunning] = useState(false)
  useEffect(() => {
    if (st?.status === 'running') setWasRunning(true)
    else if (wasRunning && st) {
      setWasRunning(false)
      void qc.invalidateQueries({ queryKey: ['weather-points'] })
      void qc.invalidateQueries({ queryKey: ['weather-plan'] })
    }
  }, [st, wasRunning, qc])

  const badge =
    st?.status === 'running' ? (
      <Badge color="blue" variant="light">
        {t('weatherAutoRunning')}
      </Badge>
    ) : st?.status === 'done' ? (
      <Badge color="teal" variant="light">
        {t('weatherAutoDone')}
      </Badge>
    ) : st?.status === 'error' ? (
      <Badge color="red" variant="light">
        {t('weatherAutoFailed')}
      </Badge>
    ) : (
      <Badge color="gray" variant="light">
        {t('weatherAutoNever')}
      </Badge>
    )

  const timeValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(time)

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Text fw={600}>{t('weatherAutoTitle')}</Text>
          {badge}
        </Group>
        <Text size="xs" c="dimmed">
          {t('weatherAutoHint')}
        </Text>

        <Group gap="md" wrap="wrap" align="flex-end">
          <Switch
            checked={!!st?.auto_enabled}
            onChange={(e) => save.mutate({ auto_enabled: e.currentTarget.checked })}
            disabled={!st || save.isPending}
            label={t('weatherAutoEnable')}
          />
          <TimeInput
            size="xs"
            w={110}
            value={time}
            onChange={(e) => setTime(e.currentTarget.value)}
            onBlur={() => {
              if (timeValid && time !== st?.refresh_time) save.mutate({ refresh_time: time })
            }}
            error={!timeValid}
            disabled={!st}
            aria-label={t('weatherAutoTime')}
          />
          <Button
            size="xs"
            variant="light"
            leftSection={<IconPlayerPlay size={14} />}
            onClick={() => run.mutate()}
            loading={run.isPending || st?.status === 'running'}
            disabled={!st}
          >
            {t('weatherAutoRunNow')}
          </Button>
        </Group>

        {st && st.started_at && (
          <Text size="xs" c="dimmed">
            {t('weatherAutoLast')}: {fmt(st.started_at, getLocale())}
            {st.finished_at && ` → ${fmt(st.finished_at, getLocale())}`}
            {st.result && ` · ${t('weatherImported')}: ${st.result}`}
          </Text>
        )}
        {st?.status === 'error' && st.error && (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
            <Text size="xs" style={{ wordBreak: 'break-word' }}>
              {st.error}
            </Text>
          </Alert>
        )}
      </Stack>
    </Paper>
  )
}
