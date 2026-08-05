import { useMemo, useState } from 'react'
import { Button, Checkbox, Group, Select, Stack, Text, Tooltip } from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconDeviceFloppy, IconDownload } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CrudTable, type CrudField } from '../CrudTable'
import { useAdminTopology, toOptions } from '../useAdminTopology'
import { UNIT_LABELS } from '@/domain/pressureUnits'
import {
  branchAdminApi,
  lumgAdminApi,
  lineAdminApi,
  calcAdminApi,
  calcTypeAdminApi,
  deviceCatalogApi,
  type Manufacturer,
  type CorectorType,
} from '@/api/admin'
import type { Branch, Lumg, Line, GasVolumeCalc, CalcType } from '@/types'

// ── Мережа ──────────────────────────────────────────────────────────────────
export function BranchesTab() {
  // `region` exists on grmu_branch but nothing reads it — kept out of the form
  // so it does not look like a field that matters.
  const fields: CrudField<Branch>[] = [
    { key: 'id', label: 'ID', numeric: true, hideInForm: true },
    { key: 'name', label: 'Назва', required: true },
    { key: 'short_name', label: 'Скорочення' },
    { key: 'active', label: 'Активний', type: 'checkbox' },
  ]
  return (
    <CrudTable<Branch>
      title="Філії ГРМУ"
      queryKey={['admin', 'branches']}
      fetchAll={branchAdminApi.getAll}
      create={(d) => branchAdminApi.create(d as Partial<Branch>)}
      update={(id, d) => branchAdminApi.update(id, d as Partial<Branch>)}
      remove={branchAdminApi.remove}
      fields={fields}
      rowLabel={(b) => b.name}
    />
  )
}

export function LumgsTab() {
  const { branches, branchName } = useAdminTopology()
  const [branchFilter, setBranchFilter] = useState<string | null>(null)

  const fields: CrudField<Lumg>[] = [
    { key: 'id', label: 'ID', numeric: true, hideInForm: true },
    { key: 'name', label: 'Назва', required: true },
    {
      key: 'branch_id',
      label: 'Філія',
      type: 'select',
      options: toOptions(branches),
      numericValue: true,
      required: true,
      render: (l) => branchName(l.branch_id),
    },
  ]
  return (
    <CrudTable<Lumg>
      title="ЛУМГ"
      description="Лінійні управління магістральних газопроводів"
      queryKey={['admin', 'lumgs']}
      fetchAll={lumgAdminApi.getAll}
      create={(d) => lumgAdminApi.create(d as Partial<Lumg>)}
      update={(id, d) => lumgAdminApi.update(id, d as Partial<Lumg>)}
      remove={lumgAdminApi.remove}
      fields={fields}
      searchKeys={['name']}
      rowLabel={(l) => l.name}
      createDefaults={branchFilter ? { branch_id: Number(branchFilter) } : undefined}
      filter={(l) => !branchFilter || String(l.branch_id) === branchFilter}
      toolbarExtra={
        <Select
          size="xs"
          w={220}
          placeholder="Всі філії"
          data={toOptions(branches)}
          value={branchFilter}
          onChange={setBranchFilter}
          clearable
          searchable
        />
      }
    />
  )
}

// ── Лінії ───────────────────────────────────────────────────────────────────
export function LinesConfigTab() {
  const { branches, calcs, calcName, calcIdsOfBranch } = useAdminTopology()
  const [branchFilter, setBranchFilter] = useState<string | null>(null)
  const [calcFilter, setCalcFilter] = useState<string | null>(null)

  // The calc list depends on the branch, so switching branch drops a stale calc.
  const branchCalcIds = useMemo(
    () => (branchFilter ? new Set(calcIdsOfBranch(Number(branchFilter))) : null),
    [branchFilter, calcIdsOfBranch],
  )
  const calcOptions = useMemo(
    () => toOptions(branchCalcIds ? calcs.filter((c) => branchCalcIds.has(c.id)) : calcs),
    [calcs, branchCalcIds],
  )

  const { data: lines } = useQuery({
    queryKey: ['admin', 'lines'],
    queryFn: () => lineAdminApi.getAll(),
  })

  /**
   * Units come from a fixed list, not free text.
   *
   * The output pressure of a low-pressure line is computed as P − dP, with dP
   * converted from its own unit into the pressure unit. That conversion looks
   * the unit up by its exact label; a hand-typed "кгс/см2" (no superscript) is
   * not found, and `convertPressureValue` then returns the value UNCONVERTED —
   * silently, with no sign on screen that the number is wrong.
   *
   * Anything already stored that is not in the list is kept as an option, so
   * opening a line for an unrelated edit cannot quietly rewrite its unit. Such
   * a value is marked, because it is exactly the case that skips conversion.
   */
  const unitOptions = (key: 'pressure_unit' | 'dp_unit') => {
    const stored = new Set(
      (lines ?? []).map((l) => l[key]).filter((u): u is string => !!u && !UNIT_LABELS.includes(u)),
    )
    return [
      ...UNIT_LABELS.map((u) => ({ value: u, label: u })),
      ...[...stored].map((u) => ({ value: u, label: `${u} — не розпізнано, без перерахунку` })),
    ]
  }

  const fields: CrudField<Line>[] = [
    { key: 'id', label: 'ID', numeric: true, hideInForm: true },
    { key: 'name', label: 'Назва', required: true },
    { key: 'line', label: '№', numeric: true, type: 'number', required: true },
    {
      key: 'gas_volume_calc_id',
      label: 'Обчислювач',
      type: 'select',
      options: toOptions(calcs),
      numericValue: true,
      required: true,
      render: (l) => calcName(l.gas_volume_calc_id),
    },
    { key: 'meter', label: 'Лічильник', type: 'checkbox' },
    { key: 'is_high_pressure', label: 'Високий тиск', type: 'checkbox' },
    { key: 'include_in_report', label: 'У звіт', type: 'checkbox' },
    { key: 'include_in_trends', label: 'У тренди', type: 'checkbox' },
    { key: 'pressure_unit', label: 'Од. тиску', type: 'select', options: unitOptions('pressure_unit') },
    { key: 'dp_unit', label: 'Од. перепаду', type: 'select', options: unitOptions('dp_unit') },
  ]
  return (
    <CrudTable<Line>
      title="Лінії"
      description="Фізичні вимірювальні лінії"
      queryKey={['admin', 'lines']}
      fetchAll={() => lineAdminApi.getAll()}
      create={(d) => lineAdminApi.create(d as Partial<Line>)}
      update={(id, d) => lineAdminApi.update(id, d as Partial<Line>)}
      remove={lineAdminApi.remove}
      fields={fields}
      searchKeys={['name']}
      rowLabel={(l) => l.name}
      createDefaults={calcFilter ? { gas_volume_calc_id: Number(calcFilter) } : undefined}
      filter={(l) => {
        if (calcFilter) return String(l.gas_volume_calc_id) === calcFilter
        if (branchCalcIds) return l.gas_volume_calc_id != null && branchCalcIds.has(l.gas_volume_calc_id)
        return true
      }}
      toolbarExtra={
        <>
          <Select
            size="xs"
            w={200}
            placeholder="Всі філії"
            data={toOptions(branches)}
            value={branchFilter}
            onChange={(v) => {
              setBranchFilter(v)
              setCalcFilter(null)
            }}
            clearable
            searchable
          />
          <Select
            size="xs"
            w={220}
            placeholder="Всі обчислювачі"
            data={calcOptions}
            value={calcFilter}
            onChange={setCalcFilter}
            clearable
            searchable
          />
        </>
      }
    />
  )
}

export function CalcsTab() {
  const { branches, lumgs, lumgName, branchName, lumgIdsOfBranch } = useAdminTopology()
  const [branchFilter, setBranchFilter] = useState<string | null>(null)
  // `type_id` is a foreign key into gas_vol_calc_type, not the type CODE — a
  // typed-in number silently pointed at the wrong type or at nothing at all.
  const { data: calcTypes } = useQuery({
    queryKey: ['admin', 'calc-types'],
    queryFn: calcTypeAdminApi.getAll,
  })
  const typeOptions = useMemo(
    () => (calcTypes ?? []).map((t) => ({ value: String(t.id), label: t.type_name })),
    [calcTypes],
  )
  const typeName = useMemo(() => {
    const m = new Map((calcTypes ?? []).map((t) => [t.id, t.type_name]))
    return (id?: number | null) => (id == null ? '—' : (m.get(id) ?? String(id)))
  }, [calcTypes])

  const branchLumgIds = useMemo(
    () => (branchFilter ? new Set(lumgIdsOfBranch(Number(branchFilter))) : null),
    [branchFilter, lumgIdsOfBranch],
  )
  const lumgToBranch = useMemo(
    () => new Map(lumgs.map((l) => [l.id, l.branch_id])),
    [lumgs],
  )

  const fields: CrudField<GasVolumeCalc>[] = [
    { key: 'id', label: 'ID', numeric: true, hideInForm: true },
    { key: 'name', label: 'Назва', required: true },
    {
      key: 'lumg_id',
      label: 'ЛУМГ',
      type: 'select',
      options: toOptions(lumgs),
      numericValue: true,
      required: true,
      render: (c) => lumgName(c.lumg_id),
    },
    {
      key: 'branch',
      label: 'Філія',
      hideInForm: true,
      render: (c) => branchName(c.lumg_id != null ? lumgToBranch.get(c.lumg_id) : null),
    },
    {
      key: 'type_id',
      label: 'Тип',
      type: 'select',
      options: typeOptions,
      numericValue: true,
      render: (c) => typeName(c.type_id),
    },
    { key: 'address', label: 'Адреса', numeric: true, type: 'number', required: true },
    // No c_time field on purpose. The column exists and is NOT NULL, but the
    // config reader writes the same 7 into every row and nothing ever reads it
    // back, so there is nothing for an administrator to decide. The API fills it
    // in (GasVolumeCalcCreate.c_time = 7); asking here would only be a number
    // that cannot be anything else.
  ]
  return (
    <CrudTable<GasVolumeCalc>
      title="Обчислювачі"
      queryKey={['admin', 'calcs']}
      fetchAll={calcAdminApi.getAll}
      create={(d) => calcAdminApi.create(d as Partial<GasVolumeCalc>)}
      update={(id, d) => calcAdminApi.update(id, d as Partial<GasVolumeCalc>)}
      remove={calcAdminApi.remove}
      fields={fields}
      searchKeys={['name']}
      rowLabel={(c) => c.name}
      filter={(c) => !branchLumgIds || (c.lumg_id != null && branchLumgIds.has(c.lumg_id))}
      toolbarExtra={
        <Select
          size="xs"
          w={220}
          placeholder="Всі філії"
          data={toOptions(branches)}
          value={branchFilter}
          onChange={setBranchFilter}
          clearable
          searchable
        />
      }
    />
  )
}

// ── Довідники ───────────────────────────────────────────────────────────────
export function CalcTypesTab() {
  const fields: CrudField<CalcType>[] = [
    { key: 'id', label: 'ID', numeric: true, hideInForm: true },
    { key: 'type_id', label: 'Код типу', numeric: true, type: 'number', required: true },
    { key: 'type_name', label: 'Назва типу', required: true },
  ]
  return (
    <CrudTable<CalcType>
      title="Типи обчислювачів"
      queryKey={['admin', 'calc-types']}
      fetchAll={calcTypeAdminApi.getAll}
      create={(d) => calcTypeAdminApi.create(d as Partial<CalcType>)}
      update={(id, d) => calcTypeAdminApi.update(id, d as Partial<CalcType>)}
      remove={calcTypeAdminApi.remove}
      fields={fields}
      searchKeys={['type_name']}
      rowLabel={(c) => c.type_name}
    />
  )
}

export function DeviceMappingsTab() {
  const fields: CrudField<Manufacturer>[] = [
    { key: 'id', label: 'ID', numeric: true, hideInForm: true },
    // mf_dev is how DPD addresses the manufacturer: it goes into every poll
    // request, so it is the manufacturer's identity, not a label.
    { key: 'mf_dev', label: 'Код', numeric: true, type: 'number', required: true },
    { key: 'short_name', label: 'Скорочення', required: true },
    { key: 'full_name', label: 'Повна назва', required: true },
  ]
  // The startup preload matches manufacturers by mf_dev and takes the name
  // from device_catalog.json — that is what carries a rename to the offline
  // server, but it also means an unexported rename is reverted on restart.
  return (
    <CrudTable<Manufacturer>
      title="Виробники приладів"
      description="Довідник каталогу пристроїв. Код (mf_dev) — те, чим ДПД адресує виробника. Після перейменування натисніть «Зберегти в JSON», інакше назву буде відновлено з файлу під час перезапуску"
      queryKey={['admin', 'manufacturers']}
      fetchAll={deviceCatalogApi.manufacturers}
      create={(d) => deviceCatalogApi.createManufacturer(d as Partial<Manufacturer>)}
      update={(id, d) => deviceCatalogApi.updateManufacturer(id, d as Partial<Manufacturer>)}
      remove={deviceCatalogApi.removeManufacturer}
      fields={fields}
      searchKeys={['short_name', 'full_name']}
      rowLabel={(m) => m.short_name}
      toolbarExtra={<CatalogTransferControls />}
    />
  )
}

export function CorrectorTypesTab() {
  // A corrector type stores `manufacturer_id`, not the manufacturer's DPD code,
  // and has no `name` at all. The old columns read `mf_dev` and `name` off the
  // row, so both rendered as an em dash on every line.
  const { data: manufacturers } = useQuery({
    queryKey: ['admin', 'manufacturers'],
    queryFn: deviceCatalogApi.manufacturers,
    staleTime: 5 * 60_000,
  })
  const manufacturerName = useMemo(() => {
    const byId = new Map((manufacturers ?? []).map((m) => [m.id, m.short_name]))
    return (id: number | null | undefined) => (id == null ? '—' : (byId.get(id) ?? `#${id}`))
  }, [manufacturers])
  const manufacturerOptions = useMemo(
    () =>
      (manufacturers ?? [])
        .map((m) => ({ value: String(m.id), label: `${m.short_name} (mf_dev ${m.mf_dev})` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [manufacturers],
  )
  const [mfrFilter, setMfrFilter] = useState<string | null>(null)

  const fields: CrudField<CorectorType>[] = [
    { key: 'id', label: 'ID', numeric: true, hideInForm: true },
    // (mf_dev, type_dev) is the pair DPD is asked by, so type_dev is identity
    // too — and it is what decides which volume field a model reports in.
    { key: 'type_dev', label: 'Код типу', numeric: true, type: 'number', required: true },
    {
      key: 'manufacturer_id',
      label: 'Виробник',
      type: 'select',
      options: manufacturerOptions,
      numericValue: true,
      required: true,
      render: (c) => manufacturerName(c.manufacturer_id),
    },
    { key: 'model_name', label: 'Модель', required: true },
  ]
  return (
    <CrudTable<CorectorType>
      title="Типи коректорів"
      description="Довідник каталогу пристроїв. Пара (код виробника, код типу) — те, чим ДПД адресує прилад"
      queryKey={['admin', 'corrector-types']}
      fetchAll={deviceCatalogApi.correctorTypes}
      create={(d) => deviceCatalogApi.createCorrectorType(d as Partial<CorectorType>)}
      update={(id, d) => deviceCatalogApi.updateCorrectorType(id, d as Partial<CorectorType>)}
      remove={deviceCatalogApi.removeCorrectorType}
      fields={fields}
      searchKeys={['model_name']}
      rowLabel={(c) => c.model_name}
      createDefaults={mfrFilter ? { manufacturer_id: Number(mfrFilter) } : undefined}
      filter={(c) => !mfrFilter || String(c.manufacturer_id) === mfrFilter}
      toolbarExtra={
        <>
          <Select
            size="xs"
            w={220}
            placeholder="Всі виробники"
            data={manufacturerOptions}
            value={mfrFilter}
            onChange={setMfrFilter}
            clearable
            searchable
          />
          <CatalogTransferControls />
        </>
      }
    />
  )
}

/**
 * Moving the catalog between installations.
 *
 * The catalog lives in the database, but the offline server is fed by
 * `backend/db/preload_db/device_catalog.json`, which travels with the code.
 * «Зберегти в JSON» writes the current DB state into that file so the change
 * can be committed and carried over; «Завантажити з JSON» is the other
 * direction, and is what the offline side runs after receiving it.
 */
function CatalogTransferControls() {
  const qc = useQueryClient()
  const [force, setForce] = useState(false)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'manufacturers'] })
    qc.invalidateQueries({ queryKey: ['admin', 'corrector-types'] })
  }

  const exportJson = useMutation({
    mutationFn: deviceCatalogApi.exportPreload,
    onSuccess: (res) =>
      notifications.show({
        title: 'Каталог збережено у device_catalog.json',
        message:
          `Виробників: ${res.exported.manufacturers}, моделей: ${res.exported.corector_types}. ` +
          'Щоб зміни потрапили на сервер, файл треба закомітити разом з кодом',
        color: 'teal',
        autoClose: 8000,
      }),
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red' }),
  })

  const preload = useMutation({
    mutationFn: () => deviceCatalogApi.preload(force),
    onSuccess: (res) => {
      // Warnings are the whole point of the report: they name the models where
      // this database and the file disagree, which is what a rename made on
      // one side and not the other looks like from here.
      const warnings = res.warnings ?? []
      notifications.show({
        title: res.message,
        message: warnings.length ? (
          <Stack gap={2}>
            {warnings.slice(0, 5).map((w) => (
              <Text key={w} size="xs">
                {w}
              </Text>
            ))}
            {warnings.length > 5 && (
              <Text size="xs" c="dimmed">
                …та ще {warnings.length - 5}
              </Text>
            )}
          </Stack>
        ) : null,
        color: warnings.length ? 'yellow' : 'teal',
        autoClose: warnings.length ? 12000 : 4000,
      })
      invalidate()
    },
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red' }),
  })

  const runPreload = () => {
    if (!force) {
      preload.mutate()
      return
    }
    // Перезапис wipes the catalog and rebuilds it from the file. Corrector
    // types are referenced by every device, so this is not a refresh.
    modals.openConfirmModal({
      title: 'Перезаписати каталог',
      children: (
        <Text size="sm">
          Каталог буде <b>повністю очищено</b> і завантажено з device_catalog.json. Записи,
          додані тут і відсутні у файлі, зникнуть. Якщо на моделі вже посилаються прилади,
          база не дозволить очищення — тоді достатньо звичайного завантаження, воно оновить
          назви виробників за кодом. Продовжити?
        </Text>
      ),
      labels: { confirm: 'Перезаписати', cancel: 'Скасувати' },
      confirmProps: { color: 'red' },
      onConfirm: () => preload.mutate(),
    })
  }

  return (
    <Group gap="xs" wrap="nowrap">
      <Tooltip
        label="Зберегти поточний стан каталогу у device_catalog.json — файл, який переноситься на сервер разом з кодом"
        withArrow
        multiline
        w={280}
      >
        <Button
          size="compact-xs"
          variant="default"
          leftSection={<IconDeviceFloppy size={13} />}
          onClick={() => exportJson.mutate()}
          loading={exportJson.isPending}
        >
          Зберегти в JSON
        </Button>
      </Tooltip>
      <Tooltip
        label="Завантажити каталог з device_catalog.json у базу: назви виробників оновлюються за кодом mf_dev, відсутні моделі додаються, наявні лишаються як є"
        withArrow
        multiline
        w={280}
      >
        <Button
          size="compact-xs"
          variant="default"
          leftSection={<IconDownload size={13} />}
          onClick={runPreload}
          loading={preload.isPending}
        >
          Завантажити з JSON
        </Button>
      </Tooltip>
      <Checkbox
        size="xs"
        label="перезаписати"
        checked={force}
        onChange={(e) => setForce(e.currentTarget.checked)}
      />
    </Group>
  )
}
