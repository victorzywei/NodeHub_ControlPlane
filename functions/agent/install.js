export async function onRequestGet({ request }) {
  try {
    const scriptUrl = new URL('/agent-install.sh', request.url).toString()
    const response = await fetch(scriptUrl)

    if (!response.ok) {
      return new Response('Installation script not found', { status: 404 })
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/x-shellscript; charset=utf-8',
        'Content-Disposition': 'inline; filename="nodehub-install.sh"',
        'Cache-Control': 'public, max-age=300',
      },
    })
  } catch {
    return new Response('Failed to load installation script', { status: 500 })
  }
}
