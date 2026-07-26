import { Box, Group, Stack, Text, Paper, Divider, Tooltip, ActionIcon } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconCopy, IconGauge } from '@tabler/icons-react'
import { useCopyToClipboard } from '@/lib/clipboard'
import { numericStyle } from '@/theme/theme'
import { useLanguage } from '@/locales/LanguageContext'
import { STD, KST_METHOD_NAMES } from '@/domain/flowRate/standards'
import type { DeviceType, FlowCalcResults } from '@/domain/flowRate/calculate'
import { RichLabel } from './RichLabel'

interface Props {
  results: FlowCalcResults | null
  device: DeviceType
}

function fmt(n: number | null | undefined, d = 4): string {
  if (n == null || isNaN(n) || !isFinite(n)) return '—'
  return n.toFixed(d)
}

/** One readout line: quantity, the standard it comes from, value and unit. */
function Row({
  label,
  value,
  unit,
  std,
}: {
  label: string
  value: string
  unit: string
  std?: string
}) {
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm" py={3}>
      <Box style={{ minWidth: 0 }}>
        <Text size="sm" lh={1.35}>
          <RichLabel text={label} />
        </Text>
        {std && (
          <Text size="10px" c="dimmed" lh={1.3}>
            {std}
          </Text>
        )}
      </Box>
      <Group gap={6} align="baseline" wrap="nowrap" style={{ flexShrink: 0 }}>
        <Text size="sm" fw={600} style={numericStyle}>
          {value}
        </Text>
        <Text size="10px" c="dimmed" w={62} ta="left">
          <RichLabel text={unit} />
        </Text>
      </Group>
    </Group>
  )
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text size="10px" fw={700} tt="uppercase" c="petrol" mt="sm" mb={2} style={{ letterSpacing: 0.6 }}>
      {children}
    </Text>
  )
}

/** Builds a plain-text copy of the readout, for pasting into a report. */
function asText(r: FlowCalcResults, device: DeviceType, t: (k: string) => string): string {
  const strip = (s: string) => s.replace(/<[^>]+>/g, '')
  const lines: string[] = [
    `${strip(t('fcTitle'))} — ${KST_METHOD_NAMES[r.kst] || ''}`,
    `γ = ${fmt(r.gamma)}`,
    `Z = ${fmt(r.Z, 5)}   Zc = ${fmt(r.Zc, 5)}   K = ${fmt(r.K, 5)}`,
    `ρр = ${fmt(r.rhoW)} кг/м³   μ = ${fmt(r.mu * 1e6, 3)} мкПа·с   κ = ${fmt(r.kappa)}`,
    `Tпк = ${fmt(r.Tpc, 2)} K   Pпк = ${fmt(r.Ppc)} МПа   Pпр = ${fmt(r.Pr)}   Tпр = ${fmt(r.Tr)}`,
  ]
  if (r.orifice) {
    const o = r.orifice
    lines.push(
      `DT = ${fmt(o.dtMm, 3)} мм   dT = ${fmt(o.dOrificeTMm, 3)} мм   β = ${fmt(o.beta)}`,
      `C = ${fmt(o.C, 5)}   Kш = ${fmt(o.Ksh, 5)}   Kп = ${fmt(o.Kbl, 5)}   ε = ${fmt(o.eps, 5)}   ReD = ${o.reD.toFixed(0)}`,
    )
  }
  lines.push(`Kp = ${fmt(r.Kp, 5)}`)
  if (r.qW > 0) lines.push(`${strip(t('fcQw'))} = ${fmt(r.qW)} ${t('fcUnitM3h')}`)
  if (r.qStd != null) {
    const label = strip(device === 'orifice' ? t('fcQstOrifice') : t('fcVstMeter'))
    const unit = device === 'orifice' ? t('fcUnitM3hStd') : t('fcUnitM3Std')
    lines.push(`${label} = ${fmt(r.qStd)} ${unit}`)
  }
  return lines.join('\n')
}

export function FlowCalcResultsPanel({ results, device }: Props) {
  const { t } = useLanguage()
  const clipboard = useCopyToClipboard({ timeout: 1500 })

  const handleCopy = async () => {
    if (!results) return
    const ok = await clipboard.copy(asText(results, device, t))
    // A copy that goes nowhere used to leave the icon unchanged and say nothing.
    if (!ok) notifications.show({ color: 'red', message: t('copyError') })
  }

  return (
    <Paper radius="md" withBorder style={{ overflow: 'hidden' }}>
      <Group
        justify="space-between"
        px="md"
        py={8}
        style={{ background: 'var(--hlv-surface-2)', borderBottom: '1px solid var(--hlv-border)' }}
      >
        <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: 0.6 }}>
          {t('fcResults')}
        </Text>
        {results && (
          <Tooltip label={clipboard.copied ? t('copied') : t('copy')} withArrow>
            <ActionIcon
              size="sm"
              variant="subtle"
              color={clipboard.copied ? 'teal' : 'gray'}
              aria-label={t('copy')}
              onClick={() => void handleCopy()}
            >
              {clipboard.copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
            </ActionIcon>
          </Tooltip>
        )}
      </Group>

      <Box px="md" pb="md">
        {!results ? (
          <Stack align="center" gap={6} py={48} c="dimmed">
            <IconGauge size={40} stroke={1.2} />
            <Text size="sm" ta="center">
              {t('fcEnterParamsPrompt')}
              <br />
              <Text span fw={700} c="petrol">
                {t('fcCalculate')}
              </Text>
            </Text>
          </Stack>
        ) : (
          <>
            {/* The number the whole screen exists to produce, given top billing. */}
            {results.qStd != null && (
              <Box
                mt="md"
                p="md"
                style={{
                  borderRadius: 10,
                  background:
                    'linear-gradient(135deg, color-mix(in srgb, var(--mantine-color-petrol-6) 14%, transparent), transparent 70%)',
                  border: '1px solid color-mix(in srgb, var(--mantine-color-petrol-6) 35%, transparent)',
                }}
              >
                <Text size="10px" fw={700} tt="uppercase" c="petrol" style={{ letterSpacing: 0.6 }}>
                  <RichLabel text={device === 'orifice' ? t('fcQstOrifice') : t('fcVstMeter')} />
                </Text>
                <Group align="baseline" gap={8} mt={4} wrap="nowrap">
                  <Text fz={34} fw={700} lh={1.05} style={numericStyle}>
                    {fmt(results.qStd)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {device === 'orifice' ? t('fcUnitM3hStd') : t('fcUnitM3Std')}
                  </Text>
                </Group>
                <Text size="10px" c="dimmed" mt={2}>
                  {device === 'orifice' ? STD.q : STD.rhoW}
                </Text>
              </Box>
            )}

            <GroupTitle>{t('fcGasParams')}</GroupTitle>
            <Row label={t('fcGamma')} value={fmt(results.gamma)} unit="—" />
            <Row
              label={t('fcZ')}
              value={fmt(results.Z, 5)}
              unit="—"
              std={results.kst === 1 ? STD.zGerg : STD.zNx}
            />
            <Row label={t('fcZc')} value={fmt(results.Zc, 5)} unit="—" std={STD.zc} />
            <Row label={t('fcKcompr')} value={fmt(results.K, 5)} unit="—" std={STD.k} />
            <Row label={t('fcRhoW')} value={fmt(results.rhoW)} unit="кг/м³" std={STD.rhoW} />
            <Row label={t('fcMu')} value={fmt(results.mu * 1e6, 3)} unit="мкПа·с" std={STD.mu} />

            <GroupTitle>{t('fcPseudocritical')}</GroupTitle>
            <Row label="T<sub>пк</sub>" value={fmt(results.Tpc, 2)} unit="K" std={STD.tpk} />
            <Row label="P<sub>пк</sub>" value={fmt(results.Ppc)} unit="МПа" std={STD.ppk} />
            <Row label="P<sub>пр</sub>" value={fmt(results.Pr)} unit="—" />
            <Row label="T<sub>пр</sub>" value={fmt(results.Tr)} unit="—" />

            {results.orifice && (
              <>
                <GroupTitle>{t('fcOrificeGroup')}</GroupTitle>
                <Row
                  label="D<sub>T</sub>"
                  value={fmt(results.orifice.dtMm, 3)}
                  unit="мм"
                  std={STD.DT}
                />
                <Row
                  label="d<sub>T</sub>"
                  value={fmt(results.orifice.dOrificeTMm, 3)}
                  unit="мм"
                  std={STD.dT}
                />
                <Row label="β = d/D" value={fmt(results.orifice.beta)} unit="—" std={STD.beta} />
                <Row label={t('fcC')} value={fmt(results.orifice.C, 5)} unit="—" std={STD.C} />
                <Row label={t('fcKsh')} value={fmt(results.orifice.Ksh, 5)} unit="—" std={STD.ksh} />
                <Row label={t('fcKbl')} value={fmt(results.orifice.Kbl, 5)} unit="—" std={STD.kbl} />
                <Row label={t('fcEps')} value={fmt(results.orifice.eps, 5)} unit="—" std={STD.eps} />
                <Row
                  label="Re<sub>D</sub>"
                  value={results.orifice.reD.toFixed(0)}
                  unit="—"
                  std={STD.re}
                />
              </>
            )}

            <GroupTitle>{t('fcVolumeReduction')}</GroupTitle>
            <Row label={t('fcKp')} value={fmt(results.Kp, 5)} unit="—" std={STD.rhoW} />
            {results.qW > 0 && (
              <Row
                label={t('fcQw')}
                value={fmt(results.qW)}
                unit={t('fcUnitM3h')}
                std={device === 'orifice' ? STD.q : undefined}
              />
            )}

            <Divider my="sm" />
            <Stack gap={2}>
              <Text size="11px" c="dimmed">
                <Text span fw={600}>
                  К<sub>ст</sub>:
                </Text>{' '}
                {KST_METHOD_NAMES[results.kst]} — ГОСТ 30319.2
              </Text>
              {results.orifice && (
                <>
                  <Text size="11px" c="dimmed">
                    <Text span fw={600}>
                      {t('fcStdOrifice')}:
                    </Text>{' '}
                    ДСТУ ГОСТ 8.586.1, 8.586.2, 8.586.5
                  </Text>
                  <Text size="11px" c="dimmed">
                    <Text span fw={600}>
                      κ:
                    </Text>{' '}
                    {fmt(results.kappa)} — ГОСТ 30319.1, ф. 28
                  </Text>
                </>
              )}
              <Text size="11px" c="dimmed">
                T₀ = 20 °C, P₀ = 101.325 кПа (ДСТУ 8585)
              </Text>
            </Stack>
          </>
        )}
      </Box>
    </Paper>
  )
}
