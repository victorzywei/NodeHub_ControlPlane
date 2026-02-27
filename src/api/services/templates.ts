import { request } from '@/api/request'
import type { TemplateRecord, TemplateRegistry } from '@/types/domain'

export function listTemplates(): Promise<TemplateRecord[]> {
  return request('/api/templates')
}

export function getTemplate(id: string): Promise<TemplateRecord> {
  return request(`/api/templates/${id}`)
}

export function createTemplate(payload: Partial<TemplateRecord> & Pick<TemplateRecord, 'name' | 'protocol' | 'transport' | 'tls_mode'>): Promise<TemplateRecord> {
  return request('/api/templates', { method: 'POST', body: payload })
}

export function updateTemplate(id: string, payload: Partial<TemplateRecord>): Promise<TemplateRecord> {
  return request(`/api/templates/${id}`, { method: 'PATCH', body: payload })
}

export function deleteTemplate(id: string): Promise<{ deleted: string }> {
  return request(`/api/templates/${id}`, { method: 'DELETE' })
}

export function getTemplateRegistry(): Promise<TemplateRegistry> {
  return request('/api/templates/registry')
}
