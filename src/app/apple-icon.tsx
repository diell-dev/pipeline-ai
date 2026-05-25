/**
 * Pipeline AI — Apple touch icon (Phase H1)
 *
 * 180x180 PNG served at /apple-icon, matching the favicon style:
 * slate-900 rounded square with a white "P" centered. The larger
 * radius accommodates iOS's rounded-corner mask without clipping the
 * letterform.
 */
import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
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
          fontSize: 124,
          fontWeight: 800,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          borderRadius: 36,
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
