import { describe, expect, it } from 'vitest'
import { formatRelative, parseJsonObject } from '@/utils/format'
import { getPresetTemplateParamFields } from '@/utils/templateParams'
import { buildNodeArtifactBundle, buildNodeConfigPreview } from '../../functions/_lib/artifact.js'
import { renderV2ray } from '../../functions/_lib/sub-renderer.js'

describe('format utilities', () => {
  it('parses JSON object', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 })
  })

  it('throws for non-object JSON', () => {
    expect(() => parseJsonObject('[1,2]')).toThrowError()
  })

  it('formats null relative time', () => {
    expect(formatRelative(null)).toBe('从未')
  })

  it('keeps generated vless uuid consistent between config and subscription', async () => {
    const template = {
      id: 'tpl_vless_ws_tls',
      name: 'VLESS + WS + TLS',
      engine: 'sing-box',
      protocol: 'vless',
      transport: 'ws',
      tls_mode: 'tls',
      defaults: {
        port: 2053,
        path: '/ws',
        host: '',
      },
    }

    const artifact = await buildNodeArtifactBundle({
      node: { id: 'node-1' },
      rev: 1,
      operationId: 'op-1',
      templates: [template],
      templateGroups: [{ engine: 'sing-box', templates: [template] }],
      params: {},
      createdAt: '2026-03-02T00:00:00.000Z',
      engine: 'sing-box',
    })

    expect(artifact.subscription_outbounds).toHaveLength(1)
    const outbound = artifact.subscription_outbounds[0]
    const settings = outbound.settings as Record<string, unknown>
    const uuid = String(settings.uuid || '')

    expect(outbound.template_name).toBe('VLESS + WS + TLS')
    expect(uuid).toMatch(/^[0-9a-f-]{36}$/i)

    const config = JSON.parse(String(artifact.files['sing-box.json'] || 'null')) as {
      inbounds?: Array<{
        users?: Array<{
          uuid?: string
        }>
      }>
    }
    expect(config.inbounds?.[0]?.users?.[0]?.uuid).toBe(uuid)
  })

  it('renders vless url from id fallback field', () => {
    const encoded = renderV2ray([
      {
        name: 'node-a-template-b',
        protocol: 'vless',
        transport: 'ws',
        tls_mode: 'tls',
        port: 2053,
        address: 'demo.example',
        settings: {
          id: 'uuid-from-id',
          path: '/ws',
          host: 'demo.example',
        },
      },
    ])

    const decoded = atob(encoded)
    expect(decoded).toContain('vless://uuid-from-id@demo.example:2053')
  })

  it('injects reality handshake for sing-box inbound', async () => {
    const template = {
      id: 'tpl_vless_reality_tcp',
      name: 'VLESS + Reality + TCP',
      engine: 'sing-box',
      protocol: 'vless',
      transport: 'tcp',
      tls_mode: 'reality',
      defaults: {
        port: 49443,
        server_name: 'gateway.icloud.com',
        dest: 'www.hsbc.com.hk:443',
        reality_private_key: 'test-private-key',
        reality_short_id: '60ecf95c05576710',
      },
    }

    const artifact = await buildNodeArtifactBundle({
      node: { id: 'node-2' },
      rev: 2,
      operationId: 'op-2',
      templates: [template],
      templateGroups: [{ engine: 'sing-box', templates: [template] }],
      params: {},
      createdAt: '2026-03-02T00:00:00.000Z',
      engine: 'sing-box',
    })

    const config = JSON.parse(String(artifact.files['sing-box.json'] || 'null')) as {
      inbounds?: Array<{
        tls?: {
          reality?: {
            handshake?: {
              server?: string
              server_port?: number
            }
          }
        }
      }>
    }

    expect(config.inbounds?.[0]?.tls?.reality?.handshake?.server).toBe('gateway.icloud.com')
    expect(config.inbounds?.[0]?.tls?.reality?.handshake?.server_port).toBe(443)
  })

  it('renders sing-box xhttp transport with reality', async () => {
    const template = {
      id: 'tpl_vless_reality_xhttp',
      name: 'VLESS + Reality + XHTTP',
      engine: 'sing-box',
      protocol: 'vless',
      transport: 'xhttp',
      tls_mode: 'reality',
      defaults: {
        port: 49443,
        path: '/',
        host: 'gateway.icloud.com',
        server_name: 'gateway.icloud.com',
        reality_private_key: 'test-private-key',
        reality_short_id: '60ecf95c05576710',
      },
    }

    const artifact = await buildNodeArtifactBundle({
      node: { id: 'node-2' },
      rev: 3,
      operationId: 'op-3',
      templates: [template],
      templateGroups: [{ engine: 'sing-box', templates: [template] }],
      params: {},
      createdAt: '2026-03-02T00:00:00.000Z',
      engine: 'sing-box',
    })

    const config = JSON.parse(String(artifact.files['sing-box.json'] || 'null')) as {
      inbounds?: Array<{
        transport?: {
          type?: string
          path?: string
          host?: string
        }
      }>
    }

    expect(config.inbounds?.[0]?.transport?.type).toBe('xhttp')
    expect(config.inbounds?.[0]?.transport?.path).toBe('/')
    expect(config.inbounds?.[0]?.transport?.host).toBe('gateway.icloud.com')
  })

  it('includes reality public key field in preset params', () => {
    const fields = getPresetTemplateParamFields('vless', 'tcp', 'reality', 'xray')
    const keys = fields.map((item) => item.key)
    expect(keys).toContain('uuid')
    expect(keys).toContain('reality_private_key')
    expect(keys).toContain('reality_public_key')
    expect(keys).toContain('reality_short_id')
    expect(keys).not.toContain('dest')
  })

  it('uses server_name as xray reality dest', async () => {
    const template = {
      id: 'tpl_xray_vless_reality_tcp',
      name: 'Xray VLESS + Reality + TCP',
      engine: 'xray',
      protocol: 'vless',
      transport: 'tcp',
      tls_mode: 'reality',
      defaults: {
        port: 49443,
        server_name: 'gateway.icloud.com',
        dest: 'www.hsbc.com.hk:443',
        reality_private_key: 'test-private-key',
        reality_short_id: '60ecf95c05576710',
      },
    }

    const artifact = await buildNodeArtifactBundle({
      node: { id: 'node-3' },
      rev: 3,
      operationId: 'op-3',
      templates: [template],
      templateGroups: [{ engine: 'xray', templates: [template] }],
      params: {},
      createdAt: '2026-03-02T00:00:00.000Z',
      engine: 'xray',
    })

    const config = JSON.parse(String(artifact.files['xray.json'] || 'null')) as {
      inbounds?: Array<{
        streamSettings?: {
          realitySettings?: {
            dest?: string
            serverNames?: string[]
          }
        }
      }>
    }

    expect(config.inbounds?.[0]?.streamSettings?.realitySettings?.serverNames?.[0]).toBe('gateway.icloud.com')
    expect(config.inbounds?.[0]?.streamSettings?.realitySettings?.dest).toBe('gateway.icloud.com:443')
  })

  it('renders latest official WARP fields for sing-box and xray', () => {
    const warpNode = {
      id: 'node-warp',
      warp_private_key: '6CRVRLgFwGajnikoVOPTDNZnDhx3EydhPsMgpxHfBCY=',
      warp_v6: '2606:4700:110:857a:6a95:fe27:1870:2a9d',
      warp_reserved: [240, 25, 146],
      warp_endpoint: 'engage.cloudflareclient.com:2408',
    }
    const defaults = {
      port: 443,
      uuid: '11111111-1111-4111-8111-111111111111',
      warp_private_key: '6CRVRLgFwGajnikoVOPTDNZnDhx3EydhPsMgpxHfBCY=',
      warp_local_address_ipv4: '172.16.0.2/32',
      warp_local_address_ipv6: '2606:4700:110:857a:6a95:fe27:1870:2a9d/128',
      warp_peer_public_key: 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=',
      warp_server: 'engage.cloudflareclient.com',
      warp_server_port: 2408,
      warp_system_interface: 'false',
      warp_mtu: 1280,
      warp_reserved: '240,25,146',
    }

    const singBoxPreview = buildNodeConfigPreview({
      node: warpNode,
      params: {},
      engine: 'sing-box',
      templates: [{
        id: 'tpl-warp-sing-box',
        name: 'WARP sing-box',
        engine: 'sing-box',
        protocol: 'vless',
        transport: 'tcp',
        tls_mode: 'none',
        defaults,
        warp_exit: true,
        warp_route_mode: 'all',
      }],
    })
    const singBoxConfig = JSON.parse(singBoxPreview.config_text) as {
      route?: {
        rules?: Array<{
          action?: string
          outbound?: string
        }>
      }
    }

    expect(singBoxConfig.route?.rules?.[2]?.action).toBe('route')
    expect(singBoxConfig.route?.rules?.[2]?.outbound).toBe('direct')
    expect(singBoxConfig.route?.rules?.[3]?.action).toBe('route')
    expect(singBoxConfig.route?.rules?.[3]?.outbound).toBe('warp-ep')

    const xrayPreview = buildNodeConfigPreview({
      node: warpNode,
      params: {},
      engine: 'xray',
      templates: [{
        id: 'tpl-warp-xray',
        name: 'WARP xray',
        engine: 'xray',
        protocol: 'vless',
        transport: 'tcp',
        tls_mode: 'none',
        defaults,
        warp_exit: true,
        warp_route_mode: 'all',
      }],
    })
    const xrayConfig = JSON.parse(xrayPreview.config_text) as {
      outbounds?: Array<{
        tag?: string
        settings?: {
          noKernelTun?: boolean
          kernelMode?: boolean
          domainStrategy?: string
          peers?: Array<{
            keepAlive?: number
          }>
        }
      }>
      routing?: {
        rules?: Array<{
          outboundTag?: string
        }>
      }
    }

    const warpOutbound = xrayConfig.outbounds?.find((outbound) => outbound.tag === 'x-warp-out')
    expect(warpOutbound?.settings?.noKernelTun).toBe(true)
    expect(warpOutbound?.settings?.kernelMode).toBeUndefined()
    expect(warpOutbound?.settings?.domainStrategy).toBe('ForceIP')
    expect(warpOutbound?.settings?.peers?.[0]?.keepAlive).toBe(30)
    expect(xrayConfig.routing?.rules?.[0]?.outboundTag).toBe('x-warp-out')
  })

  it('fails preview when WARP private key is missing', () => {
    expect(() => buildNodeConfigPreview({
      node: { id: 'node-missing-warp' },
      params: {},
      engine: 'xray',
      templates: [{
        id: 'tpl-warp-missing-key',
        name: 'WARP missing key',
        engine: 'xray',
        protocol: 'vless',
        transport: 'tcp',
        tls_mode: 'none',
        defaults: {
          port: 443,
          uuid: '11111111-1111-4111-8111-111111111111',
        },
        warp_exit: true,
        warp_route_mode: 'all',
      }],
    })).toThrow('missing required field: warp_private_key')
  })
})
