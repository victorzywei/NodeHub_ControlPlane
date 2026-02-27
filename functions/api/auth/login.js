import { ok, fail } from '../../_lib/response.js'

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}))
  const provided = String(body.admin_key || '')
  const expected = String(env.ADMIN_KEY || '')

  if (!expected) return fail('CONFIG_ERROR', 'ADMIN_KEY is missing', 500)
  if (!provided || provided !== expected) {
    return fail('UNAUTHORIZED', 'Invalid admin key', 401)
  }

  return ok({ ok: true })
}
