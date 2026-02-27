export function formatDateTime(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function formatRelative(value: string | null): string {
  if (!value) return '从未'
  const deltaSec = Math.floor((Date.now() - new Date(value).getTime()) / 1000)
  if (deltaSec < 60) return `${deltaSec} 秒前`
  const deltaMin = Math.floor(deltaSec / 60)
  if (deltaMin < 60) return `${deltaMin} 分钟前`
  const deltaHour = Math.floor(deltaMin / 60)
  if (deltaHour < 24) return `${deltaHour} 小时前`
  return `${Math.floor(deltaHour / 24)} 天前`
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function parseJsonObject(text: string): Record<string, unknown> {
  if (!text.trim()) return {}
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON 必须是对象')
  }
  return parsed as Record<string, unknown>
}
