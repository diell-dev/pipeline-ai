import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
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

export const metadata: Metadata = {
  title: {
    default: 'Pipeline AI — Smart Field Service Automation',
    template: '%s · Pipeline AI',
  },
  description:
    'AI-powered invoicing, reporting, and client management for trades businesses.',
  applicationName: 'Pipeline AI',
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
