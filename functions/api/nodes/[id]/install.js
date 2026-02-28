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
  const commandParts = [
    `URL=${quoteShell(`${origin}/agent/install`)}; `,
    `if command -v curl >/dev/null 2>&1; then curl -fsSL $URL; else wget -q -O - $URL; fi | bash -s --`,
    ` --api-base ${quoteShell(origin)}`,
    ` --node-id ${quoteShell(node.id)}`,
    ` --node-token ${quoteShell(node.token)}`,
    ` --heartbeat-interval ${quoteShell('600')}`,
  ]

  if (node.entry_cdn) {
    commandParts.push(` --tls-domain ${quoteShell(node.entry_cdn)}`)
  }
  if (node.entry_direct) {
    commandParts.push(` --tls-domain-alt ${quoteShell(node.entry_direct)}`)
  }
  if (node.github_mirror) {
    commandParts.push(` --github-mirror ${quoteShell(node.github_mirror)}`)
  }
  if (node.cf_api_token) {
    commandParts.push(` --cf-api-token ${quoteShell(node.cf_api_token)}`)
  }

  return ok({ command: commandParts.join('') })
}
