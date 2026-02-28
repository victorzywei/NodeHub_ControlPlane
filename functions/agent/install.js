// @ts-nocheck
/* eslint-disable */

/**
 * Cloudflare Pages Function: Agent Installation Script
 * 
 * This function serves the static bash installation script from /public/agent-install.sh
 * The script is now maintained as a separate file to avoid JavaScript escaping issues.
 */

export async function onRequestGet(context) {
  try {
    // Fetch the static bash script from /public/agent-install.sh
    const scriptUrl = new URL('/agent-install.sh', context.request.url);
    const response = await context.env.ASSETS.fetch(scriptUrl);
    
    if (!response.ok) {
      return new Response('Installation script not found', { status: 404 });
    }
    
    const script = await response.text();
    
    return new Response(script, {
      status: 200,
      headers: {
        'Content-Type': 'text/x-shellscript; charset=utf-8',
        'Content-Disposition': 'inline; filename="nodehub-install.sh"',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    console.error('Error serving installation script:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
