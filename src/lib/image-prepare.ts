'use client'

/**
 * Client-side image normalisation before upload (audit B1).
 *
 * The problem
 * -----------
 * iPhones shoot HEIC by default, and the app invited it ("JPG, PNG, WebP,
 * HEIC" on the upload box). But HEIC depends on the patent-encumbered HEVC
 * codec, which Chrome, Firefox and Edge have never licensed — none of them
 * can decode it in an <img>, on any OS. Only Safari can.
 *
 * The failure was silent and nasty: the upload succeeded, the file was
 * served correctly (verified: HTTP 200, full bytes), and the browser simply
 * rendered nothing. `naturalWidth === 0`. Office staff saw blank tiles, the
 * portal showed blank tiles, and jsPDF — which also can't decode HEIC —
 * dropped photo documentation out of client-facing report PDFs with no
 * warning to whoever approved the report.
 *
 * The fix
 * -------
 * Convert at SELECTION time, before the bytes ever reach storage. Doing it
 * here rather than at display time means every downstream consumer — the
 * gallery, the portal, the PDF generator, the AI vision pipeline — receives
 * a format that universally works, and there is exactly one place to reason
 * about it.
 *
 * We also downscale oversized photos. A modern phone camera produces 3–5k px
 * images; nothing in this app displays them above ~1600px, and shrinking cuts
 * a typical 1.5 MB HEIC to a couple hundred KB — which matters on a phone
 * tethered in a basement.
 *
 * `heic2any` is imported dynamically so its ~2.7 MB of libheif WASM is only
 * fetched when someone actually picks a HEIC file.
 */

/** Longest edge we keep. Comfortably above anything the UI or PDF renders. */
const MAX_EDGE = 2048

/** JPEG quality for re-encoded images. 0.85 is visually lossless for photos. */
const JPEG_QUALITY = 0.85

/** Files at or below this size skip downscaling entirely. */
const SKIP_RESIZE_BELOW_BYTES = 400 * 1024

/**
 * Hard ceiling on a single HEIC decode. Generous — libheif on a 12MP phone
 * photo is genuinely slow on a mid-range device — but finite, so a broken
 * decoder surfaces as an error rather than an eternal spinner.
 */
const HEIC_TIMEOUT_MS = 60_000

export interface PreparedImage {
  file: File
  /** True when the original was HEIC/HEIF and had to be transcoded. */
  converted: boolean
  originalBytes: number
  finalBytes: number
}

export class ImagePrepareError extends Error {}

/**
 * HEIC detection. Browsers are unreliable about the MIME type for .heic —
 * Chrome commonly reports an empty string — so the extension is checked too.
 */
export function isHeic(file: File): boolean {
  const type = (file.type || '').toLowerCase()
  if (type === 'image/heic' || type === 'image/heif') return true
  if (type.startsWith('image/') && type !== '') return false
  return /\.(heic|heif)$/i.test(file.name)
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImagePrepareError('Canvas encoding failed'))),
      'image/jpeg',
      quality
    )
  })
}

function loadBitmap(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new ImagePrepareError('Image could not be decoded'))
    }
    img.src = url
  })
}

function withJpegName(name: string): string {
  return name.replace(/\.(heic|heif|png|webp|jpe?g)$/i, '') + '.jpg'
}

/**
 * Decode a HEIC/HEIF file to a JPEG blob using libheif (via heic2any).
 */
async function heicToJpegBlob(file: File): Promise<Blob> {
  let heic2any: typeof import('heic2any')
  try {
    heic2any = (await import('heic2any')).default as unknown as typeof import('heic2any')
  } catch {
    throw new ImagePrepareError('Could not load the HEIC converter')
  }

  // Guard against the decoder never settling. This bit us in testing: a CSP
  // that blocked WebAssembly made the conversion hang indefinitely behind a
  // spinner instead of throwing, which is the worst possible failure mode for
  // a tech standing in a basement.
  const conversion = (heic2any as unknown as (opts: {
    blob: Blob
    toType?: string
    quality?: number
  }) => Promise<Blob | Blob[]>)({
    blob: file,
    toType: 'image/jpeg',
    quality: JPEG_QUALITY,
  })

  const result = await Promise.race([
    conversion,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new ImagePrepareError('Converting this photo took too long — please try again')),
        HEIC_TIMEOUT_MS
      )
    ),
  ])

  // A HEIC container can hold an image sequence (Live Photos); heic2any then
  // returns an array. The first frame is the still we want.
  const blob = Array.isArray(result) ? result[0] : result
  if (!blob) throw new ImagePrepareError('HEIC conversion produced no image')
  return blob
}

/**
 * Downscale to MAX_EDGE and re-encode as JPEG. Returns null when the image is
 * already small enough to leave alone.
 */
async function maybeDownscale(blob: Blob): Promise<Blob | null> {
  const img = await loadBitmap(blob)
  const { naturalWidth: w, naturalHeight: h } = img

  if (Math.max(w, h) <= MAX_EDGE) return null

  const scale = MAX_EDGE / Math.max(w, h)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)

  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  return canvasToBlob(canvas, JPEG_QUALITY)
}

/**
 * Normalise one picked file into something every browser and jsPDF can read.
 *
 * Throws ImagePrepareError when a HEIC can't be decoded — the caller should
 * surface that to the user rather than uploading a file nobody can see.
 */
export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  const originalBytes = file.size
  const heic = isHeic(file)

  let working: Blob = file
  let name = file.name

  if (heic) {
    working = await heicToJpegBlob(file)
    name = withJpegName(file.name)
  }

  // Skip the resize pass for files that are already small.
  if (working.size > SKIP_RESIZE_BELOW_BYTES) {
    try {
      const smaller = await maybeDownscale(working)
      if (smaller && smaller.size < working.size) {
        working = smaller
        name = withJpegName(name)
      }
    } catch {
      // Downscaling is an optimisation, never a hard requirement — if the
      // canvas path fails we still upload a perfectly valid image.
    }
  }

  const finalFile =
    working === (file as Blob)
      ? file
      : new File([working], name, { type: 'image/jpeg', lastModified: Date.now() })

  return {
    file: finalFile,
    converted: heic,
    originalBytes,
    finalBytes: finalFile.size,
  }
}

/**
 * Prepare a batch, keeping the good ones and reporting the failures so the
 * caller can tell the user exactly which photo didn't make it.
 */
export async function prepareImagesForUpload(files: File[]): Promise<{
  prepared: PreparedImage[]
  failed: Array<{ name: string; reason: string }>
}> {
  const prepared: PreparedImage[] = []
  const failed: Array<{ name: string; reason: string }> = []

  for (const file of files) {
    try {
      prepared.push(await prepareImageForUpload(file))
    } catch (err) {
      failed.push({
        name: file.name,
        reason: err instanceof Error ? err.message : 'Could not process this image',
      })
    }
  }

  return { prepared, failed }
}
