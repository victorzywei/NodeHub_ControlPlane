import { request } from '@/api/request'
import type { NodeRecord } from '@/types/domain'

export function listNodes(): Promise<NodeRecord[]> {
  return request('/api/nodes')
}

export function getNode(id: string): Promise<NodeRecord> {
  return request(`/api/nodes/${id}`)
}

export function createNode(payload: Partial<NodeRecord> & Pick<NodeRecord, 'name' | 'node_type'>): Promise<NodeRecord> {
  return request('/api/nodes', { method: 'POST', body: payload })
}

export function updateNode(id: string, payload: Partial<NodeRecord>): Promise<NodeRecord> {
  return request(`/api/nodes/${id}`, { method: 'PATCH', body: payload })
}

export function deleteNode(id: string): Promise<{ deleted: string }> {
  return request(`/api/nodes/${id}`, { method: 'DELETE' })
}

export function nodeInstallCommand(id: string): Promise<{ command: string }> {
  return request(`/api/nodes/${id}/install`)
}
