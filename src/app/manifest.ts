/**
 * PWA manifest (Phase M4.1)
 *
 * Uses the Next.js metadata file convention so the manifest is served at
 * /manifest.webmanifest with the correct Content-Type — no hand-written
 * <link> tag required. Next.js auto-links it from the document head.
 *
 * Icons reference the existing `src/app/icon.tsx` and `src/app/apple-icon.tsx`
 * file-convention routes from Phase H so we don't double up on assets.
 *
 * TODO(future): per-tenant manifest overrides (custom name + theme color
 * sourced from organization.brand). That requires a dynamic manifest route
 * keyed on the auth'd org and is out of scope for the mobile-first uplift —
 * the default Pipeline AI manifest is fine for the install prompt.
 */
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pipeline AI',
    short_name: 'Pipeline',
    description: "Field service operations that don't lose track.",
    start_url: '/dashboard',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f1a2e',
    theme_color: '#0f1a2e',
    icons: [
      { src: '/icon', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  }
}
