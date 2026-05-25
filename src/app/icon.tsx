/**
 * Pipeline AI — Favicon (Phase H1)
 *
 * Renders a 32x32 favicon that mirrors the sidebar's "P" chip:
 * a slate-900 rounded square with a white "P" centered. We use the
 * Next.js `icon` file convention so the build output emits a
 * cache-busted /icon at the document root — no manual static files.
 *
 * The values here intentionally mirror the Pipeline AI product defaults
 * in `src/lib/theme.ts` (DEFAULT_THEME.primaryColor === '#0f172a') so the
 * favicon stays consistent with the in-app sidebar fallback chip.
 *
 * TODO(H4): per-tenant favicon override. When a tenant has a custom
 * logo_url, we should serve a per-tenant icon instead of the Pipeline AI
 * default. That requires either a dynamic [orgSlug]/icon route or a
 * client-side <link rel="icon"> swap on org load — punted for now since
 * Next.js file-convention icons are baked at build time.
 */
import { ImageResponse } from 'next/og'

// Next.js 15 metadata file conventions
export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
          color: '#ffffff',
          fontSize: 22,
          fontWeight: 800,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          borderRadius: 6,
          letterSpacing: '-0.04em',
        }}
      >
        P
      </div>
    ),
    {
      ...size,
    }
  )
}
