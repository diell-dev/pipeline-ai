/**
 * Public Proposal Sign Layout
 *
 * Minimal — no sidebar/auth. Just clean page chrome for the client.
 */
export const metadata = {
  title: 'Review & Sign Estimate',
}

export default function ProposalSignLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-zinc-50">
      {children}
    </div>
  )
}
