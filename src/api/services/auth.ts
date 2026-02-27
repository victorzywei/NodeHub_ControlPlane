import { request } from '@/api/request'

export function login(adminKey: string): Promise<{ ok: true }> {
  return request('/api/auth/login', {
    method: 'POST',
    body: { admin_key: adminKey },
    auth: false,
  })
}
