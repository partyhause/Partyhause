import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { usePartyPlates } from '../usePartyPlates'

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('usePartyPlates', () => {
  it('returns system and mine plates on success', async () => {
    const { result } = renderHook(() => usePartyPlates(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.system).toBeDefined()
    expect(result.current.mine).toBeDefined()
  })

  it('returns empty arrays on error', async () => {
    const { result } = renderHook(() => usePartyPlates(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(Array.isArray(result.current.system)).toBe(true)
    expect(Array.isArray(result.current.mine)).toBe(true)
  })
})
