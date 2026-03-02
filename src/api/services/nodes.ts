import { request } from '@/api/request'
import type { NodeConfigDetail, NodePublishPreview, NodeRecord } from '@/types/domain'

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

export function publishNodeTemplates(id: string, appliedTemplateIds: string[]): Promise<NodeRecord> {
  return request(`/api/nodes/${id}/publish`, { method: 'POST', body: { applied_template_ids: appliedTemplateIds } })
}

export function previewNodePublish(id: string, appliedTemplateIds: string[]): Promise<NodePublishPreview> {
  return request(`/api/nodes/${id}/publish-preview`, { method: 'POST', body: { applied_template_ids: appliedTemplateIds } })
}

export function deleteNode(id: string): Promise<{ deleted: string }> {
  return request(`/api/nodes/${id}`, { method: 'DELETE' })
}

export function nodeInstallCommand(id: string): Promise<{ command: string }> {
  return request(`/api/nodes/${id}/install`)
}

export function getNodeConfig(id: string): Promise<NodeConfigDetail> {
  return request(`/api/nodes/${id}/config`)
}
