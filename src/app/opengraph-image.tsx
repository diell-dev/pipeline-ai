/**
 * Pipeline AI — Open Graph / social card image (Phase H2)
 *
 * 1200x630 PNG rendered on demand via Next.js's ImageResponse.
 * The marketing surface today is just /login, so this image doubles
 * as the social card for the entire site. Uses the same Slate-900 +
 * Sky-700 gradient + accent treatment as the login split-screen panel
 * so the social preview feels of-a-piece with the landing experience.
 *
 * If we add a real marketing route later, we can drop a route-scoped
 * `opengraph-image.tsx` next to that page to override this default.
 */
import { ImageResponse } from 'next/og'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Pipeline AI — Field service operations that don’t lose track'

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background:
            'linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #0c4a6e 100%)',
          color: '#ffffff',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          position: 'relative',
        }}
      >
        {/* Decorative accent — sky-700 glow lower-right */}
        <div
          style={{
            position: 'absolute',
            top: -180,
            right: -180,
            width: 540,
            height: 540,
            borderRadius: 9999,
            background:
              'radial-gradient(circle at center, rgba(3,105,161,0.55) 0%, rgba(3,105,161,0) 70%)',
            display: 'flex',
          }}
        />

        {/* Wordmark row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 16,
              background: '#0369a1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 44,
              fontWeight: 800,
              letterSpacing: '-0.04em',
              color: '#ffffff',
            }}
          >
            P
          </div>
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              display: 'flex',
            }}
          >
            Pipeline AI
          </div>
        </div>

        {/* Tagline + sub */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              fontSize: 76,
              lineHeight: 1.05,
              fontWeight: 800,
              letterSpacing: '-0.035em',
              maxWidth: 940,
              display: 'flex',
            }}
          >
            Field service operations that don&rsquo;t lose track.
          </div>
          <div
            style={{
              fontSize: 28,
              color: 'rgba(226, 232, 240, 0.85)',
              fontWeight: 500,
              letterSpacing: '-0.01em',
              maxWidth: 880,
              display: 'flex',
            }}
          >
            AI-powered invoicing, reporting, and client management for trades businesses.
          </div>
        </div>

        {/* Footer strip */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 28,
            borderTop: '1px solid rgba(148, 163, 184, 0.25)',
            fontSize: 22,
            color: 'rgba(203, 213, 225, 0.9)',
          }}
        >
          <div style={{ display: 'flex' }}>pipeline-ai.app</div>
          <div style={{ display: 'flex', gap: 24 }}>
            <span>Invoicing</span>
            <span style={{ opacity: 0.5 }}>&middot;</span>
            <span>Scheduling</span>
            <span style={{ opacity: 0.5 }}>&middot;</span>
            <span>Reporting</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}
