/**
 * POST /api/dictate
 *
 * Voice dictation for field techs — speak in any supported language,
 * get structured English back.
 *
 * Flow:
 *   1. Receive recorded audio (multipart/form-data)
 *   2. Transcribe with OpenAI Whisper (auto-detects spoken language;
 *      whisper-1 is the default because it covers Albanian, which the
 *      newer gpt-4o-transcribe models do not officially support)
 *   3. Claude translates to English and, in "job" mode, extracts
 *      structured fields (tech notes, matching catalog services, priority)
 *   4. Return both the original-language transcript and the English result
 *      so the original can be kept for the record
 *
 * Modes:
 *   - mode=field → { text } — clean English text for a single input field
 *   - mode=job   → { techNotes, services[], priority } — fills the New Job form
 *
 * Env:
 *   OPENAI_API_KEY  (required — returns 503 with a clear message if missing)
 *   STT_MODEL       (optional, defaults to 'whisper-1')
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { getApiUser, hasPermission } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit'

export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = SupabaseClient<any, 'public', any>

function getServiceClient(): ServiceClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey)
}

const MAX_AUDIO_BYTES = 4 * 1024 * 1024 // ~4MB ≈ 15+ min of opus; Vercel body limit is 4.5MB
const MIN_AUDIO_SECONDS = 1

interface WhisperResult {
  text: string
  language: string // full language name, e.g. "albanian"
  duration: number // seconds
}

async function transcribe(audio: File, apiKey: string): Promise<WhisperResult> {
  const model = process.env.STT_MODEL || 'whisper-1'
  const form = new FormData()
  form.append('file', audio, audio.name || 'audio.webm')
  form.append('model', model)
  form.append('response_format', 'verbose_json')
  // Decoding bias toward trade vocabulary (helps with jargon + loanwords)
  form.append(
    'prompt',
    'Sewer and drain service job: hydro jetting, snaking, clean-out, backwater valve, catch basin, main line, trap, camera inspection.'
  )

  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(45_000),
    })
  } catch {
    throw new DictateError(502, 'Transcription service timed out. Please try again.')
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401) {
      throw new DictateError(503, 'Transcription service key is invalid — check OPENAI_API_KEY.')
    }
    console.error('Whisper API error:', res.status, body.slice(0, 500))
    throw new DictateError(502, 'Transcription service is unavailable right now. Please try again.')
  }

  const data = (await res.json()) as WhisperResult
  return data
}

class DictateError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface CatalogEntry {
  id: string
  code: string
  name: string
}

interface JobExtraction {
  detected_language: string
  tech_notes: string
  priority: 'normal' | 'urgent' | 'emergency' | null
  services: { id: string; quantity: number }[]
  client_id: string | null
  site_id: string | null
}

interface FieldExtraction {
  detected_language: string
  text: string
}

function parseClaudeJson<T>(raw: string): T {
  // Strip markdown fences if the model added them (same pattern as jobs/generate)
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    // Model prefixed prose — fall back to the outermost JSON object
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error('No JSON object in model reply')
    return JSON.parse(cleaned.slice(start, end + 1)) as T
  }
}

export async function POST(request: NextRequest) {
  try {
    // ── Auth ──
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    // Paid AI endpoint — staff only. Portal clients have no dictation UI and
    // must not be able to burn AI credits or read the org's client list.
    if (!hasPermission(auth.role, 'jobs:create')) {
      return NextResponse.json({ error: 'Not allowed.' }, { status: 403 })
    }
    // Paid AI call — throttle per user
    if (!checkRateLimit(`dictate:${auth.userId}`, { limit: 20, windowMs: 60_000 })) {
      return NextResponse.json({ error: 'Too many requests — slow down.' }, { status: 429 })
    }

    const openaiKey = process.env.OPENAI_API_KEY
    if (!openaiKey) {
      return NextResponse.json(
        { error: 'Voice dictation is not configured yet (missing OPENAI_API_KEY).' },
        { status: 503 }
      )
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        {
          error:
            'Server not fully configured for this environment — SUPABASE_SERVICE_ROLE_KEY / ANTHROPIC_API_KEY must be enabled for Preview in Vercel.',
        },
        { status: 503 }
      )
    }

    // ── Input ──
    const form = await request.formData()
    const audio = form.get('audio')
    const mode = form.get('mode') === 'job' ? 'job' : 'field'

    if (!(audio instanceof File) || audio.size === 0) {
      return NextResponse.json({ error: 'No audio received.' }, { status: 400 })
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: 'Recording is too long — please keep it under 5 minutes.' },
        { status: 400 }
      )
    }

    // ── Step 1: transcribe in the original language ──
    const whisper = await transcribe(audio, openaiKey)

    // Guard against Whisper hallucinating text from silence/noise
    if (whisper.duration < MIN_AUDIO_SECONDS || !whisper.text.trim()) {
      return NextResponse.json(
        { error: "Didn't catch that — please try again and speak a bit longer." },
        { status: 400 }
      )
    }

    // Usage trace for cost attribution — never log the transcript itself
    console.log(
      `dictate: user=${auth.userId} mode=${mode} audioSec=${Math.round(whisper.duration)} lang=${whisper.language}`
    )

    // ── Step 2: Claude translates + extracts ──
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    if (mode === 'field') {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system:
          'You process voice dictations from field technicians at a sewer & drain service company. ' +
          'Techs may speak Albanian, Russian, Polish, Spanish, Ukrainian, or English. ' +
          'Translate the transcript into clear, professional English field notes. ' +
          'Keep every fact: measurements, pipe sizes, materials, addresses, part names, prices. ' +
          'Remove filler words and false starts. Do not add anything that was not said. ' +
          'If the transcript is already English, just clean it up. ' +
          'Reply ONLY with JSON: {"detected_language": "<language name in English>", "text": "<english text>"}',
        messages: [
          {
            role: 'user',
            content: `Whisper detected language: ${whisper.language}\n\nTranscript:\n${whisper.text}`,
          },
        ],
      })
      const raw = response.content[0].type === 'text' ? response.content[0].text : ''
      const parsed = parseClaudeJson<FieldExtraction>(raw)

      return NextResponse.json({
        mode,
        detectedLanguage: parsed.detected_language,
        originalTranscript: whisper.text,
        text: typeof parsed.text === 'string' ? parsed.text : '',
      })
    }

    // mode === 'job' → also match services from the org's catalog
    const supabase = getServiceClient()
    const { data: catalog } = await supabase
      .from('service_catalog')
      .select('id, code, name')
      .eq('organization_id', auth.organizationId)
      .eq('is_active', true)

    const { data: clientRows } = await supabase
      .from('clients')
      .select('id, company_name')
      .eq('organization_id', auth.organizationId)
      .is('deleted_at', null)
      .order('company_name')
      .limit(300)

    const { data: siteRows } = await supabase
      .from('sites')
      .select('id, client_id, name, address, borough')
      .eq('organization_id', auth.organizationId)
      .is('deleted_at', null)
      .order('name')
      .limit(500)

    const clients = (clientRows as { id: string; company_name: string }[] | null) || []
    const sites =
      (siteRows as { id: string; client_id: string; name: string; address: string; borough: string | null }[] | null) || []

    const catalogList = ((catalog as CatalogEntry[] | null) || [])
      .map((s) => `${s.id} | ${s.code} | ${s.name}`)
      .join('\n')

    const clientList = clients.map((c) => `${c.id} | ${c.company_name}`).join('\n')
    const siteList = sites
      .map((st) => `${st.id} | client:${st.client_id} | ${st.name} | ${st.address}${st.borough ? ` (${st.borough})` : ''}`)
      .join('\n')

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system:
        'You process voice dictations from field technicians at a sewer & drain service company. ' +
        'Techs may speak Albanian, Russian, Polish, Spanish, Ukrainian, or English. ' +
        'Your job: translate to professional English and extract structured job data. ' +
        'Rules:\n' +
        '- tech_notes: everything the tech said, as clear English field notes. Keep ALL facts ' +
        '(measurements, pipe sizes, materials, addresses, conditions found, work performed, client remarks). ' +
        'Do not summarize away details. Do not invent details.\n' +
        '- services: ONLY services from the provided catalog that clearly match work the tech described, ' +
        'with quantity if stated (default 1). If nothing clearly matches, return []. Never guess.\n' +
        '- priority: "urgent" or "emergency" ONLY if the tech explicitly indicates urgency ' +
        '(e.g. sewage backing up into home, flooding, health hazard). Otherwise null.\n' +
        '- client_id: if the tech names a client/company (or a building that appears in the sites list), ' +
        'pick the matching client from the client list. Fuzzy match is OK (spoken names are approximate, ' +
        'e.g. "Manhattan Towers" matches "Manhattan Towers LLC"), but if nothing plausibly matches, use null. Never invent ids.\n' +
        '- site_id: if a specific building/site from the sites list is named or clearly implied, pick it ' +
        '(it must belong to the matched client). Otherwise null. If only a building is named, derive the client from that site.\n' +
        'Reply ONLY with JSON: {"detected_language": "<language name in English>", ' +
        '"tech_notes": "<english notes>", "priority": "normal"|"urgent"|"emergency"|null, ' +
        '"services": [{"id": "<catalog id>", "quantity": <number>}], ' +
        '"client_id": "<client id>"|null, "site_id": "<site id>"|null}',
      messages: [
        {
          role: 'user',
          content:
            `Whisper detected language: ${whisper.language}\n\n` +
            `Service catalog (id | code | name):\n${catalogList || '(empty catalog)'}\n\n` +
            `Clients (id | company name):\n${clientList || '(none)'}\n\n` +
            `Sites (id | client | name | address):\n${siteList || '(none)'}\n\n` +
            `Transcript:\n${whisper.text}`,
        },
      ],
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text : ''
    const parsed = parseClaudeJson<JobExtraction>(raw)

    // Validate service ids against the real catalog — never trust extraction blindly
    const validIds = new Set(((catalog as CatalogEntry[] | null) || []).map((s) => s.id))
    const services = (parsed.services || [])
      .filter((s) => validIds.has(s.id))
      .map((s) => ({ id: s.id, quantity: Math.max(1, Math.min(99, Math.round(s.quantity || 1))) }))

    const priority =
      parsed.priority === 'urgent' || parsed.priority === 'emergency' ? parsed.priority : null

    // Client/site: validate against real rows, never trust extraction blindly.
    // If only a site matched, derive its client. If the site doesn't belong
    // to the matched client, drop the site (keep the client).
    const matchedSite = sites.find((st) => st.id === parsed.site_id) || null
    let matchedClient = clients.find((c) => c.id === parsed.client_id) || null
    if (!matchedClient && matchedSite) {
      matchedClient = clients.find((c) => c.id === matchedSite.client_id) || null
    }
    const site = matchedSite && matchedClient && matchedSite.client_id === matchedClient.id ? matchedSite : null

    return NextResponse.json({
      mode,
      detectedLanguage: parsed.detected_language,
      originalTranscript: whisper.text,
      techNotes: typeof parsed.tech_notes === 'string' ? parsed.tech_notes : '',
      priority,
      services,
      clientId: matchedClient?.id ?? null,
      clientName: matchedClient?.company_name ?? null,
      siteId: site?.id ?? null,
      siteName: site?.name ?? null,
    })
  } catch (err) {
    if (err instanceof DictateError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('Dictation error:', err)
    return NextResponse.json(
      { error: 'Something went wrong processing the recording. Please try again.' },
      { status: 500 }
    )
  }
}
