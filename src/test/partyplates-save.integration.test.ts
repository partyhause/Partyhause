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
    expect(res.status).toBe(201)
    expect(res.data).toHaveProperty('id')
    expect(res.data.name).toBe(payload.name)
  })
})
