import { requireAdmin } from '../../_lib/auth.js'
import { TEMPLATE_REGISTRY } from '../../_lib/constants.js'
import { ok } from '../../_lib/response.js'

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response
  return ok(TEMPLATE_REGISTRY)
}
