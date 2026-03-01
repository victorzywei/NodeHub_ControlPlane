function text(value) {
  return String(value ?? '').trim()
}

function num(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function randomHex(bytes) {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return Array.from(array, (value) => value.toString(16).padStart(2, '0')).join('')
}

function randomUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const hex = randomHex(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
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

function normalizeEngine(value) {
  const engine = text(value)
  return engine === 'xray' ? 'xray' : 'sing-box'
}

function requireField(name, value) {
  if (text(value)) return text(value)
  throw new Error(`missing required field: ${name}`)
}

function resolveRequiredValue(settings, keys, generator) {
  for (const key of keys) {
    const value = text(settings[key])
    if (value) return value
  }
  const generated = generator()
  settings[keys[0]] = generated
  return generated
}

function toUser(template, settings) {
  const protocol = text(template.protocol).toLowerCase()
  if (protocol === 'vless' || protocol === 'vmess') {
    return {
      uuid: resolveRequiredValue(settings, ['uuid', 'user_id', 'id'], randomUuid),
      flow: text(settings.flow) || undefined,
      alter_id: Math.max(0, Math.floor(num(settings.alter_id, 0))),
    }
  }
  if (protocol === 'trojan' || protocol === 'hysteria2') {
    return { password: resolveRequiredValue(settings, ['password'], () => randomHex(16)) }
  }
  if (protocol === 'shadowsocks2022') {
    return {
      method: text(settings.method) || '2022-blake3-aes-128-gcm',
      password: resolveRequiredValue(settings, ['password'], () => randomHex(16)),
    }
  }
  throw new Error(`unsupported protocol: ${template.protocol}`)
}

function applyTlsForSingbox(template, settings) {
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

function applyTransportForSingbox(template, settings) {
  const transport = text(template.transport).toLowerCase()
  if (!transport || transport === 'tcp' || transport === 'udp') return undefined

  if (transport === 'ws') {
    return {
      type: 'ws',
      path: text(settings.path || '/'),
      headers: { Host: text(settings.host) || undefined },
    }
  }

  if (transport === 'grpc') {
    return {
      type: 'grpc',
      service_name: text(settings.service_name || 'grpc'),
    }
  }

  if (transport === 'h2') {
    return {
      type: 'http',
      path: text(settings.path || '/'),
      host: text(settings.host) ? [text(settings.host)] : undefined,
    }
  }

  if (transport === 'httpupgrade') {
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
  const listenPort = Math.max(1, Math.min(65535, Math.floor(num(settings.port, 443))))
  if (!listenPort) throw new Error(`invalid port for template: ${template.name}`)

  if (protocol === 'vless') {
    return {
      type: 'vless',
      tag: `in-${idx + 1}-vless`,
      listen: '::',
      listen_port: listenPort,
      users: [toUser(template, settings)],
      tls: applyTlsForSingbox(template, settings),
      transport: applyTransportForSingbox(template, settings),
    }
  }

  if (protocol === 'trojan') {
    return {
      type: 'trojan',
      tag: `in-${idx + 1}-trojan`,
      listen: '::',
      listen_port: listenPort,
      users: [toUser(template, settings)],
      tls: applyTlsForSingbox(template, settings),
      transport: applyTransportForSingbox(template, settings),
    }
  }

  if (protocol === 'vmess') {
    return {
      type: 'vmess',
      tag: `in-${idx + 1}-vmess`,
      listen: '::',
      listen_port: listenPort,
      users: [toUser(template, settings)],
      tls: applyTlsForSingbox(template, settings),
      transport: applyTransportForSingbox(template, settings),
    }
  }

  if (protocol === 'hysteria2') {
    const inbound = {
      type: 'hysteria2',
      tag: `in-${idx + 1}-hysteria2`,
      listen: '::',
      listen_port: listenPort,
      users: [toUser(template, settings)],
      tls: applyTlsForSingbox(template, settings) || {
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

function buildXrayStreamSettings(template, settings) {
  const transport = text(template.transport).toLowerCase() || 'tcp'
  const tlsMode = text(template.tls_mode).toLowerCase()
  const stream = { network: transport }

  if (transport === 'ws') {
    stream.wsSettings = {
      path: text(settings.path || '/'),
      headers: { Host: text(settings.host || '') },
    }
  } else if (transport === 'grpc') {
    stream.grpcSettings = {
      serviceName: text(settings.service_name || 'grpc'),
    }
  } else if (transport === 'httpupgrade') {
    stream.httpupgradeSettings = {
      host: text(settings.host || ''),
      path: text(settings.path || '/'),
    }
  }

  if (tlsMode === 'tls') {
    stream.security = 'tls'
    stream.tlsSettings = {
      serverName: text(settings.server_name || settings.sni || settings.host || ''),
      certificates: [{
        certificateFile: '__NODEHUB_CERT_CRT__',
        keyFile: '__NODEHUB_CERT_KEY__',
      }],
    }
  } else if (tlsMode === 'reality') {
    const serverName = text(settings.server_name || settings.sni || settings.host || 'www.cloudflare.com')
    const shortId = text(settings.reality_short_id || settings.short_id)
    stream.security = 'reality'
    stream.realitySettings = {
      show: false,
      dest: `${serverName}:443`,
      xver: 0,
      serverNames: [serverName],
      privateKey: requireField('reality_private_key', settings.reality_private_key || settings.private_key),
      shortIds: shortId ? [shortId] : [],
    }
  }

  return stream
}

function buildXrayInbound(template, params, idx) {
  const settings = { ...(template.defaults || {}), ...(params || {}) }
  const protocol = text(template.protocol).toLowerCase()
  const listenPort = Math.max(1, Math.min(65535, Math.floor(num(settings.port, 443))))
  const streamSettings = buildXrayStreamSettings(template, settings)

  if (protocol === 'vless') {
    const user = toUser(template, settings)
    return {
      tag: `in-${idx + 1}-vless`,
      listen: '::',
      port: listenPort,
      protocol: 'vless',
      settings: {
        decryption: 'none',
        clients: [{
          id: user.uuid,
          flow: user.flow,
        }],
      },
      streamSettings,
    }
  }

  if (protocol === 'trojan') {
    const user = toUser(template, settings)
    return {
      tag: `in-${idx + 1}-trojan`,
      listen: '::',
      port: listenPort,
      protocol: 'trojan',
      settings: {
        clients: [{ password: user.password }],
      },
      streamSettings,
    }
  }

  if (protocol === 'vmess') {
    const user = toUser(template, settings)
    return {
      tag: `in-${idx + 1}-vmess`,
      listen: '::',
      port: listenPort,
      protocol: 'vmess',
      settings: {
        clients: [{
          id: user.uuid,
          alterId: user.alter_id,
        }],
      },
      streamSettings,
    }
  }

  if (protocol === 'shadowsocks2022') {
    const user = toUser(template, settings)
    return {
      tag: `in-${idx + 1}-ss2022`,
      listen: '::',
      port: listenPort,
      protocol: 'shadowsocks',
      settings: {
        method: user.method,
        password: user.password,
        network: text(template.transport || 'tcp') || 'tcp',
      },
    }
  }

  if (protocol === 'hysteria2') {
    throw new Error('hysteria2 is not supported by xray engine')
  }

  throw new Error(`unsupported template protocol for xray: ${template.protocol}`)
}

function buildXrayConfig(templates, params) {
  const inbounds = templates.map((tpl, idx) => buildXrayInbound(tpl, params, idx))
  return {
    log: {
      loglevel: 'warning',
    },
    inbounds,
    outbounds: [
      {
        tag: 'direct',
        protocol: 'freedom',
      },
    ],
    routing: {
      domainStrategy: 'AsIs',
      rules: [],
    },
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

function buildConfigFile(engine, templates, params) {
  if (engine === 'xray') {
    return {
      path: 'xray.json',
      content: JSON.stringify(buildXrayConfig(templates, params), null, 2) + '\n',
    }
  }
  return {
    path: 'sing-box.json',
    content: JSON.stringify(buildSingboxConfig(templates, params), null, 2) + '\n',
  }
}

export async function buildNodeArtifactBundle({ node, rev, operationId, templates, params, createdAt, engine }) {
  const templateNames = templates.map((item) => item.name)
  const summary = summarizeConfig(templateNames, params)
  const selectedEngine = normalizeEngine(engine || templates[0]?.engine)
  const reloadCmd = 'nodehub-protocol-restart'
  const configFile = buildConfigFile(selectedEngine, templates, params)
  const subscriptionOutbounds = buildSubscriptionOutbounds(templates, params)
  const manifest = buildManifest({
    nodeId: node.id,
    rev,
    engine: selectedEngine,
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
    configFile,
  ]

  const bundle = buildBundleText({ rev, engine: selectedEngine, reloadCmd, files })
  const sha256 = await sha256Hex(bundle)

  return {
    rev,
    engine: selectedEngine,
    reload_cmd: reloadCmd,
    sha256,
    summary,
    template_names: templateNames,
    params,
    subscription_outbounds: subscriptionOutbounds,
    bundle,
  }
}
