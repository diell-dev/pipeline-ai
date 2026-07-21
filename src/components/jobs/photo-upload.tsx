'use client'

/**
 * Photo Upload Component
 *
 * Handles drag-and-drop + click-to-upload for job photos.
 * Previews selected images, supports removal, and returns File[] to parent.
 * Does NOT handle Supabase upload — that happens on form submit.
 *
 * Audit B1: every picked file is normalised through `prepareImageForUpload`
 * BEFORE it reaches state, so what the parent uploads is always a format the
 * whole stack can read. iPhone HEIC shots are transcoded to JPEG here; large
 * camera images are downscaled. Doing it at selection time also means the
 * thumbnail below actually renders — a HEIC preview was blank too.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Upload, X, Image as ImageIcon, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { prepareImagesForUpload, isHeic } from '@/lib/image-prepare'

interface PhotoUploadProps {
  photos: File[]
  onPhotosChange: (photos: File[]) => void
  maxPhotos?: number
  maxSizeMB?: number
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const ACCEPTED_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif)$/i

/**
 * Chrome frequently reports an EMPTY `file.type` for .heic files, so a
 * type-only check silently rejected exactly the format we most need to
 * accept. Fall back to the extension.
 */
function isAcceptedImage(file: File): boolean {
  const type = (file.type || '').toLowerCase()
  if (ACCEPTED_TYPES.includes(type)) return true
  if (!type) return ACCEPTED_EXTENSIONS.test(file.name)
  return false
}

function formatKb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`
}

export function PhotoUpload({
  photos,
  onPhotosChange,
  maxPhotos = 20,
  maxSizeMB = 10,
}: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isPreparing, setIsPreparing] = useState(false)

  // One object URL per file, revoked when the file leaves the list. The old
  // code called createObjectURL inline during render, which minted a fresh
  // URL on every re-render and never released any of them.
  const previews = useMemo(() => photos.map((file) => URL.createObjectURL(file)), [photos])
  useEffect(() => {
    return () => previews.forEach((url) => URL.revokeObjectURL(url))
  }, [previews])

  const validateAndAdd = useCallback(
    async (files: FileList | File[]) => {
      const incoming = Array.from(files)
      const maxBytes = maxSizeMB * 1024 * 1024
      const accepted: File[] = []
      let remaining = maxPhotos - photos.length

      if (remaining <= 0) {
        toast.error(`Maximum ${maxPhotos} photos allowed`)
        return
      }

      for (const file of incoming) {
        if (!isAcceptedImage(file)) {
          toast.error(`${file.name} is not a supported image format`)
          continue
        }
        // Checked against the ORIGINAL so we never spend time transcoding
        // something absurd. HEIC shrinks on conversion, so this is generous.
        if (file.size > maxBytes) {
          toast.error(`${file.name} is too large (max ${maxSizeMB}MB)`)
          continue
        }
        if (remaining <= 0) {
          toast.error(`Maximum ${maxPhotos} photos allowed`)
          break
        }
        accepted.push(file)
        remaining -= 1
      }

      if (accepted.length === 0) return

      const needsConversion = accepted.some(isHeic)
      setIsPreparing(true)
      const toastId = needsConversion
        ? toast.loading(
            accepted.length > 1 ? 'Converting photos…' : 'Converting photo…',
            { description: 'iPhone photos are converted so they display everywhere.' }
          )
        : undefined

      try {
        const { prepared, failed } = await prepareImagesForUpload(accepted)

        for (const f of failed) {
          toast.error(`Couldn't process ${f.name}`, { description: f.reason })
        }

        if (prepared.length > 0) {
          onPhotosChange([...photos, ...prepared.map((p) => p.file)])

          const convertedCount = prepared.filter((p) => p.converted).length
          if (convertedCount > 0) {
            const before = prepared.reduce((s, p) => s + p.originalBytes, 0)
            const after = prepared.reduce((s, p) => s + p.finalBytes, 0)
            toast.success(
              convertedCount === 1
                ? 'Photo converted for viewing'
                : `${convertedCount} photos converted for viewing`,
              { id: toastId, description: `${formatKb(before)} → ${formatKb(after)}` }
            )
          } else if (toastId) {
            toast.dismiss(toastId)
          }
        } else if (toastId) {
          toast.dismiss(toastId)
        }
      } finally {
        setIsPreparing(false)
      }
    },
    [photos, onPhotosChange, maxPhotos, maxSizeMB]
  )

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      void validateAndAdd(e.dataTransfer.files)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      void validateAndAdd(e.target.files)
    }
    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  function removePhoto(index: number) {
    const updated = photos.filter((_, i) => i !== index)
    onPhotosChange(updated)
  }

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !isPreparing && inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed
          px-6 py-8 transition-colors
          ${isPreparing ? 'cursor-wait opacity-70' : 'cursor-pointer'}
          ${isDragging
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
            : 'border-border bg-muted/40 hover:border-zinc-400 hover:bg-muted dark:hover:border-zinc-500'
          }
        `}
      >
        {isPreparing ? (
          <Loader2 className="h-8 w-8 text-muted-foreground mb-2 animate-spin" />
        ) : (
          <Upload className="h-8 w-8 text-muted-foreground mb-2" />
        )}
        <p className="text-sm font-medium text-foreground">
          {isPreparing ? 'Preparing photos…' : 'Drop photos here or click to browse'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          JPG, PNG, WebP, HEIC — max {maxSizeMB}MB each — up to {maxPhotos} photos
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={[...ACCEPTED_TYPES, '.heic', '.heif'].join(',')}
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Photo previews */}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {photos.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="relative group aspect-square rounded-lg overflow-hidden border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previews[index]}
                alt={file.name}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  removePhoto(index)
                }}
                className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
              <div className="absolute bottom-0 left-0 right-0 bg-black/40 px-1 py-0.5">
                <p className="text-[10px] text-white truncate">{file.name}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Photo count */}
      {photos.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <ImageIcon className="h-3 w-3" />
            {photos.length} / {maxPhotos} photos
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onPhotosChange([])}
          >
            Clear all
          </Button>
        </div>
      )}
    </div>
  )
}
