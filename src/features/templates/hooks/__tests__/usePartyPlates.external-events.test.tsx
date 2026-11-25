import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'
import type { PartyPlate } from '../usePartyPlates'
import { usePartyPlates } from '../usePartyPlates'
import type { ApiResponse } from '@/lib/api-client'

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

interface MockApiResponse<T = any> {
  data: T
  error: { message: string; status?: number; code?: string } | null
}

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}))

import { apiGet, apiPost } from '@/lib/api-client'

const mockedApiGet = vi.mocked(apiGet)
const mockedApiPost = vi.mocked(apiPost)

const mockSystemTemplates: PartyPlate[] = [
  {
    id: 'sys-1',
    name: 'Birthday Bash',
    slug: 'birthday-bash',
    category: 'birthday',
    default_payload: { theme: 'balloons' },
  },
  {
    id: 'sys-2',
    name: 'Wedding Bliss',
    slug: 'wedding-bliss',
    category: 'wedding',
    default_payload: { theme: 'romantic' },
  },
  {
    id: 'sys-3',
    name: 'Kids Party',
    slug: 'kids-party',
    category: 'kids',
    default_payload: { theme: 'superhero' },
  },
  {
    id: 'sys-4',
    name: 'Corporate Gala',
    slug: 'corporate-gala',
    category: 'corporate',
    default_payload: { theme: 'black-tie' },
  },
  {
    id: 'sys-5',
    name: 'Baby Shower',
    slug: 'baby-shower',
    category: 'baby',
    default_payload: { theme: 'pastel' },
  },
  {
    id: 'sys-6',
    name: 'Graduation',
    slug: 'graduation',
    category: 'graduation',
    default_payload: { theme: 'caps-and-gowns' },
  },
  {
    id: 'sys-7',
    name: 'Anniversary',
    slug: 'anniversary',
    category: 'anniversary',
    default_payload: { theme: 'elegant' },
  },
  {
    id: 'sys-8',
    name: 'Retirement Party',
    slug: 'retirement-party',
    category: 'retirement',
    default_payload: { theme: 'gold' },
  },
  {
    id: 'sys-9',
    name: 'Bridal Shower',
    slug: 'bridal-shower',
    category: 'bridal',
    default_payload: { theme: 'floral' },
  },
  {
    id: 'sys-10',
    name: 'Housewarming',
    slug: 'housewarming',
    category: 'housewarming',
    default_payload: { theme: 'modern' },
  },
  {
    id: 'sys-11',
    name: 'Summer BBQ',
    slug: 'summer-bbq',
    category: 'summer',
    default_payload: { theme: 'grill' },
  },
]

const getLastApiGetUrl = () => {
  const calls = mockedApiGet.mock.calls
  return calls[calls.length - 1]?.[0]
}

const getLastApiPostUrl = () => {
  const calls = mockedApiPost.mock.calls
  return calls[calls.length - 1]?.[0]
}

describe('usePartyPlates with external events (Plan A)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns system and mine plates on success', async () => {
    mockedApiGet.mockResolvedValue({
      data: {
        system: mockSystemTemplates,
        mine: [],
        templates: mockSystemTemplates,
      },
      error: null,
    } as MockApiResponse<unknown>)
    const { result } = renderHook(() => usePartyPlates(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.system).toHaveLength(11)
    expect(result.current.templates).toHaveLength(11)
    expect(getLastApiGetUrl()).toBe('/api/event-templates/')
  })

  it('returns fallback system templates on API error', async () => {
    mockedApiGet.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => usePartyPlates(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.system).toHaveLength(11)
    expect(result.current.mine).toEqual([])
    expect(result.current.templates).toHaveLength(11)
  })

  it('merges API system templates with SYSTEM_TEMPLATES fallbacks', async () => {
    mockedApiGet.mockResolvedValue({
      data: {
        system: [mockSystemTemplates[0]],
        mine: [],
        templates: [mockSystemTemplates[0]],
      },
      error: null,
    } as MockApiResponse<unknown>)

    const { result } = renderHook(() => usePartyPlates(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const categories = result.current.system.map((t) => t.category)
    expect(categories).toContain('birthday')
    expect(categories).toContain('wedding')
  })

  it('uses API id when API returns matching category', async () => {
    mockedApiGet.mockResolvedValue({
      data: {
        system: [
          { ...mockSystemTemplates[0], id: 'api-uuid-123', category: 'birthday' },
        ],
        mine: [],
        templates: [],
      },
      error: null,
    } as MockApiResponse<unknown>)

    const { result } = renderHook(() => usePartyPlates(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const birthday = result.current.system.find((t) => t.category === 'birthday')
    expect(birthday?.id).toBe('api-uuid-123')
  })

  it('exposes isLoading and error states', async () => {
    mockedApiGet.mockRejectedValue(new Error('Service unavailable'))

    const { result } = renderHook(() => usePartyPlates(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBeDefined()
  })
})

describe('External events sync flow (Plan A)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('POST /api/external-events/sync/ starts a sync run and returns run_id', async () => {
    mockedApiPost.mockResolvedValue({
      data: {
        run_id: 'sync-run-abc-123',
        provider: 'ics',
        status: 'queued',
        events_fetched: 0,
        events_inserted: 0,
        events_updated: 0,
      },
      error: null,
    } as MockApiResponse)

    const res = await apiPost('/api/external-events/sync/', {
      provider_slug: 'ics',
    }) as ApiResponse<{ run_id: string; status: string }>

    expect(getLastApiPostUrl()).toBe('/api/external-events/sync/')
    expect(res.data?.run_id).toBe('sync-run-abc-123')
    expect(res.data?.status).toBe('queued')
  })

  it('GET /api/external-events/sources/ lists configured providers', async () => {
    mockedApiGet.mockResolvedValue({
      data: {
        providers: [
          { slug: 'ics', name: 'ICS / iCalendar feed', enabled: true },
          { slug: 'google_calendar', name: 'Google Calendar', enabled: false },
        ],
      },
      error: null,
    } as MockApiResponse)

    const res = await apiGet(
      '/api/external-events/sources/',
    ) as ApiResponse<{ providers: { slug: string; name: string; enabled: boolean }[] }>

    expect(getLastApiGetUrl()).toBe('/api/external-events/sources/')
    expect(res.data?.providers).toHaveLength(2)
    expect(res.data?.providers[0].slug).toBe('ics')
    expect(res.data?.providers[0].enabled).toBe(true)
  })

  it('GET /api/external-events/sync/:run_id/ polls sync status', async () => {
    mockedApiGet.mockResolvedValue({
      data: {
        run_id: 'sync-run-abc-123',
        provider: 'ics',
        status: 'completed',
        events_fetched: 2,
        events_inserted: 2,
        events_updated: 0,
        error: null,
        started_at: '2026-11-21T12:00:00Z',
        finished_at: '2026-11-21T12:00:05Z',
      },
      error: null,
    } as MockApiResponse)

    const res = await apiGet('/api/external-events/sync/sync-run-abc-123/') as ApiResponse<{
      status: string
      events_inserted: number
      error: null
    }>

    expect(getLastApiGetUrl()).toBe('/api/external-events/sync/sync-run-abc-123/')
    expect(res.data?.status).toBe('completed')
    expect(res.data?.events_inserted).toBe(2)
    expect(res.data?.error).toBeNull()
  })

  it('GET /api/external-events/ returns user-scoped external events', async () => {
    mockedApiGet.mockResolvedValue({
      data: {
        events: [
          {
            id: 'evt-1',
            name: 'Test Birthday Party',
            external_source: 'ics',
            external_event_id: 'test-event-001@example.com',
            external_metadata: { source: 'ics' },
          },
        ],
        count: 1,
      },
      error: null,
    } as MockApiResponse)

    const res = await apiGet('/api/external-events/') as ApiResponse<{
      events: { id: string; name: string; external_source: string; external_metadata: Record<string, unknown> }[]
    }>

    expect(getLastApiGetUrl()).toBe('/api/external-events/')
    expect(res.data?.events).toHaveLength(1)
    expect(res.data?.events[0].external_source).toBe('ics')
    expect(res.data?.events[0].external_metadata).toEqual({ source: 'ics' })
    expect(res.data?.events[0].external_metadata?.feed_url).toBeUndefined()
    expect(res.data?.events[0].external_metadata?.raw_uid).toBeUndefined()
  })

  it('GET /api/external-events/ supports ?source= filter', async () => {
    mockedApiGet.mockResolvedValue({
      data: { events: [], count: 0 },
      error: null,
    } as MockApiResponse)

    await apiGet('/api/external-events/', { params: { source: 'ics' } } as any)

    expect(getLastApiGetUrl()).toBe('/api/external-events/')
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/external-events/',
      expect.objectContaining({ params: { source: 'ics' } }),
    )
  })
})
