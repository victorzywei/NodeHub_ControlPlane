function text(value) {
    return String(value ?? '').trim()
}

function pickFirst(source, keys, fallback = '') {
    const target = source && typeof source === 'object' ? source : {}
    for (const key of keys) {
        const value = text(target[key])
        if (value) return value
    }
    return fallback
}

export function renderV2ray(outbounds) {
    const links = outbounds.map(ob => {
        const s = ob.settings || {}
        const addr = ob.address
        const port = ob.port
        const hasTls = ob.tls_mode !== 'none'
        const protocol = (ob.protocol || 'vless').replace(/2022$/, '')

        if (protocol === 'vless') {
            const params = new URLSearchParams()
            params.set('type', ob.transport === 'mkcp' ? 'kcp' : (ob.transport || 'tcp'))
            params.set('security', ob.tls_mode || 'none')
            params.set('encryption', 'none')

            if (ob.transport === 'ws') {
                params.set('host', s.host || '')
                params.set('path', s.path || '/')
            } else if (ob.transport === 'grpc') {
                params.set('serviceName', s.service_name || 'grpc')
                params.set('mode', s.multi_mode ? 'multi' : 'gun')
            } else if (ob.transport === 'httpupgrade' || ob.transport === 'xhttp') {
                params.set('host', s.host || '')
                params.set('path', s.path || '/')
            } else if (ob.transport === 'mkcp') {
                if (s.seed) params.set('seed', s.seed)
            }

            if (hasTls) {
                params.set('sni', s.sni || s.server_name || s.host || '')
                params.set('fp', s.fingerprint || 'chrome')
            }
            if (ob.tls_mode === 'reality') {
                params.set('pbk', s.public_key || s.reality_public_key || '')
                params.set('sid', s.short_id || s.reality_short_id || '')
                if (s.spider_x) params.set('spx', s.spider_x)
                if (s.flow) params.set('flow', s.flow)
            }
            const uuid = pickFirst(s, ['uuid', 'user_id', 'id'])
            return `vless://${uuid}@${addr}:${port}?${params.toString()}#${encodeURIComponent(ob.name)}`
        }

        if (protocol === 'trojan') {
            const params = new URLSearchParams()
            params.set('type', ob.transport === 'mkcp' ? 'kcp' : (ob.transport || 'tcp'))
            params.set('security', hasTls ? 'tls' : 'none')
            if (ob.transport === 'ws') {
                params.set('host', s.host || '')
                params.set('path', s.path || '/trojan-ws')
            } else if (ob.transport === 'grpc') {
                params.set('serviceName', s.service_name || 'grpc')
            } else if (ob.transport === 'httpupgrade' || ob.transport === 'xhttp') {
                params.set('host', s.host || '')
                params.set('path', s.path || '/')
            } else if (ob.transport === 'mkcp') {
                if (s.seed) params.set('seed', s.seed)
            }
            if (hasTls) {
                params.set('sni', s.sni || s.server_name || s.host || '')
                params.set('fp', s.fingerprint || 'chrome')
            }
            const password = pickFirst(s, ['password'])
            return `trojan://${password}@${addr}:${port}?${params.toString()}#${encodeURIComponent(ob.name)}`
        }

        if (protocol === 'vmess') {
            const vmessConfig = {
                v: '2', ps: ob.name,
                add: addr, port: parseInt(port),
                id: pickFirst(s, ['uuid', 'user_id', 'id']), aid: s.alter_id || 0,
                scy: s.encryption || 'auto',
                net: ob.transport === 'mkcp' ? 'kcp' : (ob.transport || 'ws'),
                type: 'none',
                host: s.host || '', path: s.path || '/',
                tls: hasTls ? 'tls' : '',
                sni: s.sni || s.host || '',
                fp: s.fingerprint || '',
                alpn: Array.isArray(s.alpn) ? s.alpn.join(',') : '',
            }
            if (ob.transport === 'grpc') {
                vmessConfig.path = s.service_name || 'grpc'
                vmessConfig.type = 'gun'
            }
            return `vmess://${btoa(JSON.stringify(vmessConfig))}`
        }

        if (protocol === 'shadowsocks' || ob.protocol === 'shadowsocks2022') {
            const userinfo = btoa(`${pickFirst(s, ['method', 'cipher'])}:${pickFirst(s, ['password'])}`)
            return `ss://${userinfo}@${addr}:${port}#${encodeURIComponent(ob.name)}`
        }

        if (protocol === 'hysteria2') {
            const params = new URLSearchParams()
            if (s.sni) params.set('sni', s.sni)
            if (s.obfs_type || s.obfs && s.obfs !== 'none') {
                params.set('obfs', s.obfs_type || s.obfs)
                params.set('obfs-password', s.obfs_password || '')
            }
            const password = pickFirst(s, ['password'])
            return `hysteria2://${password}@${addr}:${port}?${params.toString()}#${encodeURIComponent(ob.name)}`
        }

        return ''
    }).filter(Boolean)

    return btoa(links.join('\n'))
}

export function renderClash(subName, outbounds) {
    const proxies = outbounds.map(ob => {
        const s = ob.settings || {}
        const base = {
            name: ob.name,
            server: ob.address,
            port: parseInt(ob.port),
        }
        const hasTls = ob.tls_mode !== 'none'
        const protocol = (ob.protocol || 'vless').replace(/2022$/, '')

        if (protocol === 'vless') {
            return {
                ...base, type: 'vless', uuid: pickFirst(s, ['uuid', 'user_id', 'id']),
                tls: hasTls, 'skip-cert-verify': s.allow_insecure || false,
                servername: s.sni || s.server_name || s.host || '',
                network: ob.transport === 'mkcp' ? 'kcp' : (ob.transport || 'ws'),
                flow: s.flow || undefined,
                'client-fingerprint': s.fingerprint || 'chrome',
                'ws-opts': ob.transport === 'ws' ? { path: s.path || '/', headers: { Host: s.host || '' } } : undefined,
                'grpc-opts': ob.transport === 'grpc' ? { 'grpc-service-name': s.service_name || 'grpc' } : undefined,
                'reality-opts': ob.tls_mode === 'reality' ? { 'public-key': s.public_key || s.reality_public_key || '', 'short-id': s.short_id || s.reality_short_id || '' } : undefined,
            }
        }

        if (protocol === 'trojan') {
            return {
                ...base, type: 'trojan', password: pickFirst(s, ['password']),
                sni: s.sni || '', 'skip-cert-verify': s.allow_insecure || false,
                network: ob.transport || 'tcp',
                'client-fingerprint': s.fingerprint || 'chrome',
                'ws-opts': ob.transport === 'ws' ? { path: s.path || '/trojan-ws', headers: { Host: s.host || '' } } : undefined,
                'grpc-opts': ob.transport === 'grpc' ? { 'grpc-service-name': s.service_name || 'grpc' } : undefined,
            }
        }

        if (protocol === 'vmess') {
            return {
                ...base, type: 'vmess', uuid: pickFirst(s, ['uuid', 'user_id', 'id']),
                alterId: s.alter_id || 0, cipher: s.encryption || 'auto',
                tls: hasTls, 'skip-cert-verify': s.allow_insecure || false,
                servername: s.sni || s.server_name || s.host || '',
                network: ob.transport === 'mkcp' ? 'kcp' : (ob.transport || 'ws'),
                'ws-opts': ob.transport === 'ws' ? { path: s.path || '/', headers: { Host: s.host || '' } } : undefined,
                'grpc-opts': ob.transport === 'grpc' ? { 'grpc-service-name': s.service_name || 'grpc' } : undefined,
            }
        }

        if (protocol === 'shadowsocks' || ob.protocol === 'shadowsocks2022') {
            return {
                ...base, type: 'ss',
                cipher: pickFirst(s, ['method', 'cipher']), password: pickFirst(s, ['password']),
            }
        }

        if (protocol === 'hysteria2') {
            return {
                ...base, type: 'hysteria2',
                password: pickFirst(s, ['password']), sni: s.sni || '',
                up: `${s.up_mbps || 100} Mbps`,
                down: `${s.down_mbps || 100} Mbps`,
                obfs: s.obfs_type || s.obfs || undefined,
                'obfs-password': s.obfs_password || undefined,
            }
        }

        return base
    })

    const config = {
        proxies,
        'proxy-groups': [{
            name: 'NodeHub',
            type: 'select',
            proxies: proxies.length > 0 ? proxies.map(p => p.name) : ['DIRECT'],
        }],
        rules: [
            'MATCH,NodeHub'
        ]
    }

    const header = [
        '# NodeHub subscription (clash)',
        `# name=${subName}`,
        ''
    ].join('\n')

    return header + simpleYaml(config)
}

export function renderSingbox(outbounds) {
    const obs = outbounds.map(ob => {
        const s = ob.settings || {}
        const protocol = (ob.protocol || 'vless').replace(/2022$/, '')
        const base = {
            tag: ob.name,
            type: protocol === 'shadowsocks' ? 'shadowsocks' : protocol,
            server: ob.address,
            server_port: parseInt(ob.port),
        }
        const hasTls = ob.tls_mode !== 'none'

        if (protocol === 'vless') {
            base.uuid = pickFirst(s, ['uuid', 'user_id', 'id'])
            base.flow = s.flow || undefined
            if (hasTls) {
                base.tls = {
                    enabled: true,
                    server_name: s.sni || s.server_name || s.host || '',
                    insecure: s.allow_insecure || false,
                }
                if (ob.tls_mode === 'reality') {
                    base.tls.reality = {
                        enabled: true,
                        public_key: s.public_key || s.reality_public_key || '',
                        short_id: s.short_id || s.reality_short_id || '',
                    }
                    base.tls.utls = { enabled: true, fingerprint: s.fingerprint || 'chrome' }
                } else {
                    base.tls.utls = { enabled: true, fingerprint: s.fingerprint || 'chrome' }
                    if (s.alpn) base.tls.alpn = Array.isArray(s.alpn) ? s.alpn : [s.alpn]
                }
            }
            applyTransportSingbox(base, ob, s)
        }

        if (protocol === 'trojan') {
            base.password = pickFirst(s, ['password'])
            if (hasTls) {
                base.tls = {
                    enabled: true,
                    server_name: s.sni || s.server_name || s.host || '',
                    insecure: s.allow_insecure || false,
                    utls: { enabled: true, fingerprint: s.fingerprint || 'chrome' },
                }
                if (s.alpn) base.tls.alpn = Array.isArray(s.alpn) ? s.alpn : [s.alpn]
            }
            applyTransportSingbox(base, ob, s)
        }

        if (protocol === 'vmess') {
            base.uuid = pickFirst(s, ['uuid', 'user_id', 'id'])
            base.alter_id = s.alter_id || 0
            base.security = s.encryption || 'auto'
            if (hasTls) {
                base.tls = {
                    enabled: true,
                    server_name: s.sni || s.server_name || s.host || '',
                    insecure: s.allow_insecure || false,
                }
            }
            applyTransportSingbox(base, ob, s)
        }

        if (protocol === 'shadowsocks' || ob.protocol === 'shadowsocks2022') {
            base.method = pickFirst(s, ['method', 'cipher'])
            base.password = pickFirst(s, ['password'])
        }

        if (protocol === 'hysteria2') {
            base.password = pickFirst(s, ['password'])
            base.up_mbps = s.up_mbps || 100
            base.down_mbps = s.down_mbps || 100
            base.tls = {
                enabled: true,
                server_name: s.sni || '',
                insecure: s.allow_insecure || false,
            }
            if (s.obfs_type || (s.obfs && s.obfs !== 'none')) {
                base.obfs = { type: s.obfs_type || s.obfs, password: s.obfs_password || '' }
            }
        }

        return base
    })

    return JSON.stringify({
        outbounds: [
            { tag: 'NodeHub', type: 'selector', outbounds: obs.length > 0 ? obs.map(o => o.tag) : ['direct'] },
            ...obs,
            { tag: 'direct', type: 'direct' },
        ],
    }, null, 2)
}

function applyTransportSingbox(base, ob, s) {
    if (ob.transport === 'ws') {
        base.transport = {
            type: 'ws',
            path: s.path || '/',
            headers: { Host: s.host || '' },
            max_early_data: s.max_early_data || 0,
            early_data_header_name: s.early_data_header || 'Sec-WebSocket-Protocol',
        }
    } else if (ob.transport === 'grpc') {
        base.transport = { type: 'grpc', service_name: s.service_name || 'grpc' }
    } else if (ob.transport === 'httpupgrade') {
        base.transport = { type: 'httpupgrade', host: s.host || '', path: s.path || '/' }
    } else if (ob.transport === 'xhttp') {
        base.transport = { type: 'xhttp', host: s.host || '', path: s.path || '/' }
    }
}

function simpleYaml(obj, indent = 0) {
    let result = ''
    const pad = '  '.repeat(indent)
    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined) continue
        if (Array.isArray(value)) {
            result += `${pad}${key}:\n`
            if (value.length === 0) {
                result += `${pad}  []\n`
            } else {
                for (const item of value) {
                    if (typeof item === 'object') {
                        result += `${pad}- `
                        const lines = simpleYaml(item, 0).trim().split('\n')
                        result += lines[0] + '\n'
                        for (let i = 1; i < lines.length; i++) {
                            result += `${pad}  ${lines[i]}\n`
                        }
                    } else {
                        result += `${pad}- ${item}\n`
                    }
                }
            }
        } else if (typeof value === 'object') {
            result += `${pad}${key}:\n${simpleYaml(value, indent + 1)}`
        } else {
            result += `${pad}${key}: ${value}\n`
        }
    }
    return result
}
