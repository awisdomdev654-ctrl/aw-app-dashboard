// backend/middleware.ts
//
// This file runs BEFORE Next.js routes any request — which is exactly what
// CORS preflight needs. The next.config.ts headers() config runs AFTER
// routing, so OPTIONS requests hit a 405 before those headers are ever
// applied. Middleware has no such problem.
//
// What this does:
//   • OPTIONS requests  → respond immediately with 204 + CORS headers
//                         (browser sees "preflight passed", sends real request)
//   • All other requests → add CORS headers and pass through to the route
//
// To add a production domain later, just append it to ALLOWED_ORIGINS.

import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_ORIGINS = [
  'http://localhost:5173', // Vite dev server (primary)
  'http://localhost:5174', // Vite fallback port (when 5173 is taken)
  'http://localhost:3000', // Next.js same-origin calls
]

const CORS_HEADERS = {
  'Access-Control-Allow-Methods':     'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':     'Content-Type, Authorization, x-requested-with',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Max-Age':           '86400', // cache preflight 24 h
} as const

function getAllowedOrigin(request: NextRequest): string {
  const incoming = request.headers.get('origin') ?? ''
  return ALLOWED_ORIGINS.includes(incoming) ? incoming : ALLOWED_ORIGINS[0]
}

export function middleware(request: NextRequest) {
  const origin = getAllowedOrigin(request)

  // ── Preflight ────────────────────────────────────────────────────────────
  // Browser sends OPTIONS before every cross-origin POST/PUT/DELETE.
  // We respond immediately with 204 — no body needed, just the headers.
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        ...CORS_HEADERS,
      },
    })
  }

  // ── Real request ─────────────────────────────────────────────────────────
  // Pass through to the route handler and stamp CORS headers on the way out.
  const response = NextResponse.next()
  response.headers.set('Access-Control-Allow-Origin', origin)
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value)
  })
  response.headers.set('Vary', 'Origin')

  return response
}

// Only run on API routes — don't touch Next.js page/asset requests.
export const config = {
  matcher: '/api/:path*',
}