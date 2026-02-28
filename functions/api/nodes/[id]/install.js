import { requireAdmin } from '../../../_lib/auth.js'
import { KEY, kvGetJson } from '../../../_lib/kv.js'
import { ok, fail } from '../../../_lib/response.js'

function quoteShell(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`
}

export async function onRequestGet({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const node = await kvGetJson(kv, KEY.node(params.id))
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)
  if (node.node_type !== 'vps') {
    return fail('VALIDATION', 'Install command is only available for vps nodes', 400)
  }

  const origin = new URL(request.url).origin
  const command = [
    `URL=${quoteShell(`${origin}/agent/install`)}; `,
    `if command -v curl >/dev/null 2>&1; then curl -fsSL $URL; else wget -q -O - $URL; fi | bash -s --`,
    ` --api-base ${quoteShell(origin)}`,
    ` --node-id ${quoteShell(node.id)}`,
    ` --node-token ${quoteShell(node.token)}`,
    ` --tls-domain ${quoteShell(node.entry_cdn || '')}`,
    ` --heartbeat-interval ${quoteShell('300')}`,
  ].join('')

  return ok({ command })
}
