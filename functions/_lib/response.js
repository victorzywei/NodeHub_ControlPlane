function meta() {
  return {
    at: new Date().toISOString(),
    request_id: crypto.randomUUID(),
  }
}

export function ok(data, init = {}) {
  const status = init.status ?? 200
  return new Response(
    JSON.stringify({
      success: true,
      data,
      meta: meta(),
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...init.headers,
      },
    },
  )
}

export function fail(code, message, status = 400, init = {}) {
  return new Response(
    JSON.stringify({
      success: false,
      error: { code, message },
      meta: meta(),
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...init.headers,
      },
    },
  )
}
