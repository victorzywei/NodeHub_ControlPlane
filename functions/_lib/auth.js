import { fail } from './response.js'

export function requireAdmin(request, env) {
  const key = request.headers.get('X-Admin-Key') || ''
  const expected = String(env.ADMIN_KEY || '')
  if (!expected) {
    return { ok: false, response: fail('CONFIG_ERROR', 'ADMIN_KEY is missing', 500) }
  }
  if (!key || key !== expected) {
    return { ok: false, response: fail('UNAUTHORIZED', 'Invalid admin key', 401) }
  }
  return { ok: true }
}
