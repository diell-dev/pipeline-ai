'use client'

/**
 * ExtractionConfirmStep — full review step rendered after the AI extracts
 * data-plate fields, before the tech commits to saving.
 *
 * Layout (mobile-first):
 *   1. Header "Review extracted info" + "Re-shoot photo" button
 *   2. Photo thumbnail (tap to view full-size in a new tab)
 *   3. Optional "photo may be hard to read" yellow banner (3+ low fields)
 *   4. One ExtractionConfirmCard per field (brand/model/serial/manufacture_date)
 *   5. Sticky "Save and register" CTA + "Skip this photo" secondary action
 *
 * State is fully owned by the parent — this component just renders + emits
 * `onConfirm({ confirmedValues, correctedFields })` when the user submits.
 */
import * as React from 'react'
import { useMemo, useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Camera, ImageOff, Loader2 } from 'lucide-react'
import {
  ExtractionConfirmCard,
  ManufactureDateConfirmCard,
} from './extraction-confirm-card'
import type {
  StructuredDataPlateExtraction,
  ConfirmedExtractionValues,
  CorrectedFieldsMap,
} from '@/types/data-plate-extraction'

export interface ExtractionConfirmStepProps {
  /** AI's structured extraction (what came back from /ocr-data-plate). */
  extraction: StructuredDataPlateExtraction
  /** URL of the uploaded data-plate photo (thumbnail + tap-to-enlarge). */
  photoUrl: string | null
  /** Called when the tech taps "Re-shoot photo" — parent re-opens camera/file picker. */
  onReshoot: () => void
  /** Called when the tech taps "Skip this photo" — parent should clear extraction + photo. */
  onSkip: () => void
  /**
   * Called when the tech taps "Save and register". Parent receives the final
   * confirmed values + per-field correction flags so it can POST both to the
   * register endpoint (for the learning loop).
   */
  onConfirm: (args: {
    confirmedValues: ConfirmedExtractionValues
    correctedFields: CorrectedFieldsMap
  }) => void
  /** Disabled state — typically while register POST is in-flight. */
  saving?: boolean
  /** Back button — typically returns to the previous registration step. */
  onBack?: () => void
}

/** Convert a possibly-null AI value into a string the input can hold. */
function aiValueToInput(v: string | null): string {
  return v ?? ''
}

/**
 * Render a date AI value safely into a <input type="date"> compatible string.
 * Accepts YYYY-MM-DD pass-through; tries to parse anything else; returns ''
 * on failure so the input stays controlled.
 */
function normaliseDateForInput(v: string | null): string {
  if (!v) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

export function ExtractionConfirmStep({
  extraction,
  photoUrl,
  onReshoot,
  onSkip,
  onConfirm,
  saving = false,
  onBack,
}: ExtractionConfirmStepProps) {
  // Local edit buffer — pre-filled from the AI extraction. Each input is
  // controlled here so we can compute per-field correction flags on submit.
  const [brand, setBrand] = useState(() => aiValueToInput(extraction.brand.value))
  const [model, setModel] = useState(() => aiValueToInput(extraction.model.value))
  const [serial, setSerial] = useState(() => aiValueToInput(extraction.serial.value))
  const [manufactureDate, setManufactureDate] = useState(() =>
    normaliseDateForInput(extraction.manufacture_date.value)
  )

  // If the parent swaps in a new extraction (re-shoot completed), refresh
  // the local buffer so the new AI values show up.
  useEffect(() => {
    setBrand(aiValueToInput(extraction.brand.value))
    setModel(aiValueToInput(extraction.model.value))
    setSerial(aiValueToInput(extraction.serial.value))
    setManufactureDate(normaliseDateForInput(extraction.manufacture_date.value))
  }, [extraction])

  const lowConfidenceCount = useMemo(() => {
    let n = 0
    if (extraction.brand.confidence === 'low') n++
    if (extraction.model.confidence === 'low') n++
    if (extraction.serial.confidence === 'low') n++
    if (extraction.manufacture_date.confidence === 'low') n++
    return n
  }, [extraction])

  function handleConfirm() {
    const confirmedValues: ConfirmedExtractionValues = {
      brand: brand.trim() || null,
      model: model.trim() || null,
      serial: serial.trim() || null,
      manufacture_date: manufactureDate || null,
    }
    const correctedFields: CorrectedFieldsMap = {
      brand: (extraction.brand.value ?? '') !== (confirmedValues.brand ?? ''),
      model: (extraction.model.value ?? '') !== (confirmedValues.model ?? ''),
      serial: (extraction.serial.value ?? '') !== (confirmedValues.serial ?? ''),
      manufacture_date:
        normaliseDateForInput(extraction.manufacture_date.value) !==
        (confirmedValues.manufacture_date ?? ''),
    }
    onConfirm({ confirmedValues, correctedFields })
  }

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {onBack && (
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 mb-1 h-8 px-2 text-xs text-muted-foreground"
                onClick={onBack}
                disabled={saving}
              >
                <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                Back
              </Button>
            )}
            <CardTitle className="text-base">Review extracted info</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Check each field. Green = AI confident, yellow = double-check,
              red = please enter manually.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onReshoot}
            disabled={saving}
            className="shrink-0"
          >
            <Camera className="h-3.5 w-3.5 mr-1" />
            Re-shoot
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Photo thumbnail */}
        {photoUrl ? (
          <a
            href={photoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block relative aspect-[4/3] w-full overflow-hidden rounded-lg border bg-muted"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl}
              alt="Data plate"
              className="h-full w-full object-contain"
            />
            <span className="absolute bottom-1.5 right-1.5 text-[10px] uppercase tracking-wide bg-black/60 text-white px-1.5 py-0.5 rounded">
              Tap to enlarge
            </span>
          </a>
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg border border-dashed bg-muted/40 text-muted-foreground">
            <div className="flex flex-col items-center gap-1">
              <ImageOff className="h-5 w-5" />
              <span className="text-xs">No photo</span>
            </div>
          </div>
        )}

        {/* Low-confidence banner */}
        {lowConfidenceCount >= 3 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-500/30 p-3 flex items-start gap-2">
            <div className="text-amber-900 dark:text-amber-200 text-xs space-y-2 flex-1">
              <p className="font-medium">
                Photo may be hard to read — re-shoot for better results?
              </p>
              <p className="text-amber-800/80 dark:text-amber-300/80">
                The AI was unsure on {lowConfidenceCount} of 4 fields. Try a
                closer, sharper photo with even light.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onReshoot}
                disabled={saving}
                className="h-7 mt-1 bg-white/60 dark:bg-transparent"
              >
                <Camera className="h-3.5 w-3.5 mr-1" />
                Re-shoot photo
              </Button>
            </div>
          </div>
        )}

        {/* Field cards */}
        <div className="space-y-3">
          <ExtractionConfirmCard
            id="confirm-brand"
            label="Brand"
            aiField={extraction.brand}
            value={brand}
            onChange={setBrand}
            placeholder="e.g. Carrier"
          />
          <ExtractionConfirmCard
            id="confirm-model"
            label="Model"
            aiField={extraction.model}
            value={model}
            onChange={setModel}
            placeholder="e.g. 24ACC624A003"
            inputClassName="font-mono"
          />
          <ExtractionConfirmCard
            id="confirm-serial"
            label="Serial number"
            aiField={extraction.serial}
            value={serial}
            onChange={setSerial}
            placeholder="e.g. 2110A12345"
            inputClassName="font-mono"
          />
          <ManufactureDateConfirmCard
            id="confirm-manufacture-date"
            label="Manufacture date"
            aiField={extraction.manufacture_date}
            value={manufactureDate}
            onChange={setManufactureDate}
          />
        </div>

        {/* Sticky bottom CTAs — on mobile the user is one thumb-reach away */}
        <div className="sticky bottom-0 -mx-6 -mb-6 px-6 pt-3 pb-4 bg-card/95 backdrop-blur border-t mt-4 space-y-2">
          <Button
            type="button"
            className="w-full h-12"
            onClick={handleConfirm}
            disabled={saving}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save and register
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={onSkip}
            disabled={saving}
          >
            Skip this photo (enter manually later)
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
