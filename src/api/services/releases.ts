import { request } from '@/api/request'
import type { ReleaseRecord } from '@/types/domain'

export interface CreateReleasePayload {
  node_ids: string[]
  template_ids: string[]
  params: Record<string, unknown>
}

export function listReleases(): Promise<ReleaseRecord[]> {
  return request('/api/releases')
}

export function createRelease(payload: CreateReleasePayload): Promise<ReleaseRecord> {
  return request('/api/releases', { method: 'POST', body: payload })
}
