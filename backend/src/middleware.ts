// backend/src/middleware.ts
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  ...(process.env.GATEKEEPER_CORS_ORIGIN
    ? process.env.GATEKEEPER_CORS_ORIGIN.split(',').map((o) => o.trim())
    : []),
]

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-requested-with',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Max-Age': '86400',
} as const

function getAllowedOrigin(request: NextRequest): string {
  const incoming = request.headers.get('origin') ?? ''
  return ALLOWED_ORIGINS.includes(incoming) ? incoming : ALLOWED_ORIGINS[0]
}

export function middleware(request: NextRequest) {
  const origin = getAllowedOrigin(request)

  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        ...CORS_HEADERS,
      },
    })
  }

  const response = NextResponse.next()
  response.headers.set('Access-Control-Allow-Origin', origin)
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value)
  })
  response.headers.set('Vary', 'Origin')
  return response
}

export const config = {
  matcher: '/api/:path*',
}