'use client'

/**
 * useSignedPhotos (audit S1)
 *
 * Turns stored photo references (legacy public URLs or bucket paths) into
 * short-lived signed URLs via /api/storage/sign.
 *
 * Behaviour notes:
 *   - Returns a map keyed by the ORIGINAL ref, so callers can keep rendering
 *     from their existing array and just look up the display URL.
 *   - Values are `undefined` while loading, `string` once signed, and `null`
 *     when the caller isn't allowed to see that object (or it's gone). A
 *     component should render a placeholder for `null`, not a broken image.
 *   - Signed URLs expire (1h). Anything long-lived — a PDF the user keeps, an
 *     emailed link — must NOT embed one; fetch the bytes while it's valid.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type SignedMap = Record<string, string | null | undefined>

export function useSignedPhotos(refs: Array<string | null | undefined>): {
  signed: SignedMap
  loading: boolean
  resign: () => void
} {
  // Stable key so the effect doesn't re-fire on every render for an array
  // literal that happens to hold the same values.
  const cleaned = useMemo(
    () => refs.filter((r): r is string => typeof r === 'string' && r.length > 0),
    [refs]
  )
  const key = useMemo(() => cleaned.join('|'), [cleaned])

  const [signed, setSigned] = useState<SignedMap>({})
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  const resign = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (cleaned.length === 0) {
      setSigned({})
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch('/api/storage/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refs: cleaned }),
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('sign failed')
        const json = (await res.json()) as { urls?: SignedMap }
        setSigned(json.urls ?? {})
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return
        // Fail closed on the display side: null renders a placeholder rather
        // than a broken <img> pointing at a now-private object.
        setSigned(Object.fromEntries(cleaned.map((r) => [r, null])))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => controller.abort()
    // `key` collapses the array identity; nonce forces a manual re-sign.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce])

  return { signed, loading, resign }
}

/**
 * One-shot signing for non-React contexts (PDF generation, downloads).
 * Resolves stored refs to signed URLs immediately before the bytes are
 * fetched, so the 1-hour TTL is never a factor.
 */
export async function signPhotoRefs(refs: string[]): Promise<SignedMap> {
  if (refs.length === 0) return {}
  try {
    const res = await fetch('/api/storage/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refs }),
    })
    if (!res.ok) return {}
    const json = (await res.json()) as { urls?: SignedMap }
    return json.urls ?? {}
  } catch {
    return {}
  }
}
