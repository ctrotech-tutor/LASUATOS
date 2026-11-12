import type { NextConfig } from 'next';

const apiOrigin = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
const isProduction = process.env.NODE_ENV === 'production';
// HTTPS-only directives follow the public URL, so a local `next start` over plain HTTP still works.
const servedOverHttps = (process.env.PUBLIC_APP_URL ?? '').startsWith('https://');

/**
 * Content Security Policy for pages.
 * - Scripts: same origin plus inline, because Next.js App Router emits inline
 *   bootstrap scripts. A nonce-based policy (middleware + dynamic rendering) is
 *   the documented next step; see docs/SECURITY.md.
 * - Styles: inline is needed by Next.js and Leaflet's positioned tiles.
 * - Images: the rotating QR code is a data: URL; venue maps load OpenStreetMap tiles.
 * - connect-src stays same-origin: the browser only talks to /api/v1 through the
 *   rewrite below. Development adds eval and websockets for hot reload.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org",
  "font-src 'self' data:",
  `connect-src 'self'${isProduction ? '' : ' ws: wss:'}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(servedOverHttps ? ['upgrade-insecure-requests'] : []),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Origin-only referrers: OpenStreetMap's tile policy requires a referrer, and paths never leak.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Geolocation is used by venue-aware check-in and venue setup, on this origin only.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(servedOverHttps ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ['*.e2b.app'],
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Pages that carry one-time tokens in the fragment must never be cached.
      {
        source: '/(reset-password|verify-email|accept-invitation)',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiOrigin}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
