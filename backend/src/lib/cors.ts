// lib/cors.ts
//
// Central CORS configuration for all Next.js API routes.
// Every route already calls corsHeaders() in its OPTIONS handler —
// this file is the single place to add/remove allowed origins.

const ALLOWED_ORIGINS = [
  'http://localhost:5173', // Vite dev server (React frontend)
  'http://localhost:3000', // Next.js local (same-origin calls)
]

/**
 * Returns the full set of CORS + preflight headers for a given request origin.
 * If the request origin isn't in the allow-list we return the first allowed
 * origin as a safe fallback — the browser will still block it, but we don't
 * reflect arbitrary origins back.
 */
export function corsHeaders(requestOrigin?: string): HeadersInit {
  const origin =
    requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)
      ? requestOrigin
      : ALLOWED_ORIGINS[0]

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, x-requested-with',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400', // cache preflight for 24 h
    Vary: 'Origin',
  }
}

/**
 * Wraps a JSON response with the correct CORS headers.
 * Pass the incoming Request object (or its origin string) so the header
 * reflects the caller's actual origin.
 */
export function jsonResponse(
  body: unknown,
  init: ResponseInit & { request?: Request } = {},
): Response {
  const { request, ...responseInit } = init
  const origin = request?.headers.get('origin') ?? undefined

  return new Response(JSON.stringify(body), {
    ...responseInit,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
      ...(responseInit.headers ?? {}),
    },
  })
}