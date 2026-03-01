function text(value) {
  return String(value ?? '').trim()
}

function num(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function base64EncodeUtf8(input) {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function summarizeParams(params) {
  const entries = Object.entries(params || {})
  if (entries.length === 0) return ''
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ')
}

export function summarizeConfig(templateNames, params) {
  const templateText = templateNames.length > 0 ? templateNames.join(' / ') : 'no-template'
  const paramsText = summarizeParams(params)
  return paramsText ? `${templateText} | ${paramsText}` : templateText
}

function requireField(name, value) {
  if (text(value)) return text(value)
  throw new Error(`missing required field: ${name}`)
}

function toUser(template, settings) {
  const protocol = text(template.protocol).toLowerCase()
  if (protocol === 'vless' || protocol === 'vmess') {
    return { uuid: requireField('uuid', settings.uuid || settings.user_id || settings.id), flow: text(settings.flow) || undefined }
  }
  if (protocol === 'trojan' || protocol === 'hysteria2') {
    return { password: requireField('password', settings.password) }
  }
  if (protocol === 'shadowsocks2022') {
    return {
      method: requireField('method', settings.method),
      password: requireField('password', settings.password),
    }
  }
  throw new Error(`unsupported protocol: ${template.protocol}`)
}

function applyTls(template, settings) {
  const tlsMode = text(template.tls_mode).toLowerCase()
  if (!tlsMode || tlsMode === 'none') return undefined

  if (tlsMode === 'reality') {
    const serverName = text(settings.server_name || settings.sni || settings.host || 'www.cloudflare.com')
    const shortId = text(settings.reality_short_id || settings.short_id)
    return {
      enabled: true,
      server_name: serverName,
      reality: {
        enabled: true,
        private_key: requireField('reality_private_key', settings.reality_private_key || settings.private_key),
        short_id: shortId ? [shortId] : [],
      },
    }
  }

  return {
    enabled: true,
    certificate_path: '__NODEHUB_CERT_CRT__',
    key_path: '__NODEHUB_CERT_KEY__',
    server_name: text(settings.server_name || settings.sni || settings.host || ''),
    alpn: settings.alpn ? (Array.isArray(settings.alpn) ? settings.alpn : [settings.alpn]) : undefined,
  }
}

function applyTransport(template, settings) {
  const t = text(template.transport).toLowerCase()
  if (!t || t === 'tcp' || t === 'udp') return undefined
  if (t === 'ws') {
    return {
      type: 'ws',
      path: text(settings.path || '/'),
      headers: { Host: text(settings.host) || undefined },
    }
  }
  if (t === 'grpc') {
    return {
      type: 'grpc',
      service_name: text(settings.service_name || 'grpc'),
    }
  }
  if (t === 'h2') {
    return {
      type: 'http',
      path: text(settings.path || '/'),
      host: text(settings.host) ? [text(settings.host)] : undefined,
    }
  }
  if (t === 'httpupgrade') {
    return {
      type: 'httpupgrade',
      path: text(settings.path || '/'),
      host: text(settings.host),
    }
  }
  return undefined
}

function buildSingboxInbound(template, params, idx) {
  const settings = { ...(template.defaults || {}), ...(params || {}) }
  const protocol = text(template.protocol).toLowerCase()
  const listenPort = Math.max(1, Math.min(65535, Math.floor(num(settings.port, 0))))
  if (!listenPort) throw new Error(`invalid port for template: ${template.name}`)

  if (protocol === 'vless') {
    return {
      type: 'vless',
      tag: `in-${idx + 1}-vless`,
      listen: '::',
      listen_port: listenPort,
      users: [toUser(template, settings)],
      tls: applyTls(template, settings),
      transport: applyTransport(template, settings),
    }
  }

  if (protocol === 'trojan') {
    return {
      type: 'trojan',
      tag: `in-${idx + 1}-trojan`,
      listen: '::',
      listen_port: listenPort,
      users: [toUser(template, settings)],
      tls: applyTls(template, settings),
      transport: applyTransport(template, settings),
    }
  }

  if (protocol === 'hysteria2') {
    const inbound = {
      type: 'hysteria2',
      tag: `in-${idx + 1}-hysteria2`,
      listen: '::',
      listen_port: listenPort,
      users: [toUser(template, settings)],
      tls: applyTls(template, settings) || {
        enabled: true,
        certificate_path: '__NODEHUB_CERT_CRT__',
        key_path: '__NODEHUB_CERT_KEY__',
      },
      up_mbps: num(settings.up_mbps, 100),
      down_mbps: num(settings.down_mbps, 100),
    }
    const obfs = text(settings.obfs || settings.obfs_type)
    if (obfs && obfs !== 'none') {
      inbound.obfs = {
        type: obfs,
        password: text(settings.obfs_password || ''),
      }
    }
    return inbound
  }

  if (protocol === 'shadowsocks2022') {
    const user = toUser(template, settings)
    return {
      type: 'shadowsocks',
      tag: `in-${idx + 1}-ss2022`,
      listen: '::',
      listen_port: listenPort,
      method: user.method,
      password: user.password,
      network: text(template.transport || 'tcp') || 'tcp',
    }
  }

  throw new Error(`unsupported template protocol for sing-box: ${template.protocol}`)
}

function buildSingboxConfig(templates, params) {
  const inbounds = templates.map((tpl, idx) => buildSingboxInbound(tpl, params, idx))
  return {
    log: {
      level: 'info',
      timestamp: true,
    },
    inbounds,
    outbounds: [{ type: 'direct', tag: 'direct' }],
    route: { final: 'direct' },
  }
}

function buildSubscriptionOutbounds(templates, params) {
  return templates.map((tpl) => {
    const settings = { ...(tpl.defaults || {}), ...(params || {}) }
    const listenPort = Math.max(1, Math.min(65535, Math.floor(num(settings.port, 443))))
    return {
      protocol: text(tpl.protocol),
      transport: text(tpl.transport),
      tls_mode: text(tpl.tls_mode),
      port: listenPort,
      settings,
    }
  })
}

function buildManifest({ nodeId, rev, engine, operationId, templateNames, params, summary, subscriptionOutbounds, createdAt }) {
  return {
    schema: 'nodehub-artifact-v1',
    node_id: nodeId,
    rev,
    engine,
    operation_id: operationId,
    template_names: templateNames,
    params,
    summary,
    subscription_outbounds: subscriptionOutbounds,
    created_at: createdAt,
  }
}

function toManifestEnv(manifest) {
  return [
    `SCHEMA=${manifest.schema}`,
    `NODE_ID=${manifest.node_id}`,
    `REV=${manifest.rev}`,
    `ENGINE=${manifest.engine}`,
    `OPERATION_ID=${manifest.operation_id}`,
    `SUMMARY=${(manifest.summary || '').replace(/\r?\n/g, ' ')}`,
    `CREATED_AT=${manifest.created_at}`,
  ].join('\n') + '\n'
}

function buildBundleText({ rev, engine, reloadCmd, files }) {
  const lines = ['NODEHUB-BUNDLE-V1', `rev=${rev}`, `engine=${engine}`, `reload_cmd=${reloadCmd}`]
  for (const file of files) {
    lines.push(`file=${file.path}|${base64EncodeUtf8(file.content)}`)
  }
  return lines.join('\n') + '\n'
}

export async function buildNodeArtifactBundle({ node, rev, operationId, templates, params, createdAt }) {
  const templateNames = templates.map((item) => item.name)
  const summary = summarizeConfig(templateNames, params)
  const engine = 'sing-box'
  const reloadCmd = 'nodehub-protocol-restart'
  const singboxConfig = buildSingboxConfig(templates, params)
  const subscriptionOutbounds = buildSubscriptionOutbounds(templates, params)
  const manifest = buildManifest({
    nodeId: node.id,
    rev,
    engine,
    operationId,
    templateNames,
    params,
    summary,
    subscriptionOutbounds,
    createdAt,
  })

  const files = [
    { path: 'manifest.json', content: JSON.stringify(manifest, null, 2) + '\n' },
    { path: 'manifest.env', content: toManifestEnv(manifest) },
    { path: 'sing-box.json', content: JSON.stringify(singboxConfig, null, 2) + '\n' },
  ]

  const bundle = buildBundleText({ rev, engine, reloadCmd, files })
  const sha256 = await sha256Hex(bundle)

  return {
    rev,
    engine,
    reload_cmd: reloadCmd,
    sha256,
    summary,
    template_names: templateNames,
    params,
    subscription_outbounds: subscriptionOutbounds,
    bundle,
  }
}

