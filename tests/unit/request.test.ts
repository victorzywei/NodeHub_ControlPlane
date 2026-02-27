import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { request } from '@/api/request'
import { useAuthStore } from '@/stores/auth'

function successResponse(data) {
  return new Response(
    JSON.stringify({
      success: true,
      data,
      meta: { at: new Date().toISOString(), request_id: 'rid' },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('request', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('injects admin key header', async () => {
    const store = useAuthStore()
    store.setAdminKey('secret-key')

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(successResponse({ ok: true }))

    const result = await request('/api/system/status')
    expect(result).toEqual({ ok: true })

    const options = fetchMock.mock.calls[0][1]
    expect(options?.headers['X-Admin-Key']).toBe('secret-key')
  })
})
