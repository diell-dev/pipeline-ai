'use client'

/**
 * Photo Upload Component
 *
 * Handles drag-and-drop + click-to-upload for job photos.
 * Previews selected images, supports removal, and returns File[] to parent.
 * Does NOT handle Supabase upload — that happens on form submit.
 */
import { useCallback, useRef, useState } from 'react'
import { Upload, X, Image as ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface PhotoUploadProps {
  photos: File[]
  onPhotosChange: (photos: File[]) => void
  maxPhotos?: number
  maxSizeMB?: number
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

export function PhotoUpload({
  photos,
  onPhotosChange,
  maxPhotos = 20,
  maxSizeMB = 10,
}: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const validateAndAdd = useCallback(
    (files: FileList | File[]) => {
      const newFiles: File[] = []
      const maxBytes = maxSizeMB * 1024 * 1024

      for (const file of Array.from(files)) {
        if (!ACCEPTED_TYPES.includes(file.type)) {
          toast.error(`${file.name} is not a supported image format`)
          continue
        }
        if (file.size > maxBytes) {
          toast.error(`${file.name} is too large (max ${maxSizeMB}MB)`)
          continue
        }
        if (photos.length + newFiles.length >= maxPhotos) {
          toast.error(`Maximum ${maxPhotos} photos allowed`)
          break
        }
        newFiles.push(file)
      }

      if (newFiles.length > 0) {
        onPhotosChange([...photos, ...newFiles])
      }
    },
    [photos, onPhotosChange, maxPhotos, maxSizeMB]
  )

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      validateAndAdd(e.dataTransfer.files)
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
      validateAndAdd(e.target.files)
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
        onClick={() => inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed
          px-6 py-8 cursor-pointer transition-colors
          ${isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-zinc-100'
          }
        `}
      >
        <Upload className="h-8 w-8 text-zinc-400 mb-2" />
        <p className="text-sm font-medium text-zinc-600">
          Drop photos here or click to browse
        </p>
        <p className="text-xs text-zinc-400 mt-1">
          JPG, PNG, WebP, HEIC — max {maxSizeMB}MB each — up to {maxPhotos} photos
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
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
              className="relative group aspect-square rounded-lg overflow-hidden border bg-zinc-100"
            >
              <img
                src={URL.createObjectURL(file)}
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
        <div className="flex items-center justify-between text-xs text-zinc-500">
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
