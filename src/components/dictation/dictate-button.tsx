'use client'

/**
 * Voice dictation UI for field techs.
 *
 * Two exports:
 *  - <DictateFieldButton onText={...} />   — small mic for a single field (append English text)
 *  - <DictateJobCard services={...} onApply={...} /> — "Dictate entire job" flow with review step
 *
 * Techs can speak Albanian, Russian, Polish, Spanish, Ukrainian, or English;
 * the /api/dictate route returns English. Push-to-talk (tap to start, tap to
 * stop) — no auto-stop on silence, since job sites are loud.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Square, Loader2, Sparkles, Check, X, Globe } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { ServiceCatalogItem, JobPriority } from '@/types/database'

const MAX_SECONDS = 300 // 5 min cap — matches the server's size limit

// ────────────────────────────── recorder hook ──────────────────────────────

type RecorderState = 'idle' | 'recording' | 'processing'

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  // webm/opus everywhere except iOS Safari, which records mp4 (AAC).
  // Whisper accepts both.
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
  return ''
}

function useRecorder(onBlob: (blob: Blob) => void) {
  const [state, setState] = useState<RecorderState>('idle')
  const [seconds, setSeconds] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop())
    recorderRef.current = null
  }, [])

  useEffect(() => cleanup, [cleanup])

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        cleanup()
        onBlob(blob)
      }
      recorderRef.current = recorder
      recorder.start()
      setSeconds(0)
      setState('recording')
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) {
            toast.info('Maximum recording length reached.')
            recorderRef.current?.stop()
          }
          return s + 1
        })
      }, 1000)
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        toast.error('No microphone found on this device.')
      } else if (name === 'NotAllowedError' || name === 'SecurityError') {
        toast.error('Microphone blocked — click the mic icon in the address bar and allow access.')
      } else {
        toast.error(`Could not start recording${name ? ` (${name})` : ''} — try reloading the page.`)
      }
    }
  }, [cleanup, onBlob])

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      setState('processing')
      recorderRef.current.stop() // onstop fires → onBlob
    }
  }, [])

  return { state, setState, seconds, start, stop }
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

async function postDictation(blob: Blob, mode: 'field' | 'job') {
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
  const form = new FormData()
  form.append('audio', blob, `audio.${ext}`)
  form.append('mode', mode)
  const res = await fetch('/api/dictate', { method: 'POST', body: form })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Dictation failed.')
  return data
}

// ─────────────────────────── per-field mic button ───────────────────────────

export function DictateFieldButton({ onText }: { onText: (english: string) => void }) {
  const { state, setState, seconds, start, stop } = useRecorder(async (blob) => {
    try {
      const data = await postDictation(blob, 'field')
      onText(data.text)
      if (data.detectedLanguage && data.detectedLanguage.toLowerCase() !== 'english') {
        toast.success(`Translated from ${data.detectedLanguage}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Dictation failed.')
    } finally {
      setState('idle')
    }
  })

  if (state === 'processing') {
    return (
      <Button type="button" variant="ghost" size="sm" disabled className="gap-1.5 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Transcribing…
      </Button>
    )
  }

  if (state === 'recording') {
    return (
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={stop}
        className="gap-1.5 tabular-nums"
      >
        <Square className="h-3.5 w-3.5 fill-current" />
        {fmt(seconds)} — tap to stop
      </Button>
    )
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={start} className="gap-1.5">
      <Mic className="h-4 w-4" />
      Dictate
    </Button>
  )
}

// ─────────────────────────── whole-job dictation ───────────────────────────

export interface DictationResult {
  detectedLanguage: string
  originalTranscript: string
  techNotes: string
  priority: JobPriority | null
  services: { id: string; quantity: number }[]
}

export function DictateJobCard({
  services,
  onApply,
}: {
  services: ServiceCatalogItem[]
  onApply: (result: DictationResult) => void
}) {
  const [result, setResult] = useState<DictationResult | null>(null)
  const { state, setState, seconds, start, stop } = useRecorder(async (blob) => {
    try {
      const data = await postDictation(blob, 'job')
      setResult(data as DictationResult)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Dictation failed.')
    } finally {
      setState('idle')
    }
  })

  const matchedServices = (result?.services || [])
    .map((s) => {
      const svc = services.find((c) => c.id === s.id)
      return svc ? { ...svc, quantity: s.quantity } : null
    })
    .filter((s): s is ServiceCatalogItem & { quantity: number } => s !== null)

  function apply() {
    if (!result) return
    onApply({ ...result, services: matchedServices.map((s) => ({ id: s.id, quantity: s.quantity })) })
    setResult(null)
    toast.success('Dictation applied — review the fields below before submitting.')
  }

  // ── review step ──
  if (result) {
    return (
      <Card className="border-primary/40">
        <CardHeader className="p-4 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Here&apos;s what I understood
            </CardTitle>
            {result.detectedLanguage && (
              <Badge variant="secondary" className="gap-1">
                <Globe className="h-3 w-3" />
                {result.detectedLanguage}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0 space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Technician notes (English)</p>
            <p className="text-sm whitespace-pre-wrap rounded-md border bg-muted/40 p-3">
              {result.techNotes}
            </p>
          </div>

          {matchedServices.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Suggested services</p>
              <div className="flex flex-wrap gap-1.5">
                {matchedServices.map((s) => (
                  <Badge key={s.id} variant="outline">
                    {s.name}
                    {s.quantity > 1 ? ` ×${s.quantity}` : ''}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {result.priority && result.priority !== 'normal' && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Priority</p>
              <Badge variant="destructive" className="capitalize">{result.priority}</Badge>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="button" onClick={apply} className="gap-1.5">
              <Check className="h-4 w-4" />
              Apply to form
            </Button>
            <Button type="button" variant="outline" onClick={() => setResult(null)} className="gap-1.5">
              <X className="h-4 w-4" />
              Discard
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ── idle / recording / processing ──
  return (
    <Card className={state === 'recording' ? 'border-destructive/50' : ''}>
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              Dictate this job
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Describe the whole job out loud — English, Albanian, Russian, Polish, Spanish, or
              Ukrainian. AI fills in the notes and services in English.
            </p>
          </div>

          {state === 'idle' && (
            <Button type="button" onClick={start} className="gap-1.5 shrink-0">
              <Mic className="h-4 w-4" />
              Start speaking
            </Button>
          )}
          {state === 'recording' && (
            <Button
              type="button"
              variant="destructive"
              onClick={stop}
              className="gap-1.5 shrink-0 tabular-nums animate-pulse"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              {fmt(seconds)} — tap when done
            </Button>
          )}
          {state === 'processing' && (
            <Button type="button" disabled className="gap-1.5 shrink-0">
              <Loader2 className="h-4 w-4 animate-spin" />
              Understanding…
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
