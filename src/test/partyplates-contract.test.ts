import { apiGet } from '@/lib/api-client'

describe('PartyPlates API contract', () => {
  it('GET /api/partyplates/ returns { system, mine }', async () => {
    const res = await apiGet<{ system: any[]; mine: any[] }>('/api/partyplates/')
    expect(res.data).toHaveProperty('system')
    expect(res.data).toHaveProperty('mine')
    expect(Array.isArray(res.data.system)).toBe(true)
    expect(Array.isArray(res.data.mine)).toBe(true)
  })
})
