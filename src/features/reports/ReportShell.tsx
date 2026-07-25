import { type ReactNode } from 'react'
import { Stack, Group, Title, Select, Button, Text, Alert, Loader, Center } from '@mantine/core'
import { IconAlertTriangle, IconFileSpreadsheet, IconPlayerPlay } from '@tabler/icons-react'
import { useLanguage } from '@/locales/LanguageContext'
import { useSelectionStore } from '@/store/selectionStore'
import { useBranches } from './useBranchLines'

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
        <Select
          placeholder={t('branch')}
          data={(branches ?? []).map((b) => ({ value: String(b.id), label: b.name }))}
          value={branchId != null ? String(branchId) : null}
          onChange={(v) => setBranchId(v ? Number(v) : null)}
          searchable
          size="xs"
          w={260}
        />
      </Group>

      <Group gap="sm" align="flex-end" wrap="wrap">
        {controls}
        <Button
          size="xs"
          leftSection={<IconPlayerPlay size={15} />}
          onClick={onRun}
          loading={running}
          disabled={branchId == null}
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

      {running ? (
        <Center py={60}>
          <Loader color="petrol" />
        </Center>
      ) : (
        children
      )}
    </Stack>
  )
}
