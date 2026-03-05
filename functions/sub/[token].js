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

function toHost(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      return new URL(raw).hostname || ''
    } catch {
      return ''
    }
  }

  return raw.replace(/\/.*$/, '').trim()
}

function firstHost(candidates) {
  for (const item of candidates) {
    const host = toHost(item)
    if (host) return host
  }
  return ''
}

function resolveSubscriptionAddress(node) {
  // no_public_ip mode should prefer Argo domain
  const argoHost = firstHost([node?.argo_domain, node?.argo_temp_domain])
  const publicHost = firstHost([node?.entry_direct, node?.entry_cdn, node?.entry_ip])

  if (node?.install_argo === true) {
    return argoHost || publicHost || 'unknown'
  }
  return publicHost || argoHost || 'unknown'
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
    const artifactId = String(node.desired_artifact_id || '').trim()
    const artifact = artifactId ? await kvGetJson(kv, KEY.artifact(artifactId), null) : null

    const releaseManifest =
      artifact && artifact.manifest && typeof artifact.manifest === 'object' && !Array.isArray(artifact.manifest)
        ? artifact.manifest
        : null

    const subscriptionOutbounds = Array.isArray(releaseManifest?.subscription_outbounds)
      ? releaseManifest.subscription_outbounds
      : []
    if (subscriptionOutbounds.length === 0) continue

    const templateNames = Array.isArray(releaseManifest?.template_names)
      ? releaseManifest.template_names.map((item) => String(item || ''))
      : []

    for (let index = 0; index < subscriptionOutbounds.length; index += 1) {
      const t = subscriptionOutbounds[index]
      const s = t.settings || {}
      const addr = resolveSubscriptionAddress(node)
      const outboundPort = Number(t.port ?? s.port)
      if (!Number.isFinite(outboundPort) || outboundPort < 1 || outboundPort > 65535) continue

      outbounds.push({
        name: toNodeOutboundName(node, t, index, templateNames),
        node,
        protocol: t.protocol,
        transport: t.transport,
        tls_mode: t.tls_mode,
        port: Math.floor(outboundPort),
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
