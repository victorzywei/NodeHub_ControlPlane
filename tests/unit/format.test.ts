import { describe, expect, it } from 'vitest'
import { formatRelative, parseJsonObject } from '@/utils/format'
import { buildNodeArtifactBundle } from '../../functions/_lib/artifact.js'
import { renderV2ray } from '../../functions/_lib/sub-renderer.js'

function decodeBase64Utf8(value: string): string {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

function parseBundleFiles(bundleText: string): Record<string, string> {
  const files: Record<string, string> = {}
  const lines = String(bundleText || '').split(/\r?\n/)
  for (const line of lines) {
    if (!line.startsWith('file=')) continue
    const entry = line.slice(5)
    const sep = entry.indexOf('|')
    if (sep <= 0) continue
    const path = entry.slice(0, sep)
    const encoded = entry.slice(sep + 1)
    files[path] = decodeBase64Utf8(encoded)
  }
  return files
}

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

    const files = parseBundleFiles(artifact.bundle)
    const config = JSON.parse(files['sing-box.json']) as {
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
})
