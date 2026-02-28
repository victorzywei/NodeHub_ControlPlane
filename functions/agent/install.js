// @ts-nocheck
/* eslint-disable */

/**
 * Cloudflare Pages Function: Agent Installation Script
 * 
 * Serves the bash installation script from /agent-install.sh (static file)
 * This keeps the bash script separate and maintainable.
 * 
 * Updated: 2026-03-01
 */

export async function onRequestGet(context) {
  try {
    // Construct URL to the static bash script
    const origin = new URL(context.request.url).origin;
    const scriptUrl = `${origin}/agent-install.sh`;
    
    // Fetch the static file
    const response = await fetch(scriptUrl);
    
    if (!response.ok) {
      return new Response('Installation script not found', { status: 404 });
    }
    
    const script = await response.text();
    
    // Return with proper headers for bash script
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
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
}
