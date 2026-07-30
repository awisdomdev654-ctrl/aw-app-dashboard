import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',

  // CORS is handled entirely by middleware.ts which intercepts OPTIONS
  // preflights before Next.js routing — keeping it here as well would
  // create duplicate/conflicting headers on real requests.
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
}

export default nextConfig