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
  const [parents, setParents] = useState<ParentEquipmentOption[]>([])
  const [parentEquipmentId, setParentEquipmentId] = useState('')

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

      const { data: pub } = supabase.storage.from('equipment-photos').getPublicUrl(path)
      return pub?.publicUrl ?? null
    } catch (err) {
      console.error('Upload exception', err)
      toast.error('Photo upload failed')
      return null
    }
  }

  async function handleUnitPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingUnit(true)
    const url = await uploadPhoto(file, 'unit')
    if (url) setUnitPhotoUrl(url)
    setUploadingUnit(false)
    e.target.value = ''
  }

  async function handleDataPlatePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPlate(true)
    const url = await uploadPhoto(file, 'plate')
    if (url) {
      setDataPlatePhotoUrl(url)
      // Run OCR on the data plate
      await runOcr(file)
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
        const gotSomething = json.make || json.model || json.serial
        // Always update if we got a value — re-uploading a photo should
        // replace previous OCR results, even if the field is currently filled.
        if (json.make) setMake(json.make)
        if (json.model) setModel(json.model)
        if (json.serial) setSerial(json.serial)
        if (gotSomething) {
          toast.success('Data plate read — review the prefilled fields')
        } else {
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
  async function handleSubmitRegister(e: React.FormEvent) {
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
          make: make.trim() || null,
          model: model.trim() || null,
          serial_number: serial.trim() || null,
          unit_photo_url: unitPhotoUrl,
          data_plate_photo_url: dataPlatePhotoUrl,
          parent_equipment_id: parentEquipmentId || null,
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

      {/* ===== Stage 2: Register ===== */}
      {needsRegister && (
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
                      unitMode === 'unit' ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200'
                    }`}
                  >
                    Unit Number
                  </button>
                  <button
                    type="button"
                    onClick={() => setUnitMode('common')}
                    className={`text-xs rounded-full px-3 py-1 border ${
                      unitMode === 'common' ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200'
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
                      <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
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
                    <label className="flex items-center justify-center gap-2 h-24 rounded-lg border border-dashed cursor-pointer hover:bg-zinc-50">
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
                        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
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
                    <label className="flex items-center justify-center gap-2 h-24 rounded-lg border border-dashed cursor-pointer hover:bg-zinc-50">
                      {uploadingPlate ? (
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      ) : (
                        <>
                          <ImagePlus className="h-5 w-5 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">Snap data plate</span>
                        </>
                      )}
                      <input
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
