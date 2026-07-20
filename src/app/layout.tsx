import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { Geist, Geist_Mono } from 'next/font/google'
import Script from 'next/script'
import { Providers } from '@/components/providers'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

// Phase M4.2 — viewport + theme-color split out per Next.js 15+ convention.
// theme-color matches the manifest background so the iOS status bar and
// Android Chrome address bar tint to the brand surface when launched as a
// PWA. We do NOT set viewportFit here because the dashboard layout already
// owns its own safe-area handling via the bottom nav.
export const viewport: Viewport = {
  themeColor: '#0f1a2e',
  width: 'device-width',
  initialScale: 1,
  // Disable user-scaling on mobile interactive shells is an a11y trap, so
  // we leave maximumScale unset — pinch-zoom stays available.
}

export const metadata: Metadata = {
  title: {
    default: 'Pipeline AI — Smart Field Service Automation',
    template: '%s · Pipeline AI',
  },
  description:
    'AI-powered invoicing, reporting, and client management for trades businesses.',
  applicationName: 'Pipeline AI',
  // Phase M4.2 — iOS "installs like an app" hints. iOS Safari uses these
  // legacy meta tags (no manifest support for these specific keys), so we
  // surface them via the Next.js appleWebApp metadata helper.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Pipeline',
  },
  // Phase M4.1 — the manifest is auto-discovered from src/app/manifest.ts
  // by Next.js, no manual <link rel="manifest"> needed.
  formatDetection: {
    telephone: false,
  },
  // Icons: Next.js auto-discovers src/app/icon.tsx, apple-icon.tsx, and
  // favicon.ico — declaring them here is redundant but lets us add the
  // SVG variant for browsers that prefer vector favicons (Firefox,
  // Safari 16+) without losing the static .ico fallback.
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
  },
  openGraph: {
    title: 'Pipeline AI — Field service operations that don’t lose track',
    description:
      'AI-powered invoicing, reporting, and client management for trades businesses.',
    siteName: 'Pipeline AI',
    type: 'website',
    // The /opengraph-image route is auto-wired by Next.js from
    // src/app/opengraph-image.tsx; do not hand-add an `images` entry.
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pipeline AI',
    description:
      'AI-powered invoicing, reporting, and client management for trades businesses.',
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Audit S9: middleware mints a per-request nonce and puts it on both the
  // CSP response header and this request header. Next.js applies it to its
  // own bootstrap scripts automatically (it reads the CSP request header);
  // any inline script WE render has to opt in explicitly, below.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Providers nonce={nonce}>{children}</Providers>
        {/*
          Phase M4.3 — register the offline-shell service worker. Production
          only so dev/HMR doesn't fight the SW cache. The SW itself lives at
          public/sw.js and caches the app shell with a network-first
          strategy for HTML and stale-while-revalidate for static assets.
          We use afterInteractive so registration doesn't block first paint.
        */}
        {process.env.NODE_ENV === 'production' && (
          <Script id="sw-register" strategy="afterInteractive" nonce={nonce}>{`
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', function () {
                navigator.serviceWorker
                  .register('/sw.js', { scope: '/' })
                  .catch(function (err) {
                    console.warn('[Pipeline] SW registration failed:', err);
                  });
              });
            }
          `}</Script>
        )}
      </body>
    </html>
  )
}
