import { KEY, kvGetJson, hydrateByIndex } from '../_lib/kv.js'
import { renderV2ray, renderClash, renderSingbox } from '../_lib/sub-renderer.js'

function text(content, status = 200, extraHeaders = {}) {
  return new Response(content, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  })
}

function yaml(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      'Content-Type': 'text/yaml; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="nodehub-clash.yaml"',
    },
  })
}

function json(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="nodehub-singbox.json"',
    },
  })
}

function toNodeOutboundName(node, outbound, index, templateNames) {
  const nodeName = String(node?.name || node?.id || 'node').trim()
  const templateName = String(outbound?.template_name || templateNames[index] || outbound?.protocol || '').trim()
  return templateName ? `${nodeName}-${templateName}` : nodeName
}

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url)
  const format = String(url.searchParams.get('format') || 'v2ray').toLowerCase()

  const kv = env.NODEHUB_KV
  const sub = await kvGetJson(kv, KEY.subscription(params.token), null)
  if (!sub || !sub.enabled) return text('# subscription disabled or not found', 404)

  const nodes = await hydrateByIndex(kv, KEY.idxNodes, KEY.node)
  const visibleSet = new Set(sub.visible_node_ids || [])
  const filtered = nodes.filter((node) => visibleSet.size === 0 || visibleSet.has(node.id))

  const outbounds = []
  for (const node of filtered) {
    const artifact =
      node.target_artifact && typeof node.target_artifact === 'object' && !Array.isArray(node.target_artifact)
        ? node.target_artifact
        : null
    if (!artifact || !Array.isArray(artifact.subscription_outbounds)) continue

    const templateNames = Array.isArray(artifact.template_names)
      ? artifact.template_names.map((item) => String(item || ''))
      : []

    for (let index = 0; index < artifact.subscription_outbounds.length; index += 1) {
      const t = artifact.subscription_outbounds[index]
      const s = t.settings || {}
      const addr = String(node.entry_direct || node.entry_cdn || node.entry_ip || 'unknown').trim()

      outbounds.push({
        name: toNodeOutboundName(node, t, index, templateNames),
        node,
        protocol: t.protocol,
        transport: t.transport,
        tls_mode: t.tls_mode,
        port: Number(t.port || s.port || 443),
        address: addr,
        settings: s,
      })
    }
  }

  if (format === 'clash') {
    return yaml(renderClash(sub.name, outbounds))
  }

  if (format === 'singbox') {
    return json(renderSingbox(outbounds))
  }

  return text(renderV2ray(outbounds), 200, {
    'Content-Disposition': 'attachment; filename="nodehub-v2ray.txt"'
  })
}
