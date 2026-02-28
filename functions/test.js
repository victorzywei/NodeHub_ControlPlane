// Simple test function to verify Cloudflare Pages Functions are working

export async function onRequestGet() {
  return new Response('✅ Cloudflare Pages Functions are working!', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
