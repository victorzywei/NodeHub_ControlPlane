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

function json(content, status = 200) {
  return new Response(JSON.stringify(content, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function escapeYaml(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function resolveEntry(node) {
  return String(node.entry_direct || node.entry_cdn || node.entry_ip || 'unknown').trim()
}

function parseHostPort(entry) {
  let host = entry || 'unknown'
  let port = 443

  if (host.includes('://')) {
    try {
      const parsed = new URL(host)
      host = parsed.hostname || host
      if (parsed.port) {
        const parsedPort = Number(parsed.port)
        if (Number.isFinite(parsedPort) && parsedPort > 0) port = parsedPort
      }
      return { host, port }
    } catch {
      // fallback below
    }
  }

  if (host.startsWith('[')) {
    const closeIndex = host.indexOf(']')
    if (closeIndex > 0) {
      const maybePort = host.slice(closeIndex + 1)
      if (maybePort.startsWith(':')) {
        const parsedPort = Number(maybePort.slice(1))
        if (Number.isFinite(parsedPort) && parsedPort > 0) port = parsedPort
      }
      return { host: host.slice(1, closeIndex), port }
    }
  }

  const match = host.match(/^(.*):(\d+)$/)
  if (match) {
    const parsedPort = Number(match[2])
    if (Number.isFinite(parsedPort) && parsedPort > 0) port = parsedPort
    host = match[1]
  }

  return { host, port }
}

function plainNodeLine(node) {
  return `node://${node.id}@${resolveEntry(node)}#${encodeURIComponent(node.name)}`
}

function toBase64(value) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url)
  const format = String(url.searchParams.get('format') || '').toLowerCase()

  const kv = env.NODEHUB_KV
  const sub = await kvGetJson(kv, KEY.subscription(params.token), null)
  if (!sub || !sub.enabled) return text('# subscription disabled', 404)

  const nodes = await hydrateByIndex(kv, KEY.idxNodes, KEY.node)
  const visibleSet = new Set(sub.visible_node_ids || [])
  const filtered = nodes.filter((node) => visibleSet.size === 0 || visibleSet.has(node.id))
  const plainLines = filtered.map((node) => plainNodeLine(node))

  if (format === 'v2ray') {
    return text(toBase64(plainLines.join('\n')))
  }

  if (format === 'clash') {
    const proxies = filtered.map((node) => {
      const target = parseHostPort(resolveEntry(node))
      return [
        `  - name: "${escapeYaml(node.name)}"`,
        '    type: socks5',
        `    server: "${escapeYaml(target.host)}"`,
        `    port: ${target.port}`,
        '    udp: true',
      ].join('\n')
    })

    const proxyNames = filtered.map((node) => `      - "${escapeYaml(node.name)}"`).join('\n')
    const body = [
      '# NodeHub subscription (clash)',
      `# name=${sub.name}`,
      `# updated_at=${sub.updated_at}`,
      'proxies:',
      ...(proxies.length > 0 ? proxies : ['  []']),
      'proxy-groups:',
      '  - name: "NodeHub"',
      '    type: select',
      '    proxies:',
      ...(proxyNames ? [proxyNames] : ['      - "DIRECT"']),
      'rules:',
      '  - MATCH,NodeHub',
    ].join('\n')
    return text(body)
  }

  if (format === 'singbox') {
    const outbounds = filtered.map((node) => {
      const target = parseHostPort(resolveEntry(node))
      return {
        tag: node.name,
        type: 'socks',
        server: target.host,
        server_port: target.port,
      }
    })

    return json({
      nodehub: {
        token: params.token,
        name: sub.name,
        updated_at: sub.updated_at,
      },
      outbounds,
    })
  }

  const lines = ['# NodeHub subscription', `# name=${sub.name}`, `# updated_at=${sub.updated_at}`, ...plainLines]
  return text(lines.join('\n'))
}
