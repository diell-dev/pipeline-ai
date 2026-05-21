/**
 * Public Tenant Scan Layout
 *
 * No auth — anyone with the QR code can land here and request service.
 * Sets a no-referrer policy so the QR code never leaks via Referer to
 * any external asset host (e.g. an org's logo CDN).
 */
export const metadata = {
  title: 'Request Service',
  referrer: 'no-referrer' as const,
}

export default function PublicEquipmentLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {/* Defense-in-depth: redundant <meta> in case the metadata API misses
          a particular asset request. */}
      <meta name="referrer" content="no-referrer" />
      <div className="min-h-screen bg-zinc-50">{children}</div>
    </>
  )
}
