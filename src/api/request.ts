import { useAuthStore } from '@/stores/auth'

interface SuccessEnvelope<T> {
  success: true
  data: T
  meta: {
    at: string
    request_id: string
  }
}

interface ErrorEnvelope {
  success: false
  error: {
    code: string
    message: string
  }
  meta: {
    at: string
    request_id: string
  }
}

export class ApiRequestError extends Error {
  status: number
  code: string
  requestId: string
  retryable: boolean

  constructor(message: string, options: { status?: number; code?: string; requestId?: string; retryable?: boolean } = {}) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = options.status ?? 0
    this.code = options.code ?? 'UNKNOWN'
    this.requestId = options.requestId ?? ''
    this.retryable = options.retryable ?? false
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  timeoutMs?: number
  retries?: number
  headers?: Record<string, string>
  auth?: boolean
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status)
}

async function parseEnvelope<T>(response: Response): Promise<SuccessEnvelope<T> | ErrorEnvelope> {
  const text = await response.text()
  if (!text) {
    throw new ApiRequestError('服务端返回空响应', { status: response.status, code: 'EMPTY_RESPONSE' })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ApiRequestError('服务端返回了无效 JSON', { status: response.status, code: 'BAD_JSON' })
  }

  if (!parsed || typeof parsed !== 'object' || !('success' in parsed)) {
    throw new ApiRequestError('服务端响应结构不正确', { status: response.status, code: 'BAD_SHAPE' })
  }

  return parsed as SuccessEnvelope<T> | ErrorEnvelope
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    timeoutMs = 12000,
    retries = method === 'GET' ? 1 : 0,
    headers = {},
    auth = true,
  } = options

  const authStore = useAuthStore()
  authStore.hydrateFromStorage()

  let attempt = 0

  while (attempt <= retries) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort('timeout'), timeoutMs)

    try {
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...headers,
      }

      if (auth && authStore.adminKey) {
        requestHeaders['X-Admin-Key'] = authStore.adminKey
      }

      const response = await fetch(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: requestHeaders,
        signal: controller.signal,
      })

      const envelope = await parseEnvelope<T>(response)

      if (!response.ok || envelope.success === false) {
        const status = response.status
        const requestId = envelope.meta?.request_id || ''
        const code = envelope.success === false ? envelope.error.code : `HTTP_${status}`
        const message = envelope.success === false ? envelope.error.message : `请求失败 (${status})`
        const retryable = isRetryableStatus(status)
        throw new ApiRequestError(message, { status, code, requestId, retryable })
      }

      return envelope.data
    } catch (error) {
      const normalized =
        error instanceof ApiRequestError
          ? error
          : new ApiRequestError(error instanceof Error ? error.message : '请求失败', {
              code: 'NETWORK_ERROR',
              retryable: true,
            })

      if (attempt < retries && normalized.retryable) {
        await sleep(250 * (attempt + 1))
        attempt += 1
        continue
      }

      throw normalized
    } finally {
      window.clearTimeout(timeout)
    }
  }

  throw new ApiRequestError('请求终止', { code: 'REQUEST_ABORTED' })
}
