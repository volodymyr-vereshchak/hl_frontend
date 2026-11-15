import { useEffect, useMemo, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { weatherApi, type WeatherPoint } from '@/api/weather'
import { LoadingState } from '@/components/LoadingState'
import { useLanguage } from '@/locales/LanguageContext'
import { WeatherIcon } from './WeatherIcon'
import { KIND_LABEL, weatherKind } from './weatherKind'

const MONO = "'JetBrains Mono Variable', monospace"
/** Days shown: yesterday, today and the forecast ahead. */
const BACK = 1
const AHEAD = 15
/** Hours from which an hour is drawn with the moon. */
const DAY_FROM = 7
const DAY_TO = 19

const pad = (n: number) => String(n).padStart(2, '0')
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return isoDay(d)
}
const fmt = (v: number | null | undefined, digits = 0) =>
  v == null
    ? '—'
    : (Math.round(v * 10 ** digits) / 10 ** digits).toLocaleString('uk-UA', {
        minimumFractionDigits: digits,
      })

/**
 * The forecast as pictures: a row of days, and the hours of the day picked —
 * sun, cloud, drizzle, shower, snow, thunder. Drawn from the WMO weather code
 * Open-Meteo gives; days stored before it was kept are guessed from rain,
 * temperature and cloud.
 */
export function WeatherForecast({ point }: { point: WeatherPoint }) {
  const { t, getLocale } = useLanguage()
  const locale = getLocale()
  const today = isoDay(new Date())
  const first = shift(today, -BACK)
  const last = shift(today, AHEAD)
  const [day, setDay] = useState(today)

  const daily = useQuery({
    queryKey: ['weather-forecast', 'daily', point.id, first, last],
    queryFn: () => weatherApi.daily([point.id], first, last),
    staleTime: 5 * 60_000,
  })
  const days = useMemo(
    () =>
      [...(daily.data ?? [])]
        .filter((r) => r.t_mean != null || r.t_max != null)
        .sort((a, b) => a.day.localeCompare(b.day)),
    [daily.data],
  )
  // Keep the picked day among the days there are.
  useEffect(() => {
    if (days.length && !days.some((d) => d.day === day))
      setDay(days.find((d) => d.day >= today)?.day ?? days[0].day)
  }, [days, day, today])

  const hourly = useQuery({
    queryKey: ['weather-forecast', 'hourly', point.id, day],
    queryFn: () => weatherApi.hourly([point.id], day, day),
    staleTime: 5 * 60_000,
    enabled: days.length > 0,
  })
  const hours = useMemo(
    () =>
      [...(hourly.data ?? [])]
        .filter((h) => h.stamp.slice(0, 10) === day)
        .sort((a, b) => a.stamp.localeCompare(b.stamp)),
    [hourly.data, day],
  )

  const index = days.findIndex((d) => d.day === day)
  const current = index >= 0 ? days[index] : null
  const move = (step: number) => {
    const next = days[index + step]
    if (next) setDay(next.day)
  }
  // Arrow keys move between days while the panel has focus.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') move(-1)
    if (e.key === 'ArrowRight') move(1)
  }

  if (daily.isLoading) return <LoadingState py={40} label={t('appLoading')} />
  if (!days.length) {
    return (
      <Paper withBorder radius="md" p="md">
        <Text fw={600}>{t('wxForecastTitle')}</Text>
        <Text size="sm" c="dimmed">
          {t('wxNoForecast')}
        </Text>
      </Paper>
    )
  }

  const kindOfDay = (r: (typeof days)[number]) =>
    weatherKind({ code: r.weather_code, precipitation: r.precipitation, temperature: r.t_mean })
  const weekday = (iso: string) =>
    iso === today
      ? t('wxToday')
      : new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { weekday: 'short' })
  const date = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })

  return (
    <Paper withBorder radius="md" p="md" tabIndex={0} onKeyDown={onKey} style={{ outline: 'none' }}>
      <Group justify="space-between" mb="sm">
        <Text fw={600}>
          {t('wxForecastTitle')} — {point.name}
        </Text>
        <Text size="xs" c="dimmed">
          {t('wxKeysHint')}
        </Text>
      </Group>

      <ScrollArea type="auto" offsetScrollbars>
        <Group gap={6} wrap="nowrap" pb={4}>
          {days.map((r) => {
            const kind = kindOfDay(r)
            const picked = r.day === day
            return (
              <UnstyledButton
                key={r.day}
                onClick={() => setDay(r.day)}
                aria-pressed={picked}
                title={t(KIND_LABEL[kind])}
                style={{
                  minWidth: 78,
                  padding: '6px 4px',
                  borderRadius: 8,
                  border: `1px solid ${picked ? 'var(--mantine-color-petrol-5)' : 'var(--hlv-border)'}`,
                  background: picked ? 'var(--hlv-surface-2)' : 'transparent',
                  opacity: r.day < today ? 0.6 : 1,
                }}
              >
                <Stack gap={0} align="center">
                  <Text size="xs" fw={600} tt="capitalize">
                    {weekday(r.day)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {date(r.day)}
                  </Text>
                  <WeatherIcon kind={kind} size={40} still={!picked} title={t(KIND_LABEL[kind])} />
                  <Text size="xs" ff={MONO}>
                    <b>{fmt(r.t_max)}°</b> <span style={{ opacity: 0.6 }}>{fmt(r.t_min)}°</span>
                  </Text>
                  <Text
                    size="xs"
                    c="blue"
                    ff={MONO}
                    style={{ visibility: r.precipitation ? 'visible' : 'hidden' }}
                  >
                    {fmt(r.precipitation, 1)} мм
                  </Text>
                </Stack>
              </UnstyledButton>
            )
          })}
        </Group>
      </ScrollArea>

      {current && (
        <Box mt="md">
          <Group gap="md" align="center" wrap="nowrap">
            <ActionIcon
              variant="subtle"
              onClick={() => move(-1)}
              disabled={index <= 0}
              aria-label={t('wxPrevDay')}
            >
              <IconChevronLeft size={20} />
            </ActionIcon>
            <WeatherIcon
              kind={kindOfDay(current)}
              size={96}
              title={t(KIND_LABEL[kindOfDay(current)])}
            />
            <Stack gap={2} style={{ flex: 1 }}>
              <Group gap="xs">
                <Text fw={700} size="lg" tt="capitalize">
                  {new Date(`${current.day}T00:00:00`).toLocaleDateString(locale, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </Text>
                <Badge variant="light" color={current.source === 'forecast' ? 'grape' : 'gray'}>
                  {t(
                    current.source === 'forecast'
                      ? 'weatherSourceForecast'
                      : 'weatherSourceArchive',
                  )}
                </Badge>
              </Group>
              <Text size="sm">{t(KIND_LABEL[kindOfDay(current)])}</Text>
              <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="xs" mt={4}>
                <Fact label={t('weatherTMean')} value={`${fmt(current.t_mean, 1)} °C`} />
                <Fact
                  label={`${t('weatherTMin')} / ${t('weatherTMax')}`}
                  value={`${fmt(current.t_min)}° / ${fmt(current.t_max)}°`}
                />
                <Fact
                  label={t('weatherPrecipitation')}
                  value={`${fmt(current.precipitation, 1)} мм`}
                />
                <Fact
                  label={t('weatherHumidity')}
                  value={current.humidity != null ? `${fmt(current.humidity)} %` : '—'}
                />
                <Fact label={t('weatherWind')} value={`${fmt(current.wind_max, 1)} м/с`} />
              </SimpleGrid>
            </Stack>
            <ActionIcon
              variant="subtle"
              onClick={() => move(1)}
              disabled={index >= days.length - 1}
              aria-label={t('wxNextDay')}
            >
              <IconChevronRight size={20} />
            </ActionIcon>
          </Group>

          {hours.length > 0 && (
            <ScrollArea type="auto" offsetScrollbars mt="sm">
              <Group gap={4} wrap="nowrap" pb={4}>
                {hours.map((h) => {
                  const hour = Number(h.stamp.slice(11, 13))
                  const kind = weatherKind({
                    code: h.weather_code,
                    precipitation: h.precipitation,
                    temperature: h.temperature,
                    cloud: h.cloud_cover,
                    hourly: true,
                  })
                  return (
                    <Stack
                      key={h.stamp}
                      gap={0}
                      align="center"
                      miw={50}
                      title={t(KIND_LABEL[kind])}
                    >
                      <Text size="xs" c="dimmed" ff={MONO}>
                        {pad(hour)}:00
                      </Text>
                      <WeatherIcon
                        kind={kind}
                        size={34}
                        night={hour < DAY_FROM || hour >= DAY_TO}
                        still
                      />
                      <Text size="xs" ff={MONO} fw={600}>
                        {fmt(h.temperature)}°
                      </Text>
                      <Text size="xs" c="dimmed" ff={MONO}>
                        {h.humidity != null ? `${fmt(h.humidity)}%` : ''}
                      </Text>
                      <Text
                        size="xs"
                        c="blue"
                        ff={MONO}
                        style={{ visibility: h.precipitation ? 'visible' : 'hidden' }}
                      >
                        {fmt(h.precipitation, 1)}
                      </Text>
                    </Stack>
                  )
                })}
              </Group>
            </ScrollArea>
          )}
        </Box>
      )}
    </Paper>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={600} ff={MONO}>
        {value}
      </Text>
    </div>
  )
}
