import { apiPost } from '@/lib/api-client'

describe('PartyPlates Save integration', () => {
  it('POST /api/partyplates/create/ saves user plate', async () => {
    const payload = {
      name: 'Test Plate',
      description: 'Test description',
      category: 'custom',
      default_payload: { event: { event_type: 'single_day' } }
    }
    const res = await apiPost('/api/partyplates/create/', payload)
    expect(res.error).toBeNull()
    // data is non-null when error is null (server contract)
    const data = res.data as unknown as { id: string; name: string }
    expect(data).toHaveProperty('id')
    expect(data.name).toBe(payload.name)
  })
})
