import { requireAdmin } from '../../_lib/auth.js'
import { KEY, kvDelete, listKeysByPrefix } from '../../_lib/kv.js'
import { normalizeNode } from '../../_lib/node.js'
import { deleteNodeRecord, loadNodeRecord, saveNodeCfg } from '../../_lib/node-store.js'
import { ok, fail } from '../../_lib/response.js'

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
  return ok(normalizeNode(node))
}

export async function onRequestPatch({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const node = await loadNodeRecord(kv, params.id)
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)

  const body = await request.json().catch(() => ({}))
  const stringFields = ['name', 'region', 'primary_domain', 'backup_domain', 'entry_ip', 'github_mirror', 'cf_api_token',
    'warp_license', 'argo_token', 'argo_domain']

  stringFields.forEach((field) => {
    if (body[field] !== undefined) {
      node[field] = String(body[field])
    }
  })

  if (body.install_warp !== undefined) {
    node.install_warp = body.install_warp === true
  }

  if (body.install_cert !== undefined) {
    node.install_cert = body.install_cert === true
  }

  if (body.install_argo !== undefined) {
    node.install_argo = body.install_argo === true
  }

  if (body.argo_port !== undefined) {
    node.argo_port = toPort(body.argo_port, 2053)
  }

  if (body.tags !== undefined) {
    node.tags = Array.isArray(body.tags) ? body.tags.map((item) => String(item)) : []
  }

  // Ensure legacy fields are removed from stored node records.
  delete node.entry_cdn
  delete node.entry_direct

  const nowIso = new Date().toISOString()
  node.updated_at = nowIso
  await saveNodeCfg(kv, node)

  return ok(normalizeNode(node))
}

export async function onRequestDelete({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const releaseKeys = await listKeysByPrefix(kv, `release:${params.id}:r`)
  await Promise.all([
    ...releaseKeys.map((key) => kvDelete(kv, key)),
    deleteNodeRecord(kv, params.id),
  ])
  return ok({ deleted: params.id })
}
