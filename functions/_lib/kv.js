const KEY = {
  idxNodes: 'idx:nodes',
  idxTemplates: 'idx:templates',
  idxSubscriptions: 'idx:subscriptions',
  idxReleases: 'idx:releases',
  node: (id) => `node:${id}`,
  template: (id) => `template:${id}`,
  templateOverride: (id) => `template_override:${id}`,
  subscription: (token) => `subscription:${token}`,
  release: (id) => `release:${id}`,
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

export async function readIndex(kv, key) {
  return (await kvGetJson(kv, key, [])) || []
}

export async function writeIndex(kv, key, rows) {
  await kvPutJson(kv, key, rows)
}

export async function indexUpsert(kv, key, row) {
  const rows = await readIndex(kv, key)
  const next = rows.filter((item) => item.id !== row.id)
  next.push(row)
  await writeIndex(kv, key, next)
}

export async function indexRemove(kv, key, id) {
  const rows = await readIndex(kv, key)
  const next = rows.filter((item) => item.id !== id)
  await writeIndex(kv, key, next)
}

export async function hydrateByIndex(kv, indexKey, keyFactory) {
  const indexRows = await readIndex(kv, indexKey)
  const docs = await Promise.all(indexRows.map((row) => kvGetJson(kv, keyFactory(row.id))))
  return docs.filter(Boolean)
}
