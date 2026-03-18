const KEY = {
  node: (id) => `node:${id}`,
  nodeCfg: (id) => `node_cfg:${id}`,
  nodeRuntime: (id) => `node_runtime:${id}`,
  nodeDesired: (id) => `node_desired:${id}`,
  nodeCurrent: (id) => `node_current:${id}`,
  template: (id) => `template:${id}`,
  templateOverride: (id) => `template_override:${id}`,
  subscription: (token) => `subscription:${token}`,
  artifact: (id) => `artifact:${id}`,
  release: (nodeId, rev) => `release:${nodeId}:r${Math.max(0, Math.floor(Number(rev) || 0))}`,
}

export { KEY }

export function createId(prefix) {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return `${prefix}_${rand}`
}

export function createToken() {
  return crypto.randomUUID().replace(/-/g, '')
}

export async function kvGetJson(kv, key, fallback = null) {
  const value = await kv.get(key, 'json')
  return value ?? fallback
}

export async function kvPutJson(kv, key, value) {
  await kv.put(key, JSON.stringify(value))
}

export async function kvDelete(kv, key) {
  await kv.delete(key)
}

export async function listKeysByPrefix(kv, prefix) {
  const names = []
  let cursor = undefined

  do {
    const page = await kv.list({ prefix, cursor })
    for (const row of page.keys || []) {
      const name = String(row?.name || '')
      if (name) names.push(name)
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)

  return names
}

export async function listJsonByPrefix(kv, prefix) {
  const keys = await listKeysByPrefix(kv, prefix)
  const rows = await Promise.all(keys.map((key) => kvGetJson(kv, key, null)))
  return rows.filter(Boolean)
}
