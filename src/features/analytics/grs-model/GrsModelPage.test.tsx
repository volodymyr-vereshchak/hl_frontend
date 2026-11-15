import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GrsAnalysis, GrsModelStatus } from '@/api/grsModel'
import { LanguageProvider } from '@/locales/LanguageContext'
import { useSelectionStore } from '@/store/selectionStore'
import analysis from './__fixtures__/analysis.json'
import status from './__fixtures__/status.json'
import { GrsModelPage } from './GrsModelPage'

/*
 * The screen on what the backend really answered for the Zaporizhzhia branch
 * (three 1С exports and ERA5 weather): it must render every tab without
 * falling over, and show what it was given.
 */

let role: 'admin' | 'viewer' = 'admin'
vi.mock('@/features/auth/UserContext', () => ({
  useUser: () => ({ user: { username: 'u', role } }),
}))
vi.mock('@/features/reports/useBranchLines', () => ({
  useBranches: () => ({ data: [{ id: 9, name: 'Запорізька філія' }] }),
  useEnsureValidBranch: () => undefined,
  useBranchLines: () => ({ data: [{ id: 208, name: 'Вільнянськ загальний', kind: 'virtual', include_in_trends: true }] }),
}))
const api = vi.hoisted(() => ({
  status: vi.fn(),
  analysis: vi.fn(),
  train: vi.fn(),
  updateStation: vi.fn(),
  upload: vi.fn(),
}))
vi.mock('@/api/grsModel', () => ({ grsModelApi: api }))

beforeAll(() => {
  // jsdom has neither; Mantine and recharts ask for both.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  Element.prototype.scrollIntoView ??= () => {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('hlviewer-language', 'uk')
  role = 'admin'
  useSelectionStore.setState({ branchId: 9 })
  api.status.mockResolvedValue(status as unknown as GrsModelStatus)
  api.analysis.mockResolvedValue(analysis as unknown as GrsAnalysis)
})
afterEach(() => vi.clearAllMocks())

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <GrsModelPage />
        </LanguageProvider>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

describe('GrsModelPage', () => {
  it('analysis lists every modelled station and the episodes', async () => {
    renderPage()
    await screen.findByRole('cell', { name: 'Усі ГРС разом' })
    expect(api.analysis).toHaveBeenCalledWith(9, expect.any(String), expect.any(String))
    for (const s of (analysis as unknown as GrsAnalysis).stations) {
      expect(screen.getAllByText(s.name).length).toBeGreaterThan(0)
    }
    const open = (analysis as unknown as GrsAnalysis).episodes.filter((e) => e.open).length
    expect(screen.getAllByText('триває').length).toBeGreaterThanOrEqual(open)
  })

  it('the period and the GRS are picked above the chart', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('cell', { name: 'Усі ГРС разом' })
    expect(screen.getByRole('radio', { name: 'Рік' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'Весь період' }))
    await waitFor(() =>
      expect(api.analysis).toHaveBeenLastCalledWith(9, '2025-01-01', expect.any(String)),
    )

    // A row of the table picks the GRS too, and the selector shows it.
    const picker = screen
      .getAllByLabelText('ГРС')
      .find((el) => el.tagName === 'INPUT') as HTMLInputElement
    expect(picker.value).toBe('Усі ГРС разом')
    await user.click(screen.getAllByRole('cell', { name: 'ГРС Вільнянськ' })[0])
    expect(picker.value).toBe('ГРС Вільнянськ')
    expect(screen.getByText(/^ГРС Вільнянськ — /)).toBeInTheDocument()
  })

  it('model tab shows quality per station and the train button', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('tab', { name: /Модель/ }))
    expect(await screen.findByRole('button', { name: 'Перенавчити модель' })).toBeInTheDocument()
    const row = screen.getByText('ГРС Вільнянськ').closest('tr')!
    // Shown to one decimal: 4.06 % → «4,1 %».
    const cells = within(row)
      .getAllByRole('cell')
      .map((c) => c.textContent?.replace(/\s/g, ' '))
    expect(cells).toContain('4,1 %')
    expect(screen.getByText(/обсяг мізерний/)).toBeInTheDocument()
  })

  it('data tab shows the uploads and stations; a viewer gets no upload', async () => {
    role = 'viewer'
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('tab', { name: /Дані/ }))
    await screen.findByText('Журнал завантажень')
    expect(screen.getAllByText('grs.xlsx').length).toBe(2)
    expect(screen.queryByRole('button', { name: 'Вибрати файли' })).toBeNull()
    expect(screen.queryByRole('button', { name: /навчити/i })).toBeNull()
  })

  it('an empty branch opens on the data tab', async () => {
    api.status.mockResolvedValue({
      ...(status as unknown as GrsModelStatus),
      rows: 0,
      stations: [],
      uploads: [],
      fit: null,
      inflow: null,
      consumption: null,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Даних ще немає/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Вибрати файли' })).toBeInTheDocument()
    expect(api.analysis).not.toHaveBeenCalled()
  })
})
