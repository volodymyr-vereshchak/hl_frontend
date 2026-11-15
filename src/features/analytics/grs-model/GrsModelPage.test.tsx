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
  useBranchLines: () => ({
    data: [{ id: 208, name: 'Вільнянськ загальний', kind: 'virtual', include_in_trends: true }],
  }),
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
  it('analysis shows one view at a time: chart, stations, episodes', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('radio', { name: 'Графік' })
    expect(api.analysis).toHaveBeenCalledWith(9, expect.any(String), expect.any(String))
    expect(screen.queryByRole('cell', { name: 'Усі ГРС разом' })).toBeNull()

    await user.click(screen.getByRole('radio', { name: 'ГРС' }))
    await screen.findByRole('cell', { name: 'Усі ГРС разом' })
    for (const s of (analysis as unknown as GrsAnalysis).stations) {
      expect(screen.getAllByText(s.name).length).toBeGreaterThan(0)
    }

    // With all stations picked, every episode is listed.
    await user.click(screen.getByRole('radio', { name: /^Епізоди/ }))
    const all = (analysis as unknown as GrsAnalysis).episodes
    expect(screen.getAllByText('триває').length).toBe(all.filter((e) => e.open).length)
  })

  it('the period, the GRS and an episode are picked above the chart', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('radio', { name: 'Графік' })
    // Three months back from the last 1С day by default, no quick periods.
    const last = (status as unknown as GrsModelStatus).inflow!.last
    const back = new Date(`${last}T00:00:00`)
    back.setMonth(back.getMonth() - 3)
    const pad = (n: number) => String(n).padStart(2, '0')
    expect(api.analysis).toHaveBeenCalledWith(
      9,
      `${back.getFullYear()}-${pad(back.getMonth() + 1)}-${pad(back.getDate())}`,
      expect.any(String),
    )
    expect(screen.queryByRole('radio', { name: 'Рік' })).toBeNull()

    // A row of the stations table picks the GRS, and the selector shows it.
    const picker = screen
      .getAllByLabelText('ГРС')
      .find((el) => el.tagName === 'INPUT') as HTMLInputElement
    expect(picker.value).toBe('Усі ГРС разом')
    const episode = (analysis as unknown as GrsAnalysis).episodes[0]
    await user.click(screen.getByRole('radio', { name: 'ГРС' }))
    await user.click((await screen.findAllByRole('cell', { name: episode.grs }))[0])
    expect(picker.value).toBe(episode.grs)

    // Only that station's episodes; one of them opens the chart.
    await user.click(screen.getByRole('radio', { name: /^Епізоди/ }))
    const rows = screen.getAllByRole('row').slice(1)
    const own = (analysis as unknown as GrsAnalysis).episodes.filter((e) => e.grs === episode.grs)
    expect(rows.length).toBe(own.length)
    await user.click(within(rows[0]).getAllByRole('cell')[0])
    expect(screen.getByRole('radio', { name: 'Графік' })).toBeChecked()
    expect(
      screen.getByText((content) => content.startsWith(`${episode.grs} — `)),
    ).toBeInTheDocument()
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
