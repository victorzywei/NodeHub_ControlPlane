import { KEY, kvGetJson, hydrateByIndex } from '../_lib/kv.js'

function text(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export async function onRequestGet({ env, params }) {
  const kv = env.NODEHUB_KV
  const sub = await kvGetJson(kv, KEY.subscription(params.token), null)
  if (!sub || !sub.enabled) return text('# subscription disabled', 404)

  const nodes = await hydrateByIndex(kv, KEY.idxNodes, KEY.node)
  const visibleSet = new Set(sub.visible_node_ids || [])
  const filtered = nodes.filter((node) => visibleSet.size === 0 || visibleSet.has(node.id))

  const lines = [
    '# NodeHub subscription',
    `# name=${sub.name}`,
    `# updated_at=${sub.updated_at}`,
    ...filtered.map((node) => `node://${node.id}@${node.entry_direct || node.entry_cdn || node.entry_ip || 'unknown'}#${encodeURIComponent(node.name)}`),
  ]

  return text(lines.join('\n'))
}
