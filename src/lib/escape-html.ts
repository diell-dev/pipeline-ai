/**
 * HTML escape helper — single source of truth.
 *
 * Use this in every email template and anywhere user-supplied text is
 * embedded into HTML. Prevents XSS in transactional emails (proposal
 * estimates, invoice send-out, etc).
 */
export function escapeHtml(s: unknown): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
