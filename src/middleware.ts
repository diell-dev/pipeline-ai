import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

/**
 * Audit S9 (2026-07-20) — nonce-based Content-Security-Policy.
 *
 * The old policy shipped `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
 * which means the CSP provided essentially no XSS protection: any injected
 * <script> would have executed. We now mint a random nonce per request and
 * allow only scripts carrying it.
 *
 * Two details that make this work with Next.js:
 *   1. The CSP is echoed onto the REQUEST headers as well as the response.
 *      Next.js looks for it there and stamps the nonce onto the framework's
 *      own inline bootstrap/hydration scripts.
 *   2. `strict-dynamic` lets those nonce'd bootstrap scripts load the rest of
 *      the chunk graph, which would otherwise need every chunk URL allow-listed.
 *
 * Kept deliberately:
 *   - `style-src 'unsafe-inline'`. React writes inline style attributes and
 *     Tailwind injects a style tag; locking this down needs 'unsafe-hashes'
 *     plus per-render hashing for no meaningful gain, since style injection
 *     is not a script-execution vector here.
 *   - `'unsafe-eval'` in DEVELOPMENT only. React Refresh / HMR needs it; the
 *     production bundle does not.
 */
function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    // 'wasm-unsafe-eval' is required for WebAssembly. The HEIC->JPEG decoder
    // (audit B1) is WASM, and without this Chrome throws
    //   "Compiling WebAssembly module violates ... 'unsafe-eval' is not allowed"
    // — which surfaced as a conversion that hung forever rather than failing.
    // This directive permits WASM compilation ONLY; it does NOT re-enable
    // JavaScript eval(), so it is far narrower than 'unsafe-eval'.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.upstash.io",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ')
}

export async function middleware(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== 'production'
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const csp = buildCsp(nonce, isDev)

  const response = await updateSession(request, { nonce, csp })

  // Redirects carry no HTML body, so a CSP on them is pointless noise —
  // but harmless and simpler to always set.
  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('x-nonce', nonce)

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - public folder assets
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|logos/).*)',
  ],
}
