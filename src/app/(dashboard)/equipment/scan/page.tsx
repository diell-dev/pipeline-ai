'use client'

/**
 * Equipment Scan + Register Flow
 *
 * Mobile-first. Two stages:
 *   1. Scan a QR code (camera via jsQR — works in iOS Safari + iOS Chrome
 *      + every desktop browser). Paste-code fallback always available.
 *   2. If unclaimed, render the registration form.
 *      Photos go straight to Supabase Storage (bucket: `equipment-photos`).
 *      Data-plate photo is sent to /api/equipment/ocr-data-plate for make/model/serial.
 *
 * jsQR is used instead of BarcodeDetector because WebKit (iOS Safari +
 * iOS Chrome) doesn't ship the BarcodeDetector API reliably yet, even
 * though both Apple and the spec call for it. jsQR works everywhere
 * with no native API dependency.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission, type Permission } from '@/lib/permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ClientCombobox } from '@/components/clients/client-combobox'
import { toast } from 'sonner'
import { prepareImageForUpload } from '@/lib/image-prepare'
import jsQR from 'jsqr'
import {
  Camera,
  Loader2,
  QrCode,
  ScanLine,
  CheckCircle2,
  ImagePlus,
  Sparkles,
  ArrowLeft,
} from 'lucide-react'
import type { Site } from '@/types/database'
import { ExtractionConfirmStep } from '@/components/equipment/extraction-confirm-step'
import {
  normaliseExtractionResponse,
  type StructuredDataPlateExtraction,
  type ConfirmedExtractionValues,
  type CorrectedFieldsMap,
} from '@/types/data-plate-extraction'

interface EquipmentCategory {
  id: string
  code: string
  name: string
  icon?: string | null
}

interface ParentEquipmentOption {
  id: string
  unit_number: string | null
  make: string | null
  model: string | null
}

export default function EquipmentScanPage() {
  const router = useRouter()
  const { user, organization } = useAuthStore()
  const supabase = useMemo(() => createClient(), [])

  const canRegister = user?.role
    ? hasPermission(user.role, 'equipment:register' as Permission)
    : false

  // ===== Stage 1: Scan =====
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [pastedCode, setPastedCode] = useState('')
  const [scannedCode, setScannedCode] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  // jsQR works in every browser — no native-API gating.
  const cameraSupported =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  // ===== Stage 2: Register =====
  const [needsRegister, setNeedsRegister] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [clientId, setClientId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [sites, setSites] = useState<Site[]>([])
  const [loadingSites, setLoadingSites] = useState(false)
  const [unitMode, setUnitMode] = useState<'unit' | 'common'>('unit')
  const [unitNumber, setUnitNumber] = useState('')
  const [commonAreaName, setCommonAreaName] = useState('')
  const [categories, setCategories] = useState<EquipmentCategory[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [unitPhotoUrl, setUnitPhotoUrl] = useState<string | null>(null)
  const [dataPlatePhotoUrl, setDataPlatePhotoUrl] = useState<string | null>(null)
  const [uploadingUnit, setUploadingUnit] = useState(false)
  const [uploadingPlate, setUploadingPlate] = useState(false)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [serial, setSerial] = useState('')
  const [manufactureDate, setManufactureDate] = useState<string | null>(null)
  const [parents, setParents] = useState<ParentEquipmentOption[]>([])
  const [parentEquipmentId, setParentEquipmentId] = useState('')

  // ===== Stage 2.5: Confirm extraction =====
  // After OCR returns, we show the ExtractionConfirmStep takeover so the tech
  // can review each field with confidence indicators. We hold on to both the
  // raw AI extraction AND the per-field correction flags so the register POST
  // can log them for the learning loop (see AI_LEARNING_LOOP.md).
  const [aiExtraction, setAiExtraction] =
    useState<StructuredDataPlateExtraction | null>(null)
  const [correctedFields, setCorrectedFields] =
    useState<CorrectedFieldsMap | null>(null)
  const [confirming, setConfirming] = useState(false)

  // ===== Load categories =====
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/equipment/categories', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          setCategories(Array.isArray(data) ? data : data?.categories || [])
        }
      } catch (err) {
        console.error('Failed to load categories', err)
      }
    }
    load()
  }, [])

  // ===== Load sites when client picked =====
  useEffect(() => {
    if (!clientId) {
      setSites([])
      setSiteId('')
      return
    }
    async function loadSites() {
      setLoadingSites(true)
      const { data } = await supabase
        .from('sites')
        .select('*')
        .eq('client_id', clientId)
        .is('deleted_at', null)
        .order('name')
      setSites((data || []) as Site[])
      setLoadingSites(false)
    }
    loadSites()
  }, [clientId, supabase])

  // ===== Load potential parent equipment for the site =====
  useEffect(() => {
    if (!siteId) {
      setParents([])
      setParentEquipmentId('')
      return
    }
    async function load() {
      try {
        const res = await fetch(`/api/equipment?site_id=${siteId}`, { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          setParents(
            (data.equipment || []).map((e: ParentEquipmentOption) => ({
              id: e.id,
              unit_number: e.unit_number,
              make: e.make,
              model: e.model,
            }))
          )
        }
      } catch (err) {
        console.error('Failed to load parent equipment', err)
      }
    }
    load()
  }, [siteId])

  // ===== Cleanup camera on unmount =====
  useEffect(() => {
    return () => {
      stopCamera()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ===== Attach stream + start jsQR scan loop AFTER the <video> element is mounted =====
  // We can't do this inside startCamera() because the <video> is conditionally
  // rendered on `scanning`. setScanning(true) doesn't synchronously mount it.
  useEffect(() => {
    if (!scanning) return
    const stream = streamRef.current
    const video = videoRef.current
    if (!stream || !video) return

    let cancelled = false

    async function attach() {
      if (!video || !stream) return
      video.srcObject = stream
      video.setAttribute('playsinline', 'true') // legacy iOS
      video.setAttribute('webkit-playsinline', 'true') // older iOS
      video.muted = true
      try {
        await video.play()
      } catch (err) {
        console.error('video.play() failed', err)
        setScanError(
          'Could not start camera preview. Try closing other apps that may be using the camera.'
        )
        return
      }

      if (cancelled) return

      // Lazy-allocate the offscreen canvas used to extract pixel data for jsQR.
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas')
      }
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        setScanError('Could not initialise canvas for scanning.')
        return
      }

      const tick = () => {
        if (cancelled || !streamRef.current || !videoRef.current) return
        const v = videoRef.current
        if (v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth > 0) {
          canvas.width = v.videoWidth
          canvas.height = v.videoHeight
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
          try {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'dontInvert',
            })
            if (code?.data) {
              const extracted = extractCodeFromValue(code.data)
              stopCamera()
              void handleCodeSubmit(extracted)
              return
            }
          } catch {
            // ignore per-frame decode errors
          }
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    void attach()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning])

  function stopCamera() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setScanning(false)
  }

  async function startCamera() {
    setScanError(null)
    if (!cameraSupported) {
      setScanError(
        'Your browser does not support camera access. Paste the code below.'
      )
      return
    }
    try {
      // Prefer the rear camera on mobile; on desktop this constraint is ignored
      // and the default camera is used.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream
      // Flip to scanning mode — the video element will mount in the next render,
      // and the useEffect below picks up the stream once `videoRef.current` exists.
      // We must NOT touch videoRef here because conditional rendering means the
      // element doesn't exist yet at this moment.
      setScanning(true)
    } catch (err) {
      console.error('Camera start failed', err)
      const msg =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in your browser settings, or paste the code below.'
          : err instanceof Error && err.name === 'NotFoundError'
          ? 'No camera found on this device. Paste the code below.'
          : 'Could not access camera. Paste the code below.'
      setScanError(msg)
      setScanning(false)
    }
  }

  /**
   * QR may contain a tenant URL like https://app.pipeline.ai/equipment/qr/ABC123
   * or just the raw code. Pull the last path segment if it's a URL.
   */
  function extractCodeFromValue(raw: string): string {
    try {
      const u = new URL(raw)
      const segs = u.pathname.split('/').filter(Boolean)
      return segs[segs.length - 1] || raw
    } catch {
      return raw.trim()
    }
  }

  async function handleCodeSubmit(code: string) {
    if (!code) return
    setChecking(true)
    setScannedCode(code)
    try {
      const res = await fetch(`/api/equipment/by-qr/${encodeURIComponent(code)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'view' }),
      })
      if (!res.ok) throw new Error('QR lookup failed')
      const data = await res.json()
      if (data.claimed && data.equipment?.id) {
        router.push(`/equipment/${data.equipment.id}`)
        return
      }
      // Unclaimed — show register form
      setNeedsRegister(true)
    } catch (err) {
      console.error('QR lookup failed', err)
      toast.error('Could not look up that QR code')
      setScannedCode(null)
    } finally {
      setChecking(false)
    }
  }

  // ===== Photo upload =====
  async function uploadPhoto(file: File, kind: 'unit' | 'plate'): Promise<string | null> {
    if (!organization) return null
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const uuid =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const path = `${organization.id}/equipment/${uuid}-${kind}.${ext}`

      const { error } = await supabase.storage
        .from('equipment-photos')
        .upload(path, file, { upsert: false, contentType: file.type || 'image/jpeg' })

      if (error) {
        console.error('Upload failed', error)
        toast.error('Photo upload failed — bucket equipment-photos may not exist')
        return null
      }

      // S1: private bucket — store the reference, sign it at display time.
      return `equipment-photos/${path}`
    } catch (err) {
      console.error('Upload exception', err)
      toast.error('Photo upload failed')
      return null
    }
  }

  async function handleUnitPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.files?.[0]
    if (!raw) return
    setUploadingUnit(true)
    // B1: transcode iPhone HEIC to JPEG before it reaches storage, otherwise
    // the photo is stored fine and renders as a blank tile in every browser
    // except Safari.
    const file = await prepareOrWarn(raw)
    if (file) {
      const url = await uploadPhoto(file, 'unit')
      if (url) setUnitPhotoUrl(url)
    }
    setUploadingUnit(false)
    e.target.value = ''
  }

  /**
   * Normalise a picked image, surfacing a clear error instead of silently
   * uploading something nobody can view.
   */
  async function prepareOrWarn(raw: File): Promise<File | null> {
    try {
      const { file, converted, originalBytes, finalBytes } = await prepareImageForUpload(raw)
      if (converted) {
        toast.success('Photo converted for viewing', {
          description: `${Math.round(originalBytes / 1024)} KB → ${Math.round(finalBytes / 1024)} KB`,
        })
      }
      return file
    } catch (err) {
      toast.error("Couldn't process that photo", {
        description: err instanceof Error ? err.message : undefined,
      })
      return null
    }
  }

  async function handleDataPlatePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.files?.[0]
    if (!raw) return
    setUploadingPlate(true)
    // B1: convert ONCE here so both the stored object and the OCR call get
    // JPEG. (runOcr still has its own HEIC guard for safety, but with a
    // converted file it becomes a pass-through.)
    const file = await prepareOrWarn(raw)
    if (file) {
      const url = await uploadPhoto(file, 'plate')
      if (url) {
        setDataPlatePhotoUrl(url)
        // Run OCR on the data plate
        await runOcr(file)
      }
    }
    setUploadingPlate(false)
    e.target.value = ''
  }

  async function runOcr(file: File) {
    setOcrLoading(true)
    try {
      // Read file as DataURL so we can split out the mime type the API needs.
      const reader = new FileReader()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      // Split "data:image/jpeg;base64,XXXX" into the mime type + base64 body.
      const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
      const mimeType = match?.[1] || file.type || 'image/jpeg'
      const photoBase64 = match?.[2] || dataUrl.replace(/^data:[^;]+;base64,/, '')

      // iOS Safari often hands back HEIC photos. Anthropic's vision API only
      // accepts jpeg/png/webp/gif — silently rejecting HEIC was the cause of
      // 'could not read data plate' for every iPhone scan. Normalise to JPEG
      // here by drawing to a canvas. JPEG quality 0.85 keeps the file small
      // while preserving label text.
      const normalised = await normaliseImageForOcr({ dataUrl, mimeType, photoBase64 })

      const res = await fetch('/api/equipment/ocr-data-plate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photo_base64: normalised.photoBase64,
          mime_type: normalised.mimeType,
        }),
      })
      if (res.ok) {
        const json = await res.json()
        // Normalise to the structured schema. Works with both Agent X's new
        // shape (per-field { value, source_text, confidence }) and the
        // legacy flat shape ({ make, model, serial }) so the UI doesn't
        // break during the rollout.
        const structured = normaliseExtractionResponse(json)
        const gotSomething =
          structured.brand.value ||
          structured.model.value ||
          structured.serial.value ||
          structured.manufacture_date.value

        // Pre-fill the underlying form fields too — if the tech taps "Skip
        // this photo" from the confirm step, these values still flow into
        // the standard register form so nothing's lost.
        if (structured.brand.value) setMake(structured.brand.value)
        if (structured.model.value) setModel(structured.model.value)
        if (structured.serial.value) setSerial(structured.serial.value)
        if (structured.manufacture_date.value) {
          setManufactureDate(structured.manufacture_date.value)
        }

        // Hand the raw AI extraction to the confirm step. It owns the local
        // edit buffer + computes correction flags on save.
        setAiExtraction(structured)
        if (gotSomething) {
          setConfirming(true)
        } else {
          // Nothing extracted — skip the confirm step, surface a toast,
          // and let the user fill the legacy form fields by hand.
          toast.info('No text recognised on the plate. Try a closer, sharper photo or fill in the fields manually.')
        }
      } else {
        const errJson = await res.json().catch(() => ({}))
        const detail = errJson.error || `HTTP ${res.status}`
        console.error('OCR endpoint returned non-200:', detail)
        toast.error(
          'Could not read data plate. Tap the photo to retake it or fill the fields manually.'
        )
      }
    } catch (err) {
      console.error('OCR failed', err)
      toast.error('Could not read data plate')
    } finally {
      setOcrLoading(false)
    }
  }

  /**
   * Convert any image to JPEG via a canvas. Cheap insurance against iOS HEIC,
   * stray TIFFs, oversized PNGs, etc. — Anthropic's vision API only accepts
   * jpeg/png/webp/gif, and HEIC was the silent failure mode before this.
   */
  async function normaliseImageForOcr(input: {
    dataUrl: string
    mimeType: string
    photoBase64: string
  }): Promise<{ photoBase64: string; mimeType: string }> {
    // If already a supported type AND under 1.5MB, pass through as-is.
    const isSupported = /^image\/(jpeg|png|webp|gif)$/.test(input.mimeType)
    const approxBytes = Math.ceil(input.photoBase64.length * 0.75)
    if (isSupported && approxBytes < 1_500_000) return input

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image()
        i.onload = () => resolve(i)
        i.onerror = reject
        i.src = input.dataUrl
      })
      // Cap longest side at 1600px — plenty for OCR, much smaller upload.
      const MAX_DIM = 1600
      const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.round(img.naturalWidth * scale)
      const h = Math.round(img.naturalHeight * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return input
      ctx.drawImage(img, 0, 0, w, h)
      const jpeg = canvas.toDataURL('image/jpeg', 0.85)
      return {
        photoBase64: jpeg.replace(/^data:image\/jpeg;base64,/, ''),
        mimeType: 'image/jpeg',
      }
    } catch {
      // If canvas conversion fails, fall back to original
      return input
    }
  }

  // ===== Submit registration =====
  /**
   * Submit the register form. Accepts optional overrides for the data-plate
   * fields and correction flags so the confirm step can pass freshly-confirmed
   * values WITHOUT waiting for React's state batching to flush (otherwise we
   * could POST the previous make/model/serial values).
   */
  async function handleSubmitRegister(
    e: React.FormEvent,
    overrides?: {
      make?: string | null
      model?: string | null
      serial?: string | null
      manufactureDate?: string | null
      correctedFields?: CorrectedFieldsMap | null
    }
  ) {
    e.preventDefault()
    if (!scannedCode) return
    if (!siteId) {
      toast.error('Pick a site')
      return
    }
    if (unitMode === 'unit' && !unitNumber.trim()) {
      toast.error('Enter a unit number')
      return
    }
    if (unitMode === 'common' && !commonAreaName.trim()) {
      toast.error('Enter a common area name')
      return
    }
    if (!categoryId) {
      toast.error('Pick an equipment category')
      return
    }

    // Resolve final field values: overrides win over state, state wins over null.
    const finalMake =
      overrides?.make !== undefined ? overrides.make ?? '' : make
    const finalModel =
      overrides?.model !== undefined ? overrides.model ?? '' : model
    const finalSerial =
      overrides?.serial !== undefined ? overrides.serial ?? '' : serial
    const finalManufactureDate =
      overrides?.manufactureDate !== undefined
        ? overrides.manufactureDate
        : manufactureDate
    const finalCorrected =
      overrides?.correctedFields !== undefined
        ? overrides.correctedFields
        : correctedFields

    setRegistering(true)
    try {
      const res = await fetch('/api/equipment/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qr_code: scannedCode,
          site_id: siteId,
          category_id: categoryId,
          unit_number: unitMode === 'unit' ? unitNumber.trim() : null,
          common_area_name: unitMode === 'common' ? commonAreaName.trim() : null,
          // Legacy flat fields — preserved so the register endpoint stays
          // backward-compatible. These now reflect the tech's CONFIRMED
          // values (post-edit), not the raw AI guesses.
          make: finalMake.trim() || null,
          model: finalModel.trim() || null,
          serial_number: finalSerial.trim() || null,
          manufacture_date: finalManufactureDate || null,
          unit_photo_url: unitPhotoUrl,
          data_plate_photo_url: dataPlatePhotoUrl,
          parent_equipment_id: parentEquipmentId || null,
          // ----- Learning-loop payload (Agent X reads these on /register) -----
          // The full structured AI extraction (with confidence + source quotes)
          ai_extraction: aiExtraction,
          // The tech's confirmed values, keyed by field. Mirrors `make`/`model`/
          // `serial_number`/`manufacture_date` above but in the structured form
          // so the audit query doesn't have to re-derive it.
          confirmed_extraction: aiExtraction
            ? ({
                brand: finalMake.trim() || null,
                model: finalModel.trim() || null,
                serial: finalSerial.trim() || null,
                manufacture_date: finalManufactureDate || null,
              } satisfies ConfirmedExtractionValues)
            : null,
          // Per-field flag: did the tech change the AI's value?
          corrected_fields: finalCorrected,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || 'Registration failed')
      }
      const json = await res.json()
      toast.success('Equipment registered')
      if (json.equipment_id) router.push(`/equipment/${json.equipment_id}`)
      else router.push('/equipment')
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : 'Failed to register'
      toast.error(msg)
    } finally {
      setRegistering(false)
    }
  }

  // ===== Confirm-extraction step handlers =====

  /**
   * Tech taps "Save and register" inside the confirm step.
   *
   * Order of operations:
   *   1. Validate the prerequisite registration fields are filled. The confirm
   *      step is a takeover, so missing site/category/unit must surface as a
   *      toast + send the user back to the form.
   *   2. Persist the tech's confirmed values into the underlying form state
   *      (make/model/serial/manufactureDate) so the existing register POST
   *      picks them up.
   *   3. Store correction flags for the learning loop.
   *   4. Close the confirm card and submit the register form programmatically.
   */
  function handleConfirmExtraction(args: {
    confirmedValues: ConfirmedExtractionValues
    correctedFields: CorrectedFieldsMap
  }) {
    // Validate upstream fields first — otherwise the POST will 400 and we'd
    // lose the user's just-confirmed edits.
    if (!siteId) {
      toast.error('Pick a client + site before saving')
      setConfirming(false)
      return
    }
    if (!categoryId) {
      toast.error('Pick an equipment category before saving')
      setConfirming(false)
      return
    }
    if (unitMode === 'unit' && !unitNumber.trim()) {
      toast.error('Enter a unit number before saving')
      setConfirming(false)
      return
    }
    if (unitMode === 'common' && !commonAreaName.trim()) {
      toast.error('Enter a common area name before saving')
      setConfirming(false)
      return
    }

    // Persist into form state so a follow-up "Back" + visible form shows the
    // tech's edits.
    setMake(args.confirmedValues.brand ?? '')
    setModel(args.confirmedValues.model ?? '')
    setSerial(args.confirmedValues.serial ?? '')
    setManufactureDate(args.confirmedValues.manufacture_date)
    setCorrectedFields(args.correctedFields)
    setConfirming(false)

    // Submit immediately, passing the just-confirmed values as overrides so
    // we don't depend on React's state batching to flush before the POST.
    void handleSubmitRegister(
      { preventDefault: () => {} } as React.FormEvent,
      {
        make: args.confirmedValues.brand,
        model: args.confirmedValues.model,
        serial: args.confirmedValues.serial,
        manufactureDate: args.confirmedValues.manufacture_date,
        correctedFields: args.correctedFields,
      }
    )
  }

  /**
   * Re-shoot — close the confirm card, clear the photo + AI extraction,
   * and trigger the hidden data-plate file input. The new photo flows back
   * through handleDataPlatePhotoChange → runOcr → confirming === true.
   */
  function handleReshoot() {
    setConfirming(false)
    setAiExtraction(null)
    setCorrectedFields(null)
    setDataPlatePhotoUrl(null)
    // Defer one tick so the input mounts in the empty-state branch.
    setTimeout(() => {
      const input = document.getElementById(
        'data-plate-input'
      ) as HTMLInputElement | null
      input?.click()
    }, 0)
  }

  /** Skip — clear the AI extraction + return to the standard form fields. */
  function handleSkipExtraction() {
    setConfirming(false)
    setAiExtraction(null)
    setCorrectedFields(null)
  }

  // ============================================================
  // Render
  // ============================================================

  if (!canRegister) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground">You don&apos;t have permission to register equipment.</p>
            <Button className="mt-4" variant="outline" onClick={() => router.push('/equipment')}>
              Back to Equipment
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-md mx-auto space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => router.push('/equipment')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-bold">Scan QR</h1>
      </div>

      {/* ===== Stage 1: Scan ===== */}
      {!needsRegister && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <QrCode className="h-4 w-4" /> Scan the QR sticker
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!scanning && !scannedCode && (
              <Button onClick={startCamera} className="w-full h-14 text-base">
                <Camera className="mr-2 h-5 w-5" />
                Open Camera
              </Button>
            )}

            {scanning && (
              <div className="space-y-2">
                <div className="relative aspect-square overflow-hidden rounded-lg border bg-black">
                  <video
                    ref={videoRef}
                    className="absolute inset-0 h-full w-full object-cover"
                    muted
                    playsInline
                  />
                  <div className="absolute inset-8 rounded-lg border-2 border-white/70 pointer-events-none" />
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-white/80 bg-black/40 px-2 py-1 rounded">
                    Point camera at QR code
                  </div>
                </div>
                <Button variant="outline" className="w-full" onClick={stopCamera}>
                  Cancel
                </Button>
              </div>
            )}

            {scanError && (
              <p className="text-sm text-red-600">{scanError}</p>
            )}

            {checking && (
              <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Looking up code…
              </div>
            )}

            {!scanning && !checking && (
              <div className="space-y-2">
                <Label htmlFor="paste-code" className="text-xs text-muted-foreground">
                  Or paste the code
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="paste-code"
                    value={pastedCode}
                    onChange={(e) => setPastedCode(e.target.value)}
                    placeholder="ABC-12345"
                  />
                  <Button
                    onClick={() => handleCodeSubmit(extractCodeFromValue(pastedCode))}
                    disabled={!pastedCode.trim()}
                  >
                    <ScanLine className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== Stage 2.5: Confirm extraction (takeover) =====
          Renders INSTEAD of the Stage 2 form once OCR returns a structured
          extraction. The confirm step owns the per-field review UI; on
          "Save and register" it writes the confirmed values into the form
          state and triggers the register POST. */}
      {needsRegister && confirming && aiExtraction && (
        <ExtractionConfirmStep
          extraction={aiExtraction}
          photoUrl={dataPlatePhotoUrl}
          onReshoot={handleReshoot}
          onSkip={handleSkipExtraction}
          onConfirm={handleConfirmExtraction}
          onBack={() => setConfirming(false)}
          saving={registering}
        />
      )}

      {/* ===== Stage 2: Register ===== */}
      {needsRegister && !confirming && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Register this unit
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              QR <span className="font-mono">{scannedCode}</span> is not yet claimed.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmitRegister} className="space-y-4">
              {/* Client */}
              <div>
                <Label className="text-sm">Client</Label>
                <ClientCombobox
                  value={clientId}
                  onChange={(id) => {
                    setClientId(id)
                  }}
                  required
                />
              </div>

              {/* Site */}
              <div>
                <Label className="text-sm">Site</Label>
                <select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  disabled={!clientId || loadingSites}
                  required
                >
                  <option value="">{loadingSites ? 'Loading…' : 'Pick a site'}</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Unit vs common area toggle */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setUnitMode('unit')}
                    className={`text-xs rounded-full px-3 py-1 border ${
                      unitMode === 'unit' ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100' : 'border-border'
                    }`}
                  >
                    Unit Number
                  </button>
                  <button
                    type="button"
                    onClick={() => setUnitMode('common')}
                    className={`text-xs rounded-full px-3 py-1 border ${
                      unitMode === 'common' ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100' : 'border-border'
                    }`}
                  >
                    Common Area
                  </button>
                </div>
                {unitMode === 'unit' ? (
                  <Input
                    placeholder="e.g. 4B"
                    value={unitNumber}
                    onChange={(e) => setUnitNumber(e.target.value)}
                    required
                  />
                ) : (
                  <Input
                    placeholder="e.g. Roof — North"
                    value={commonAreaName}
                    onChange={(e) => setCommonAreaName(e.target.value)}
                    required
                  />
                )}
              </div>

              {/* Category */}
              <div>
                <Label className="text-sm">Category</Label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  required
                >
                  <option value="">Pick a category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon ? `${c.icon} ` : ''}{c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Unit photo */}
              <div>
                <Label className="text-sm">Photo of unit</Label>
                <div className="mt-1">
                  {unitPhotoUrl ? (
                    <div className="flex items-start gap-3">
                      <div className="relative aspect-square w-32 overflow-hidden rounded-lg border">
                        <img src={unitPhotoUrl} alt="Unit" className="h-full w-full object-cover" />
                      </div>
                      <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted">
                        {uploadingUnit ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ImagePlus className="h-4 w-4" />
                        )}
                        Replace
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={handleUnitPhotoChange}
                          className="hidden"
                        />
                      </label>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 h-24 rounded-lg border border-dashed cursor-pointer hover:bg-muted">
                      {uploadingUnit ? (
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      ) : (
                        <>
                          <ImagePlus className="h-5 w-5 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">Snap photo</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleUnitPhotoChange}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Data plate photo + OCR */}
              <div>
                <Label className="text-sm">Photo of data plate</Label>
                <div className="mt-1">
                  {dataPlatePhotoUrl ? (
                    <div className="flex items-start gap-3">
                      <div className="relative aspect-square w-32 overflow-hidden rounded-lg border">
                        <img src={dataPlatePhotoUrl} alt="Data plate" className="h-full w-full object-cover" />
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted">
                          {uploadingPlate || ocrLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ImagePlus className="h-4 w-4" />
                          )}
                          Retake
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={handleDataPlatePhotoChange}
                            className="hidden"
                          />
                        </label>
                        <p className="text-[11px] text-muted-foreground max-w-[10rem]">
                          Get close, fill the frame, avoid glare.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 h-24 rounded-lg border border-dashed cursor-pointer hover:bg-muted">
                      {uploadingPlate ? (
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      ) : (
                        <>
                          <ImagePlus className="h-5 w-5 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">Snap data plate</span>
                        </>
                      )}
                      <input
                        id="data-plate-input"
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleDataPlatePhotoChange}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
                {ocrLoading && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Sparkles className="h-3 w-3 animate-pulse" /> Reading data plate…
                  </p>
                )}
              </div>

              {/* If the tech tapped "Back" from the confirm step, the AI
                  extraction is still in memory — let them jump back in. */}
              {aiExtraction && !confirming && (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="w-full text-xs text-foreground/80 underline underline-offset-2 hover:text-foreground"
                >
                  Re-open AI review for these fields
                </button>
              )}

              {/* Make/model/serial — prefilled by OCR but editable */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Make</Label>
                  <Input value={make} onChange={(e) => setMake(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Model</Label>
                  <Input value={model} onChange={(e) => setModel(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Serial</Label>
                  <Input value={serial} onChange={(e) => setSerial(e.target.value)} />
                </div>
              </div>

              {/* Parent system (optional) */}
              {parents.length > 0 && (
                <div>
                  <Label className="text-sm">Part of (optional)</Label>
                  <select
                    value={parentEquipmentId}
                    onChange={(e) => setParentEquipmentId(e.target.value)}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">— None —</option>
                    {parents.map((p) => (
                      <option key={p.id} value={p.id}>
                        {[p.make, p.model, p.unit_number].filter(Boolean).join(' ') || p.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <Button type="submit" className="w-full h-12" disabled={registering}>
                {registering ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Register Equipment
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
