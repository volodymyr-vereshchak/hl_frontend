import { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Grid,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconPlayerPlay,
  IconRotate,
} from '@tabler/icons-react'
import { branchApi, lumgApi, gasVolumeApi, lineApi } from '@/api/entities'
import { HourDateTimePicker } from '@/features/archive/HourDateTimePicker'
import { P_UNITS } from '@/domain/pressureUnits'
import { MATERIALS } from '@/domain/flowRate/materials'
import { KST_METHOD_NAMES } from '@/domain/flowRate/standards'
import {
  calculateFlowRate,
  INITIAL_INPUT,
  type DeviceType,
  type FlowCalcErrors,
  type FlowCalcInput,
  type FlowCalcResults,
  type KstMethod,
} from '@/domain/flowRate/calculate'
import { useLanguage } from '@/locales/LanguageContext'
import type { Line } from '@/types'
import { FlowCalcResultsPanel } from './FlowCalcResults'
import { OrificeDiagram } from './OrificeDiagram'
import { RichLabel } from './RichLabel'
import { formatPeriodShort, pullFromLine } from './lineAutofill'

const stripColon = (s: string) => s.replace(/\s*:\s*$/, '')

/** Current hour as the picker's string — where "at a moment" starts from. */
function defaultAsOf(): string {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:00:00`
}

/** Panel with a titled header strip — the screen's repeating container. */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper radius="md" withBorder style={{ overflow: 'hidden' }}>
      <Box
        px="md"
        py={8}
        style={{ background: 'var(--hlv-surface-2)', borderBottom: '1px solid var(--hlv-border)' }}
      >
        <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: 0.6 }}>
          {title}
        </Text>
      </Box>
      <Box p="md">{children}</Box>
    </Paper>
  )
}

interface NumFieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  unit: string
  step?: number
  placeholder?: string
  error?: string
}

/**
 * Numeric input with a fixed unit. The value stays a string all the way to the
 * domain layer so that "" and "0" keep meaning different things, the way the
 * original form treated an empty edge radius.
 */
function NumField({ label, value, onChange, unit, step, placeholder, error }: NumFieldProps) {
  return (
    <NumberInput
      size="sm"
      label={<RichLabel text={stripColon(label)} />}
      value={value}
      onChange={(v) => onChange(v === '' || v == null ? '' : String(v))}
      step={step}
      placeholder={placeholder}
      error={error}
      hideControls
      rightSection={
        <Text size="10px" c="dimmed" pr={10} style={{ whiteSpace: 'nowrap' }}>
          {unit}
        </Text>
      }
      rightSectionWidth={62}
      styles={{ input: { paddingRight: 62 } }}
    />
  )
}

/** Numeric input whose unit is selectable from the shared P_UNITS list. */
function NumUnitField({
  label,
  value,
  onChange,
  unitIdx,
  onUnit,
  step,
  error,
}: Omit<NumFieldProps, 'unit'> & { unitIdx: number; onUnit: (i: number) => void }) {
  return (
    <Group gap={6} align={error ? 'center' : 'flex-end'} wrap="nowrap">
      <NumberInput
        size="sm"
        style={{ flex: 1 }}
        label={<RichLabel text={stripColon(label)} />}
        value={value}
        onChange={(v) => onChange(v === '' || v == null ? '' : String(v))}
        step={step}
        error={error}
        hideControls
      />
      <Select
        size="sm"
        w={104}
        data={P_UNITS.map((u, i) => ({ value: String(i), label: u.label }))}
        value={String(unitIdx)}
        onChange={(v) => onUnit(Number(v))}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
        mb={error ? 0 : undefined}
      />
    </Group>
  )
}

type PullStatus = { type: 'ok' | 'warn'; text: string; warns: string[] } | null

export function FlowCalcPage() {
  const { t } = useLanguage()
  const [device, setDevice] = useState<DeviceType>('orifice')
  const [s, setS] = useState<FlowCalcInput>(INITIAL_INPUT)
  const [errors, setErrors] = useState<FlowCalcErrors>({})
  const [results, setResults] = useState<FlowCalcResults | null>(null)

  // ── Auto-fill-from-line cascade ──
  const [selBranch, setSelBranch] = useState<string | null>(null)
  const [selCalc, setSelCalc] = useState<string | null>(null)
  const [selLine, setSelLine] = useState<string | null>(null)
  // null = the latest values the line has; a 'YYYY-MM-DD HH:mm:ss' moment =
  // the configuration in force then, with that hour's working values.
  const [asOf, setAsOf] = useState<string | null>(null)
  const [pullStatus, setPullStatus] = useState<PullStatus>(null)
  const [pulling, setPulling] = useState(false)

  // Orifice → restrictor lines (meter=false); meter → counter lines (meter=true).
  const wantMeter = device === 'meter'

  const { data: topology } = useQuery({
    queryKey: ['flow-calc-topology'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [branches, lumgs, calcs, lines] = await Promise.all([
        branchApi.getAll(),
        lumgApi.getAll(),
        gasVolumeApi.getAll(),
        lineApi.getAll(),
      ])
      return { branches, lumgs, calcs, lines }
    },
  })
  const branches = topology?.branches ?? []
  const lumgs = topology?.lumgs ?? []
  const calcs = topology?.calcs ?? []
  const lines: Line[] = useMemo(() => topology?.lines ?? [], [topology])

  const filteredCalcs = useMemo(() => {
    // Only calcs that have at least one line of the selected device type.
    const withDevice = new Set(
      lines.filter((l) => !!l.meter === wantMeter).map((l) => l.gas_volume_calc_id),
    )
    let cs = calcs.filter((c) => withDevice.has(c.id))
    if (selBranch) {
      const ids = lumgs.filter((l) => String(l.branch_id) === selBranch).map((l) => l.id)
      cs = cs.filter((c) => c.lumg_id != null && ids.includes(c.lumg_id))
    }
    return cs
  }, [selBranch, calcs, lumgs, lines, wantMeter])

  const filteredLines = useMemo(() => {
    const byDevice = lines.filter((l) => !!l.meter === wantMeter)
    if (selCalc) return byDevice.filter((l) => String(l.gas_volume_calc_id) === selCalc)
    if (selBranch) {
      const lumgIds = lumgs.filter((l) => String(l.branch_id) === selBranch).map((l) => l.id)
      const calcIds = calcs
        .filter((c) => c.lumg_id != null && lumgIds.includes(c.lumg_id))
        .map((c) => c.id)
      return byDevice.filter(
        (l) => l.gas_volume_calc_id != null && calcIds.includes(l.gas_volume_calc_id),
      )
    }
    return byDevice
  }, [lines, wantMeter, selCalc, selBranch, lumgs, calcs])

  // Line names repeat across stations ("Н1" everywhere), so group them by their
  // calc — otherwise the list is a wall of identical entries.
  const lineOptions = useMemo(() => {
    const calcName = new Map(calcs.map((c) => [c.id, c.name || `#${c.id}`]))
    const groups = new Map<string, { value: string; label: string }[]>()
    for (const l of filteredLines) {
      const key = l.gas_volume_calc_id != null ? (calcName.get(l.gas_volume_calc_id) ?? '—') : '—'
      const items = groups.get(key) ?? []
      items.push({ value: String(l.id), label: l.name || `#${l.id}` })
      groups.set(key, items)
    }
    return [...groups].map(([group, items]) => ({ group, items }))
  }, [filteredLines, calcs])

  const KST_METHODS = useMemo(
    () => [t('fcKstPlaceholder'), KST_METHOD_NAMES[1], KST_METHOD_NAMES[2]],
    [t],
  )
  const P_TYPES = useMemo(() => [t('fcPAbs'), t('fcPGauge')], [t])
  const OTBOR = useMemo(
    () => [t('fcOtborCorner'), t('fcOtborRad'), t('fcOtborFlange')],
    [t],
  )
  const TIME_TYPES = useMemo(() => [t('fcTimeOp'), t('fcTimeInterctrl')], [t])

  /** Editing any field clears its error and invalidates the previous result. */
  const set = useCallback(<K extends keyof FlowCalcInput>(f: K, v: FlowCalcInput[K]) => {
    setS((prev) => ({ ...prev, [f]: v }))
    setErrors((prev) => {
      const e = { ...prev }
      delete e[f as string]
      return e
    })
    setResults(null)
  }, [])

  const handleDevice = useCallback((next: string) => {
    setDevice(next as DeviceType)
    setResults(null)
    setSelCalc(null)
    setSelLine(null)
    setPullStatus(null)
  }, [])

  const pull = useCallback(
    async (v: string | null, asOf: string | null) => {
      if (!v) {
        setPullStatus(null)
        return
      }
      const line = lines.find((l) => l.id === Number(v))
      if (!line) return
      setPulling(true)
      setPullStatus(null)
      try {
        const res = await pullFromLine(line, s, wantMeter, asOf)
        setS((prev) => ({ ...prev, ...res.patch }))
        setErrors({})
        setResults(null)

        const warns: string[] = []
        if (!res.hadParams) warns.push(t('fcLineFillNoParams'))
        if (!res.hadHourly) {
          // At a chosen moment the miss is about THAT hour — saying "the line
          // has no hourly data" would be untrue and unhelpful.
          warns.push(
            asOf ? `${t('fcAsOfNoRecord')} ${formatPeriodShort(asOf)}` : t('fcLineFillNoHourly'),
          )
        }
        if (!res.hadParams && !res.hadHourly) {
          setPullStatus({ type: 'warn', text: warns.join('. '), warns: [] })
        } else {
          const when = res.period ? ` ${t('fcLineFillAt')} ${res.period}` : ''
          setPullStatus({
            type: warns.length ? 'warn' : 'ok',
            text: `${t('fcLineFillPulledFrom')} «${line.name || line.id}»${when}`,
            warns,
          })
        }
      } catch {
        setPullStatus({ type: 'warn', text: t('fcLineFillNoHourly'), warns: [] })
      } finally {
        setPulling(false)
      }
    },
    [lines, s, wantMeter, t],
  )

  const handleSelLine = useCallback(
    (v: string | null) => {
      setSelLine(v)
      void pull(v, asOf)
    },
    [pull, asOf],
  )

  /** Switching to a moment (or moving it) re-reads the same line for that time. */
  const handleAsOf = useCallback(
    (v: string | null) => {
      setAsOf(v)
      void pull(selLine, v)
    },
    [pull, selLine],
  )

  const handleCalc = useCallback(() => {
    const out = calculateFlowRate({ ...s, device }, t)
    if (out.ok) {
      setResults(out.results)
      setErrors({})
    } else {
      setResults(null)
      setErrors(out.errors)
    }
  }, [s, device, t])

  const handleReset = useCallback(() => {
    setS(INITIAL_INPUT)
    setErrors({})
    setResults(null)
    setSelLine(null)
    setPullStatus(null)
  }, [])

  const showAtm = s.pType === 1
  const hasErrors = Object.keys(errors).length > 0

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={3}>{t('fcTitle')}</Title>
          <Text size="xs" c="dimmed">
            ДСТУ ГОСТ 8.586.1/.2/.5 · ГОСТ 30319.1/.2
          </Text>
        </div>
        <Group gap={8} align="center">
          <Text size="xs" c="dimmed">
            {stripColon(t('fcSelectConverter'))}
          </Text>
          <SegmentedControl
            size="xs"
            value={device}
            onChange={handleDevice}
            data={[
              { value: 'orifice', label: t('fcOrificeDevice') },
              { value: 'meter', label: t('fcMeter') },
            ]}
          />
        </Group>
      </Group>

      <Grid gap="md" align="flex-start">
        {/* ── Inputs ── */}
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Stack gap="md">
            <Panel title={t('fcLineFillTitle')}>
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                <Select
                  size="sm"
                  label={t('fcLineFillBranch')}
                  placeholder={t('fcLineFillAllBranches')}
                  data={branches.map((b) => ({ value: String(b.id), label: b.name }))}
                  value={selBranch}
                  onChange={(v) => {
                    setSelBranch(v)
                    setSelCalc(null)
                    setSelLine(null)
                    setPullStatus(null)
                  }}
                  clearable
                  searchable
                />
                <Select
                  size="sm"
                  label={t('fcLineFillCalc')}
                  placeholder={t('fcLineFillAllCalcs')}
                  data={filteredCalcs.map((c) => ({
                    value: String(c.id),
                    label: c.name || `#${c.id}`,
                  }))}
                  value={selCalc}
                  onChange={(v) => {
                    setSelCalc(v)
                    setSelLine(null)
                    setPullStatus(null)
                  }}
                  clearable
                  searchable
                />
                <Select
                  size="sm"
                  label={t('fcLineFillLine')}
                  placeholder={t('fcLineFillSelectLine')}
                  data={lineOptions}
                  value={selLine}
                  onChange={handleSelLine}
                  clearable
                  searchable
                  disabled={pulling}
                />
              </SimpleGrid>

              {/* Which moment to read the line at. Parameters change rarely but
                  they do change, so recalculating a past measurement needs the
                  configuration that was in force then, not today's. */}
              <Group gap="sm" mt="sm" align="center" wrap="wrap">
                <SegmentedControl
                  size="xs"
                  value={asOf ? 'moment' : 'latest'}
                  onChange={(v) => handleAsOf(v === 'latest' ? null : asOf || defaultAsOf())}
                  disabled={pulling}
                  data={[
                    { value: 'latest', label: t('fcAsOfLatest') },
                    { value: 'moment', label: t('fcAsOfMoment') },
                  ]}
                />
                {asOf && (
                  <HourDateTimePicker
                    value={asOf}
                    onChange={handleAsOf}
                    todayValue={defaultAsOf()}
                    ariaLabel={t('fcAsOfMoment')}
                    disabled={pulling}
                  />
                )}
                <Text size="xs" c="dimmed">
                  {asOf ? t('fcAsOfMomentHint') : t('fcAsOfLatestHint')}
                </Text>
              </Group>

              {pulling && (
                <Text size="xs" c="dimmed" mt="xs">
                  {t('fcLineFillLoading')}
                </Text>
              )}
              {!pulling && pullStatus && (
                <Alert
                  mt="sm"
                  py={8}
                  variant="light"
                  color={pullStatus.type === 'ok' ? 'teal' : 'amber'}
                  icon={
                    pullStatus.type === 'ok' ? (
                      <IconCircleCheck size={16} />
                    ) : (
                      <IconAlertTriangle size={16} />
                    )
                  }
                >
                  <Text size="xs">{pullStatus.text}</Text>
                  {pullStatus.warns.length > 0 && (
                    <Text size="xs" c="amber.6">
                      {pullStatus.warns.join('; ')}
                    </Text>
                  )}
                  {pullStatus.type === 'ok' && (
                    <Text size="xs" c="dimmed">
                      {t('fcLineFillHint')}
                    </Text>
                  )}
                </Alert>
              )}
            </Panel>

            <Panel title={t('fcGeneralParams')}>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <Stack gap="sm">
                  <Select
                    size="sm"
                    label={<RichLabel text="К<sub>ст</sub>" />}
                    data={KST_METHODS.map((label, i) => ({ value: String(i), label })).slice(1)}
                    placeholder={KST_METHODS[0]}
                    value={s.kst ? String(s.kst) : null}
                    onChange={(v) => set('kst', (v ? Number(v) : 0) as KstMethod)}
                    error={errors.kst}
                    allowDeselect={false}
                  />
                  <NumField
                    label={t('fcDensityLabel')}
                    value={s.rho}
                    onChange={(v) => set('rho', v)}
                    unit="кг/м³"
                    step={0.0001}
                    placeholder="0.67–1.0"
                    error={errors.rho}
                  />
                  <NumField
                    label={t('fcCo2Label')}
                    value={s.co2}
                    onChange={(v) => set('co2', v)}
                    unit="мол.%"
                    step={0.01}
                    placeholder="0"
                    error={errors.co2}
                  />
                  <NumField
                    label={t('fcN2Label')}
                    value={s.n2}
                    onChange={(v) => set('n2', v)}
                    unit="мол.%"
                    step={0.01}
                    placeholder="0"
                    error={errors.n2}
                  />
                </Stack>
                <Stack gap="sm">
                  <Select
                    size="sm"
                    label={stripColon(t('fcPressureTypeLabel'))}
                    data={P_TYPES.map((label, i) => ({ value: String(i), label }))}
                    value={String(s.pType)}
                    onChange={(v) => set('pType', Number(v))}
                    allowDeselect={false}
                  />
                  {showAtm ? (
                    <NumUnitField
                      label={t('fcAtmPressureLabel')}
                      value={s.patm}
                      onChange={(v) => set('patm', v)}
                      unitIdx={s.patmU}
                      onUnit={(i) => set('patmU', i)}
                      step={0.001}
                      error={errors.patm}
                    />
                  ) : (
                    <Box>
                      <Text size="sm" fw={500} mb={4}>
                        {stripColon(t('fcAtmPressureLabel'))}
                      </Text>
                      {/* Absolute pressure needs no atmospheric term; the row is
                          kept so the two columns stay on the same baseline. */}
                      <Text size="sm" c="dimmed" py={7} h={34}>
                        —
                      </Text>
                    </Box>
                  )}
                  <NumUnitField
                    label={t('fcPressureLabel')}
                    value={s.p}
                    onChange={(v) => set('p', v)}
                    unitIdx={s.pU}
                    onUnit={(i) => set('pU', i)}
                    step={0.001}
                    error={errors.p}
                  />
                  <NumField
                    label={t('fcTemperatureLabel')}
                    value={s.t}
                    onChange={(v) => set('t', v)}
                    unit="°C"
                    step={0.1}
                    placeholder="-23.15–70"
                    error={errors.t}
                  />
                </Stack>
              </SimpleGrid>
            </Panel>

            {device === 'orifice' && (
              <Panel title={t('fcOrificeParams')}>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  <Stack gap="sm">
                    <Select
                      size="sm"
                      label={stripColon(t('fcOtborLabel'))}
                      data={OTBOR.map((label, i) => ({ value: String(i), label }))}
                      value={String(s.otbor)}
                      onChange={(v) => set('otbor', Number(v))}
                      allowDeselect={false}
                    />
                    <NumUnitField
                      label={t('fcDpLabel')}
                      value={s.dp}
                      onChange={(v) => set('dp', v)}
                      unitIdx={s.dpU}
                      onUnit={(i) => set('dpU', i)}
                      step={0.1}
                      error={errors.dp}
                    />
                    <NumField
                      label="D₂₀"
                      value={s.D20}
                      onChange={(v) => set('D20', v)}
                      unit="мм"
                      step={0.01}
                      placeholder="50–1200"
                      error={errors.D20}
                    />
                    <Select
                      size="sm"
                      label={stripColon(t('fcMatPipeLabel'))}
                      data={MATERIALS.map((m, i) => ({ value: String(i), label: m.label }))}
                      value={String(s.matPipe)}
                      onChange={(v) => set('matPipe', Number(v))}
                      searchable
                      allowDeselect={false}
                    />
                    <NumField
                      label={t('fcRoughnessLabel')}
                      value={s.rsh}
                      onChange={(v) => set('rsh', v)}
                      unit="мм"
                      step={0.001}
                      placeholder="0.001–2.5"
                      error={errors.rsh}
                    />
                  </Stack>
                  <Stack gap="sm">
                    <NumField
                      label="d₂₀"
                      value={s.d20}
                      onChange={(v) => set('d20', v)}
                      unit="мм"
                      step={0.01}
                      placeholder="12.5–960"
                      error={errors.d20}
                    />
                    <Select
                      size="sm"
                      label={stripColon(t('fcMatOrificeLabel'))}
                      data={MATERIALS.map((m, i) => ({ value: String(i), label: m.label }))}
                      value={String(s.matOrifice)}
                      onChange={(v) => set('matOrifice', Number(v))}
                      searchable
                      allowDeselect={false}
                    />
                    <NumField
                      label={t('fcEdgeRadiusLabel')}
                      value={s.rEdge}
                      onChange={(v) => set('rEdge', v)}
                      unit="мм"
                      step={0.01}
                      placeholder="0"
                      error={errors.rEdge}
                    />
                    <Select
                      size="sm"
                      label={stripColon(t('fcTimeTypeLabel'))}
                      data={TIME_TYPES.map((label, i) => ({ value: String(i), label }))}
                      value={String(s.timeType)}
                      onChange={(v) => set('timeType', Number(v))}
                      allowDeselect={false}
                    />
                    <NumField
                      label={t('fcTimeOrificeLabel')}
                      value={s.timeOrifice}
                      onChange={(v) => set('timeOrifice', v)}
                      unit={t('fcUnitYear')}
                      step={0.1}
                      placeholder="0"
                      error={errors.timeOrifice}
                    />
                  </Stack>
                </SimpleGrid>

                <Box mt="md" pt="md" style={{ borderTop: '1px solid var(--hlv-border)' }}>
                  <OrificeDiagram
                    D20={s.D20}
                    d20={s.d20}
                    otbor={s.otbor}
                    otborLabel={OTBOR[s.otbor] ?? ''}
                  />
                </Box>
              </Panel>
            )}

            {device === 'meter' && (
              <Panel title={t('fcMeterParams')}>
                <Box maw={340}>
                  <NumField
                    label={t('fcWorkVolumeLabel')}
                    value={s.qw}
                    onChange={(v) => set('qw', v)}
                    unit={t('fcUnitM3h')}
                    step={0.001}
                    error={errors.qw}
                  />
                </Box>
              </Panel>
            )}

            <Group gap="sm">
              <Button leftSection={<IconPlayerPlay size={16} />} onClick={handleCalc}>
                {t('fcCalculate')}
              </Button>
              <Button
                variant="subtle"
                color="gray"
                leftSection={<IconRotate size={16} />}
                onClick={handleReset}
              >
                {t('fcReset')}
              </Button>
              {hasErrors && (
                <Text size="xs" c="red">
                  {errors.kst || t('fcFixErrors')}
                </Text>
              )}
            </Group>
          </Stack>
        </Grid.Col>

        {/* ── Results ── */}
        <Grid.Col span={{ base: 12, lg: 5 }}>
          {/* One sheet, at whatever height the readout needs. It used to be a
              sticky pane with its own scrollbar, which meant the answer to a
              calculation arrived in a box you then had to scroll — with the
              page scrollbar right next to it. The page scrolls; this doesn't. */}
          <FlowCalcResultsPanel results={results} device={device} />
        </Grid.Col>
      </Grid>
    </Stack>
  )
}
