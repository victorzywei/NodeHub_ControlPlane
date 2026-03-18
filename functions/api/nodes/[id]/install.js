import { requireAdmin } from '../../../_lib/auth.js'
import { loadNodeRecord } from '../../../_lib/node-store.js'
import { ok, fail } from '../../../_lib/response.js'

function quoteShell(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`
}

function toPort(value, fallback = 2053) {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 1 || num > 65535) return fallback
  return Math.floor(num)
}

export async function onRequestGet({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const node = await loadNodeRecord(kv, params.id)
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
    ` --reconcile-interval ${quoteShell('15')}`,
  ]
  const installWarp = node.install_warp === true
  const installCert = node.install_cert !== undefined ? node.install_cert === true : true
  const installArgo = node.install_argo === true
  const argoPort = toPort(node.argo_port, 2053)

  if (installCert && node.primary_domain) {
    commandParts.push(` --tls-domain ${quoteShell(node.primary_domain)}`)
  }
  if (installCert && node.backup_domain) {
    commandParts.push(` --tls-domain-alt ${quoteShell(node.backup_domain)}`)
  }
  if (node.github_mirror) {
    commandParts.push(` --github-mirror ${quoteShell(node.github_mirror)}`)
  }
  if (installCert && node.cf_api_token) {
    commandParts.push(` --cf-api-token ${quoteShell(node.cf_api_token)}`)
  }
  if (installWarp) {
    commandParts.push(' --install-warp')
    if (node.warp_license) {
      commandParts.push(` --warp-license ${quoteShell(node.warp_license)}`)
    }
  }
  if (installArgo) {
    commandParts.push(' --install-argo')
    commandParts.push(` --argo-port ${quoteShell(argoPort)}`)
    if (node.argo_token) {
      commandParts.push(` --argo-token ${quoteShell(node.argo_token)}`)
    }
    if (node.argo_domain) {
      commandParts.push(` --argo-domain ${quoteShell(node.argo_domain)}`)
    }
  }

  return ok({ command: commandParts.join('') })
}
