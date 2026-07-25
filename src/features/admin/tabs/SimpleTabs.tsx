import { useQuery } from '@tanstack/react-query'
import { Badge, Button } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { CrudTable, type CrudField } from '../CrudTable'
import {
  userApi,
  branchAdminApi,
  lumgAdminApi,
  lineAdminApi,
  calcAdminApi,
  calcTypeAdminApi,
  virtualLineAdminApi,
  dpdLineAdminApi,
  deviceCatalogApi,
  enterpriseMappingApi,
  type AdminUser,
  type Manufacturer,
  type CorectorType,
  type EnterpriseMapping,
} from '@/api/admin'
import type { Branch, Lumg, Line, GasVolumeCalc, CalcType, VirtualLine, DpdLine } from '@/types'

/** Branch options shared by several tabs. */
function useBranchOptions() {
  const { data } = useQuery({ queryKey: ['admin', 'branches'], queryFn: branchAdminApi.getAll })
  return (data ?? []).map((b) => ({ value: String(b.id), label: b.name }))
}

function useLumgOptions() {
  const { data } = useQuery({ queryKey: ['admin', 'lumgs'], queryFn: lumgAdminApi.getAll })
  return (data ?? []).map((l) => ({ value: String(l.id), label: l.name }))
}

// ── Система ─────────────────────────────────────────────────────────────────
export function UsersTab() {
  const fields: CrudField<AdminUser>[] = [
    { key: 'id', label: 'ID', numeric: true, hideInForm: true },
    { key: 'username', label: 'Логін', required: true },
    { key: 'display_name', label: 'Імʼя' },
    {
      key: 'role',
      label: 'Роль',
      type: 'select',
      options: [
        { value: 'admin', label: 'Адміністратор' },
        { value: 'viewer', label: 'Спостерігач' },
      ],
      render: (u) => (
        <Badge variant="light" color={u.role === 'admin' ? 'amber' : 'petrol'} size="sm">
          {u.role}
        </Badge>
      ),
    },
    { key: 'active', label: 'Активний', type: 'checkbox' },
    { key: 'password', label: 'Пароль (для нового)', hideInTable: true },
  ]
  return (
    <CrudTable<AdminUser>
      title="Користувачі"
      description="Облікові записи та ролі доступу"
      queryKey={['admin', 'users']}
      fetchAll={userApi.getAll}
      create={(d) => userApi.create(d as Partial<AdminUser> & { password?: string })}
      update={(id, d) => userApi.update(id, d as Partial<AdminUser>)}
      remove={userApi.remove}
      fields={fields}
      searchKeys={['username', 'display_name', 'role']}
      rowLabel={(u) => u.username}
      extraRowActions={(u) => (
        <Button
          size="compact-xs"
          variant="subtle"
          onClick={() => {
            const pwd = window.prompt(`Новий пароль для ${u.username}:`)
            if (!pwd) return
            userApi
              .resetPassword(u.id, pwd)
              .then(() => notifications.show({ message: 'Пароль змінено', color: 'teal' }))
              .catch((e: Error) => notifications.show({ message: e.message, color: 'red' }))
          }}
        >
          Пароль
        </Button>
      )}
    />
  )
}

// ── Мережа ──────────────────────────────────────────────────────────────────
export function BranchesTab() {
  const fields: CrudField<Branch>[] = [
    { key: 'id', label: 'ID', numeric: true, hideInForm: true },
    { key: 'name', label: 'Назва', required: true },
    { key: 'short_name', label: 'Скорочення' },
    { key: 'region', label: 'Регіон' },
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
  const branches = useBranchOptions()
  const fields: CrudField<Lumg>[] = [
    { key: 'id', label: 'ID', numeric: true, hideInForm: true },
    { key: 'name', label: 'Назва', required: true },
    { key: 'branch_id', label: 'Філія', type: 'select', options: branches, required: true },
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
      rowLabel={(l) => l.name}
    />
  )
}

// ── Лінії ───────────────────────────────────────────────────────────────────
export function LinesConfigTab() {
  const fields: CrudField<Line>[] = [
    { key: 'id', label: 'ID', numeric: true, hideInForm: true },
    { key: 'name', label: 'Назва', required: true },
    { key: 'line', label: '№', numeric: true, type: 'number' },
    { key: 'gas_volume_calc_id', label: 'Обчислювач', numeric: true, type: 'number' },
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
    />
  )
}

export function CalcsTab() {
  const lumgs = useLumgOptions()
  const fields: CrudField<GasVolumeCalc>[] = [
    { key: 'id', label: 'ID', numeric: true, hideInForm: true },
    { key: 'name', label: 'Назва', required: true },
    { key: 'lumg_id', label: 'ЛУМГ', type: 'select', options: lumgs, required: true },
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
    />
  )
}

export function VirtualLinesTab() {
  const branches = useBranchOptions()
  const lumgs = useLumgOptions()
  const fields: CrudField<VirtualLine>[] = [
    { key: 'id', label: 'ID', numeric: true, hideInForm: true },
    { key: 'name', label: 'Назва', required: true },
    { key: 'branch_id', label: 'Філія', type: 'select', options: branches },
    { key: 'lumg_id', label: 'ЛУМГ', type: 'select', options: lumgs },
    { key: 'include_in_report', label: 'У звіт', type: 'checkbox' },
    { key: 'include_in_trends', label: 'У тренди', type: 'checkbox' },
  ]
  return (
    <CrudTable<VirtualLine>
      title="Віртуальні лінії"
      description="Агрегація кількох фізичних ліній («кільця»)"
      queryKey={['admin', 'virtual-lines']}
      fetchAll={virtualLineAdminApi.getAll}
      create={(d) => virtualLineAdminApi.create(d as Partial<VirtualLine>)}
      update={(id, d) => virtualLineAdminApi.update(id, d as Partial<VirtualLine>)}
      remove={virtualLineAdminApi.remove}
      fields={fields}
      searchKeys={['name']}
      rowLabel={(l) => l.name}
    />
  )
}

export function DpdLinesTab() {
  const branches = useBranchOptions()
  const lumgs = useLumgOptions()
  const fields: CrudField<DpdLine>[] = [
    { key: 'id', label: 'ID', numeric: true, hideInForm: true },
    { key: 'name', label: 'Назва', required: true },
    { key: 'branch_id', label: 'Філія', type: 'select', options: branches },
    { key: 'lumg_id', label: 'ЛУМГ', type: 'select', options: lumgs },
    { key: 'active', label: 'Активна', type: 'checkbox' },
    { key: 'include_in_report', label: 'У звіт', type: 'checkbox' },
    { key: 'include_in_trends', label: 'У тренди', type: 'checkbox' },
  ]
  return (
    <CrudTable<DpdLine>
      title="Лінії ДПД"
      description="Дані з API ДПД за серійним номером коректора"
      queryKey={['admin', 'dpd-lines']}
      fetchAll={dpdLineAdminApi.getAll}
      create={(d) => dpdLineAdminApi.create(d as Partial<DpdLine>)}
      update={(id, d) => dpdLineAdminApi.update(id, d as Partial<DpdLine>)}
      remove={dpdLineAdminApi.remove}
      fields={fields}
      searchKeys={['name']}
      rowLabel={(l) => l.name}
      extraRowActions={(l) => (
        <Button
          size="compact-xs"
          variant="subtle"
          onClick={() =>
            dpdLineAdminApi
              .init(l.id)
              .then(() => notifications.show({ message: 'Ініціалізацію запущено', color: 'teal' }))
              .catch((e: Error) => notifications.show({ message: e.message, color: 'red' }))
          }
        >
          Init
        </Button>
      )}
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

export function EnterprisesTab() {
  const branches = useBranchOptions()
  const fields: CrudField<EnterpriseMapping>[] = [
    { key: 'id', label: 'ID', numeric: true, hideInForm: true },
    { key: 'name', label: 'Підприємство', required: true },
    { key: 'line_id', label: 'Лінія', numeric: true, type: 'number' },
    { key: 'ser_num', label: 'Сер. номер' },
    { key: 'branch_id', label: 'Філія', type: 'select', options: branches },
  ]
  return (
    <CrudTable<EnterpriseMapping>
      title="Підприємства"
      description="Відповідність підприємств лініям та приладам"
      queryKey={['admin', 'enterprise-mappings']}
      fetchAll={enterpriseMappingApi.getAll}
      create={(d) => enterpriseMappingApi.create(d as Partial<EnterpriseMapping>)}
      update={(id, d) => enterpriseMappingApi.update(id, d as Partial<EnterpriseMapping>)}
      remove={enterpriseMappingApi.remove}
      fields={fields}
      searchKeys={['name', 'ser_num']}
      rowLabel={(e) => String(e.name ?? e.id)}
    />
  )
}
