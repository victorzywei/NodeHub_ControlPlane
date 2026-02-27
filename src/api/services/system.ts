import { request } from '@/api/request'
import type { SystemStatus } from '@/types/domain'

export function getSystemStatus(): Promise<SystemStatus> {
  return request('/api/system/status')
}
