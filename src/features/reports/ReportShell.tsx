import { type ReactNode } from 'react'
import { Stack, Group, Title, Select, Button, Text, Alert } from '@mantine/core'
import { IconAlertTriangle, IconFileSpreadsheet, IconPlayerPlay } from '@tabler/icons-react'
import { useLanguage } from '@/locales/LanguageContext'
import { useSelectionStore } from '@/store/selectionStore'
import { useBranches } from './useBranchLines'
import { LoadingState } from '@/components/LoadingState'

interface Props {
  title: string
  description?: string
  /** Period + mode controls specific to the report. */
  controls?: ReactNode
  onRun: () => void
  running?: boolean
  onExport?: () => void
  canExport?: boolean
  error?: string | null
  /** What the run is doing right now, shown under the single spinner. */
  progress?: string | null
  /** Reports with their own cascading branch selector opt out of the header one. */
  withBranchPicker?: boolean
  children: ReactNode
}

/** Shared report layout: title, branch picker, report controls, run/export. */
export function ReportShell({
  title,
  description,
  controls,
  onRun,
  running,
  onExport,
  canExport,
  error,
  progress,
  withBranchPicker = true,
  children,
}: Props) {
  const { t } = useLanguage()
  const { branchId, setBranchId } = useSelectionStore()
  const { data: branches } = useBranches()

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={3}>{title}</Title>
          {description && (
            <Text size="xs" c="dimmed">
              {description}
            </Text>
          )}
        </div>
        {withBranchPicker && (
          <Select
            placeholder={t('branch')}
            data={(branches ?? []).map((b) => ({ value: String(b.id), label: b.name }))}
            value={branchId != null ? String(branchId) : null}
            onChange={(v) => setBranchId(v ? Number(v) : null)}
            searchable
            size="xs"
            w={260}
          />
        )}
      </Group>

      <Group gap="sm" align="flex-end" wrap="wrap">
        {controls}
        {/* Deliberately NOT `loading`: the one spinner lives in the middle of
            the screen, and three of them at once looked like three things were
            happening. */}
        <Button
          size="xs"
          leftSection={<IconPlayerPlay size={15} />}
          onClick={onRun}
          disabled={running || (withBranchPicker && branchId == null)}
        >
          {t('loadAccidentsData')}
        </Button>
        {onExport && (
          <Button
            size="xs"
            variant="light"
            color="teal"
            leftSection={<IconFileSpreadsheet size={15} />}
            onClick={onExport}
            disabled={!canExport}
            ml="auto"
          >
            {t('excel')}
          </Button>
        )}
      </Group>

      {error && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          {error}
        </Alert>
      )}

      {running ? <LoadingState py={100} label={progress ?? t('appLoading')} /> : children}
    </Stack>
  )
}
