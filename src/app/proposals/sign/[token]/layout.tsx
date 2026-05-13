/**
 * Public Proposal Sign Layout
 *
 * Minimal — no sidebar/auth. Just clean page chrome for the client.
 * Sets a no-referrer policy so the public token never leaks via Referer to
 * any external image/asset host (e.g. an org's logo CDN).
 */
export const metadata = {
  title: 'Review & Sign Estimate',
  referrer: 'no-referrer' as const,
}

export default function ProposalSignLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {/* Defense-in-depth: redundant <meta> in case the metadata API misses
          a particular asset request. */}
      <meta name="referrer" content="no-referrer" />
      <div className="min-h-screen bg-zinc-50">
        {children}
      </div>
    </>
  )
}
