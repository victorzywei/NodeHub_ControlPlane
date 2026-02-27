import { request } from '@/api/request'
import type { SubscriptionRecord } from '@/types/domain'

export function listSubscriptions(): Promise<SubscriptionRecord[]> {
  return request('/api/subscriptions')
}

export function createSubscription(payload: Partial<SubscriptionRecord>): Promise<SubscriptionRecord> {
  return request('/api/subscriptions', { method: 'POST', body: payload })
}

export function updateSubscription(token: string, payload: Partial<SubscriptionRecord>): Promise<SubscriptionRecord> {
  return request(`/api/subscriptions/${token}`, { method: 'PATCH', body: payload })
}

export function deleteSubscription(token: string): Promise<{ deleted: string }> {
  return request(`/api/subscriptions/${token}`, { method: 'DELETE' })
}
