/**
 * Public payment-return page.
 *
 * Stripe Checkout redirects the (anonymous) paying client here after a
 * card payment. It is intentionally PUBLIC and reads NOTHING from the
 * database — it only shows a friendly confirmation based on the status
 * query param. Payment truth is reconciled server-side by the Stripe
 * webhook; this page is purely cosmetic.
 */
export const dynamic = 'force-dynamic'

export default async function PayReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
  const paid = status === 'paid'

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div
          className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full ${
            paid ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
          }`}
          aria-hidden
        >
          {paid ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          ) : (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          )}
        </div>
        <h1 className="text-xl font-semibold text-slate-900">
          {paid ? 'Payment received' : 'Payment cancelled'}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {paid
            ? 'Thank you — your payment was processed successfully. A receipt has been sent to your email, and the invoice will update shortly.'
            : 'No payment was taken. You can reopen the payment link from your invoice email whenever you are ready.'}
        </p>
      </div>
    </main>
  )
}
