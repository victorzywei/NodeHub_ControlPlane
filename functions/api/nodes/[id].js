import { requireAdmin } from '../../_lib/auth.js'
import { KEY, indexRemove, indexUpsert, kvDelete, kvGetJson, kvPutJson, readIndex } from '../../_lib/kv.js'
import { normalizeNode } from '../../_lib/node.js'
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
  const node = await kvGetJson(kv, KEY.node(params.id))
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)
  return ok(normalizeNode(node))
}

export async function onRequestPatch({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const node = await kvGetJson(kv, KEY.node(params.id))
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
  await kvPutJson(kv, KEY.node(node.id), node)
  await indexUpsert(kv, KEY.idxNodes, { id: node.id, name: node.name, updated_at: node.updated_at })

  return ok(normalizeNode(node))
}

export async function onRequestDelete({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const releaseIndex = await readIndex(kv, KEY.idxNodeReleases(params.id))
  for (const row of releaseIndex) {
    const rev = Number(row?.rev || row?.id || 0) || 0
    if (rev > 0) await kvDelete(kv, KEY.release(params.id, rev))
  }
  await kvDelete(kv, KEY.idxNodeReleases(params.id))
  await kvDelete(kv, KEY.node(params.id))
  await indexRemove(kv, KEY.idxNodes, params.id)
  return ok({ deleted: params.id })
}
