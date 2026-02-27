import { requireAdmin } from '../../_lib/auth.js'
import { ONLINE_WINDOW_MS } from '../../_lib/constants.js'
import { KEY, createId, createToken, hydrateByIndex, indexUpsert, kvPutJson } from '../../_lib/kv.js'
import { ok, fail } from '../../_lib/response.js'

function normalizeNode(node) {
  const lastSeen = node.last_seen_at ? new Date(node.last_seen_at).getTime() : 0
  const online = Date.now() - lastSeen <= ONLINE_WINDOW_MS
  return {
    ...node,
    online,
  }
}

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  if (!kv) return fail('CONFIG_ERROR', 'NODEHUB_KV is missing', 500)

  const nodes = await hydrateByIndex(kv, KEY.idxNodes, KEY.node)
  nodes.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  return ok(nodes.map(normalizeNode))
}

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  if (!kv) return fail('CONFIG_ERROR', 'NODEHUB_KV is missing', 500)

  const body = await request.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  const nodeType = String(body.node_type || '').trim()

  if (!name) return fail('VALIDATION', 'name is required', 400)
  if (!['vps', 'edge'].includes(nodeType)) {
    return fail('VALIDATION', 'node_type must be vps or edge', 400)
  }

  const id = createId('node')
  const now = new Date().toISOString()
  const node = {
    id,
    name,
    node_type: nodeType,
    region: String(body.region || ''),
    tags: Array.isArray(body.tags) ? body.tags.map((item) => String(item)) : [],
    entry_cdn: String(body.entry_cdn || ''),
    entry_direct: String(body.entry_direct || ''),
    entry_ip: String(body.entry_ip || ''),
    token: createToken(),
    desired_version: 0,
    applied_version: 0,
    last_seen_at: null,
    last_release_status: 'idle',
    last_release_message: '',
    created_at: now,
    updated_at: now,
  }

  await kvPutJson(kv, KEY.node(id), node)
  await indexUpsert(kv, KEY.idxNodes, { id, name: node.name, updated_at: now })

  return ok(normalizeNode(node), { status: 201 })
}
