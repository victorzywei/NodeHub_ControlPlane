import { requireAdmin } from '../../_lib/auth.js'
import { APP_VERSION } from '../../_lib/constants.js'
import { ok } from '../../_lib/response.js'

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  return ok({
    app_version: APP_VERSION,
    kv_available: Boolean(env.NODEHUB_KV),
    kv_namespace: env.NODEHUB_KV ? 'NODEHUB_KV' : '',
    uptime_hint: 'Cloudflare Functions runtime',
    now: new Date().toISOString(),
  })
}
