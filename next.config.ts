import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Image optimization — allow Supabase storage URLs
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/**',
      },
    ],
  },

  // Security headers for production
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // microphone=(self): voice dictation needs getUserMedia on our own origin; camera/geolocation stay blocked
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
          // HSTS — enforce HTTPS for 2 years
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          // NOTE (audit S9, 2026-07-20): Content-Security-Policy is deliberately
          // NOT set here any more. It is now generated per-request in
          // middleware.ts so it can carry a fresh nonce, which is what lets us
          // drop 'unsafe-inline' / 'unsafe-eval' from script-src in production.
          // A static header here would override the nonce'd one.
        ],
      },
    ];
  },
};

export default nextConfig;
