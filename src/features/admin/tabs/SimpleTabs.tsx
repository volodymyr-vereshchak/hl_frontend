import { useMemo, useState } from 'react'
import { Select } from '@mantine/core'
import { CrudTable, type CrudField } from '../CrudTable'
import { useAdminTopology, toOptions } from '../useAdminTopology'
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

  const fields: CrudField<Line>[] = [
    { key: 'id', label: 'ID', numeric: true, hideInForm: true },
    { key: 'name', label: 'Назва', required: true },
    { key: 'line', label: '№', numeric: true, type: 'number' },
    {
      key: 'gas_volume_calc_id',
      label: 'Обчислювач',
      type: 'select',
      options: toOptions(calcs),
      numericValue: true,
      render: (l) => calcName(l.gas_volume_calc_id),
    },
    { key: 'meter', label: 'Лічильник', type: 'checkbox' },
    { key: 'is_high_pressure', label: 'Високий тиск', type: 'checkbox' },
    { key: 'include_in_report', label: 'У звіт', type: 'checkbox' },
    { key: 'include_in_trends', label: 'У тренди', type: 'checkbox' },
    { key: 'pressure_unit', label: 'Од. тиску' },
    { key: 'dp_unit', label: 'Од. перепаду' },
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
    { key: 'type_id', label: 'Тип', numeric: true, type: 'number' },
    { key: 'address', label: 'Адреса', numeric: true, type: 'number' },
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
  const manufacturers: CrudField<Manufacturer>[] = [
    { key: 'id', label: 'ID', numeric: true, hideInForm: true },
    { key: 'mf_dev', label: 'Код', numeric: true, type: 'number' },
    { key: 'short_name', label: 'Скорочення' },
    { key: 'full_name', label: 'Повна назва' },
  ]
  return (
    <CrudTable<Manufacturer>
      title="Виробники приладів"
      description="Довідник каталогу пристроїв (тільки перегляд)"
      queryKey={['admin', 'manufacturers']}
      fetchAll={deviceCatalogApi.manufacturers}
      fields={manufacturers}
      searchKeys={['short_name', 'full_name']}
    />
  )
}

export function CorrectorTypesTab() {
  const fields: CrudField<CorectorType>[] = [
    { key: 'id', label: 'ID', numeric: true },
    { key: 'type_dev', label: 'Код типу', numeric: true },
    { key: 'mf_dev', label: 'Виробник', numeric: true },
    { key: 'model_name', label: 'Модель' },
    { key: 'name', label: 'Назва' },
  ]
  return (
    <CrudTable<CorectorType>
      title="Типи коректорів"
      description="Довідник каталогу пристроїв (тільки перегляд)"
      queryKey={['admin', 'corrector-types']}
      fetchAll={deviceCatalogApi.correctorTypes}
      fields={fields}
      searchKeys={['model_name', 'name']}
    />
  )
}
