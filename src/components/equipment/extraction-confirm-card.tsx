'use client'

/**
 * ExtractionConfirmCard — single-field confirmation row for the post-OCR
 * review step. Renders:
 *   - Field label
 *   - Pre-filled input
 *   - Confidence-coloured left border (green/yellow/red)
 *   - Confidence helper line ("AI confident" / "Please double-check" /
 *     "AI unsure — please enter manually")
 *   - "AI saw: <source quote>" muted line when the AI quoted text from the image
 *   - "✓ edited" mark when the tech overrides the AI value
 *
 * Manufacture-date adds two extras: a "decoded from serial number" badge
 * (when applicable) and a `notes` paragraph for brand-specific caveats.
 *
 * Type-only file; the parent owns state. This component is presentational.
 */
import * as React from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, ExternalLink, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  ExtractedField,
  ExtractedManufactureDate,
  ExtractionConfidence,
} from '@/types/data-plate-extraction'

interface BaseProps {
  /** Stable id used to wire <Label htmlFor>. */
  id: string
  /** Human label shown above the input. */
  label: string
  /** The AI's original extraction for this field (read-only — we don't mutate). */
  aiField: ExtractedField
  /** Current value in the input (the "confirmed" value). */
  value: string
  onChange: (next: string) => void
  /** Input type — defaults to "text". Date fields pass "date". */
  inputType?: 'text' | 'date'
  /** Optional placeholder for the empty state. */
  placeholder?: string
  /** Optional input class — e.g. font-mono for serial numbers. */
  inputClassName?: string
}

/**
 * Confidence visuals: left border + helper line. The colours intentionally
 * map to the same tokens used elsewhere in the app (success/warning/destructive
 * tinted variants) so the page reads as one design language.
 */
function confidenceStyles(c: ExtractionConfidence) {
  switch (c) {
    case 'high':
      return {
        border:
          'border-l-4 border-l-emerald-500/80 dark:border-l-emerald-400/80',
        helper: 'AI confident',
        helperClass: 'text-emerald-700 dark:text-emerald-400',
        ring: 'focus-visible:ring-emerald-500/30',
      }
    case 'medium':
      return {
        border:
          'border-l-4 border-l-amber-500/80 dark:border-l-amber-400/80',
        helper: 'Please double-check',
        helperClass: 'text-amber-700 dark:text-amber-400',
        ring: 'focus-visible:ring-amber-500/30',
      }
    case 'low':
    default:
      return {
        border:
          'border-l-4 border-l-rose-500/80 dark:border-l-rose-400/80',
        helper: 'AI unsure — please enter manually',
        helperClass: 'text-rose-700 dark:text-rose-400',
        ring: 'focus-visible:ring-rose-500/30',
      }
  }
}

/** True when the tech's confirmed value differs from the AI's guess. */
function isEdited(aiValue: string | null, confirmed: string): boolean {
  const a = (aiValue ?? '').trim()
  const c = confirmed.trim()
  if (!a && !c) return false
  return a !== c
}

/**
 * Standard field card (brand / model / serial). Manufacture-date uses
 * <ManufactureDateConfirmCard> below for the extra metadata it needs.
 */
export function ExtractionConfirmCard({
  id,
  label,
  aiField,
  value,
  onChange,
  inputType = 'text',
  placeholder,
  inputClassName,
}: BaseProps) {
  const styles = confidenceStyles(aiField.confidence)
  const edited = isEdited(aiField.value, value)

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-3 shadow-sm space-y-1.5',
        styles.border
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {edited && (
          <Badge
            variant="outline"
            className="h-5 px-1.5 text-[10px] font-medium text-foreground/80"
          >
            <CheckCircle2 className="h-3 w-3 mr-1" />
            edited
          </Badge>
        )}
      </div>

      <Input
        id={id}
        type={inputType}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? (aiField.value ? '' : 'Enter manually')}
        className={cn(styles.ring, inputClassName)}
        aria-describedby={`${id}-helper`}
      />

      <div id={`${id}-helper`} className="space-y-1">
        <p
          className={cn(
            'text-[11px] font-medium flex items-center gap-1',
            styles.helperClass
          )}
        >
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          {styles.helper}
        </p>
        {aiField.source_text && (
          <p className="text-[11px] text-muted-foreground italic break-words">
            AI saw: &ldquo;{aiField.source_text}&rdquo;
          </p>
        )}
      </div>
    </div>
  )
}

interface DateProps extends Omit<BaseProps, 'aiField' | 'inputType'> {
  aiField: ExtractedManufactureDate
}

/**
 * Manufacture-date variant. Adds:
 *  - A small "decoded from serial number" badge when `decoded_from === 'serial'`
 *  - The `notes` string rendered as helper text (brand-specific caveats)
 *  - When the AI completely failed (value === null AND notes mention "lookup"),
 *    a callout pointing the tech to manual entry / warranty portal
 *  - When confidence === 'low' and notes mention decade ambiguity ("2009/2019/2029"),
 *    the notes are auto-rendered prominently — the parent already provides the
 *    string, we just style it.
 */
export function ManufactureDateConfirmCard({
  id,
  label,
  aiField,
  value,
  onChange,
  placeholder,
  inputClassName,
}: DateProps) {
  const styles = confidenceStyles(aiField.confidence)
  const edited = isEdited(aiField.value, value)
  const decodedFromSerial = aiField.decoded_from === 'serial'

  // Try to pull a URL out of notes so we can render it as a real link
  // ("lookup via https://...warranty..."). Falls back to plain text.
  const urlMatch = aiField.notes?.match(/https?:\/\/\S+/i)
  const portalUrl = urlMatch?.[0]

  // If the AI returned no value AND the notes mention "lookup" or "portal",
  // surface a stronger callout to push the tech to manual entry.
  const needsManualLookup =
    !aiField.value &&
    aiField.notes &&
    /lookup|portal|warrant/i.test(aiField.notes)

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-3 shadow-sm space-y-1.5',
        styles.border
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Label htmlFor={id} className="text-sm font-medium">
            {label}
          </Label>
          {decodedFromSerial && (
            <Badge
              variant="secondary"
              className="h-5 px-1.5 text-[10px] font-medium"
            >
              decoded from serial number
            </Badge>
          )}
        </div>
        {edited && (
          <Badge
            variant="outline"
            className="h-5 px-1.5 text-[10px] font-medium text-foreground/80"
          >
            <CheckCircle2 className="h-3 w-3 mr-1" />
            edited
          </Badge>
        )}
      </div>

      <Input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(styles.ring, inputClassName)}
        aria-describedby={`${id}-helper`}
      />

      <div id={`${id}-helper`} className="space-y-1">
        <p
          className={cn(
            'text-[11px] font-medium flex items-center gap-1',
            styles.helperClass
          )}
        >
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          {styles.helper}
        </p>
        {aiField.source_text && (
          <p className="text-[11px] text-muted-foreground italic break-words">
            AI saw: &ldquo;{aiField.source_text}&rdquo;
          </p>
        )}
        {aiField.notes && !needsManualLookup && (
          <p className="text-[11px] text-muted-foreground">{aiField.notes}</p>
        )}
        {needsManualLookup && (
          <p className="text-[11px] text-foreground/80 bg-muted/60 border border-border/60 rounded p-2 mt-1">
            This brand requires manual date entry —{' '}
            {portalUrl ? (
              <>
                lookup via{' '}
                <a
                  href={portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-foreground inline-flex items-center gap-0.5"
                >
                  warranty portal
                  <ExternalLink className="h-3 w-3" />
                </a>
                .
              </>
            ) : (
              <>{aiField.notes}</>
            )}
          </p>
        )}
      </div>
    </div>
  )
}
