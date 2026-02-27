const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Key,X-Node-Token',
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const response = await context.next()
  const headers = new Headers(response.headers)
  Object.entries(CORS_HEADERS).forEach(([key, value]) => headers.set(key, value))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
