import { request } from '@/api/request'
import type { SystemStatus, TemplateRefCleanupResult } from '@/types/domain'

export function getSystemStatus(): Promise<SystemStatus> {
  return request('/api/system/status')
}

export function cleanupTemplateRefs(dryRun = true): Promise<TemplateRefCleanupResult> {
  return request('/api/system/cleanup-template-refs', {
    method: 'POST',
    body: { dry_run: dryRun },
  })
}
