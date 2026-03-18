import { KEY, kvGetJson, kvPutJson } from './kv.js'

const RELEASE_STATUS_SET = new Set(['pending', 'applied', 'healthy', 'failed'])

function text(value) {
  return String(value || '').trim()
}

function toVersion(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.floor(num)
}

function normalizeStatus(value, fallback = 'pending') {
  const status = text(value).toLowerCase()
  if (RELEASE_STATUS_SET.has(status)) return status
  return fallback
}

export function normalizeReleaseRecord(input, fallback = {}) {
  const nodeId = text(input?.node_id || fallback.node_id)
  const rev = toVersion(input?.rev ?? fallback.rev)
  return {
    id: text(input?.id || fallback.id || `${nodeId}:r${rev}`),
    node_id: nodeId,
    rev,
    artifact_id: text(input?.artifact_id || fallback.artifact_id),
    artifact_sha256: text(input?.artifact_sha256 || fallback.artifact_sha256),
    status: normalizeStatus(input?.status ?? fallback.status),
    summary: text(input?.summary || fallback.summary),
    template_names: Array.isArray(input?.template_names)
      ? input.template_names.map((item) => String(item || ''))
      : Array.isArray(fallback.template_names)
        ? fallback.template_names.map((item) => String(item || ''))
        : [],
    error_code: text(input?.error_code || fallback.error_code),
    message: text(input?.message || fallback.message),
    desired_at: text(input?.desired_at || fallback.desired_at),
    applied_at: text(input?.applied_at || fallback.applied_at),
    healthy_at: text(input?.healthy_at || fallback.healthy_at),
    failed_at: text(input?.failed_at || fallback.failed_at),
    updated_at: text(input?.updated_at || fallback.updated_at),
  }
}

export function releaseStatusCode(status) {
  const normalized = normalizeStatus(status, 'pending')
  if (normalized === 'healthy') return 3
  if (normalized === 'failed') return 4
  if (normalized === 'applied') return 2
  return 1
}

export function canAdvanceStatus(currentStatus, nextStatus) {
  const current = normalizeStatus(currentStatus, 'pending')
  const next = normalizeStatus(nextStatus, 'pending')
  if (current === next) return true
  if (next === 'failed') return true
  if (current === 'failed') return true
  if (current === 'pending') return next === 'applied' || next === 'healthy'
  if (current === 'applied') return next === 'healthy'
  return false
}

export async function getRelease(kv, nodeId, rev) {
  const releaseRev = toVersion(rev)
  if (!text(nodeId) || releaseRev <= 0) return null
  return kvGetJson(kv, KEY.release(nodeId, releaseRev), null)
}

export async function putRelease(kv, record) {
  const next = normalizeReleaseRecord(record)
  if (!next.node_id || next.rev <= 0) return null
  await kvPutJson(kv, KEY.release(next.node_id, next.rev), next)
  return next
}
