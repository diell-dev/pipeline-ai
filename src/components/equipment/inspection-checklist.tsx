'use client'

/**
 * InspectionChecklist
 *
 * Renders the equipment category's inspection checklist as tri-state items
 * (Pass / Fail / N/A). Used on the job detail page when the job is linked
 * to a piece of equipment.
 */
import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  Save,
} from 'lucide-react'

type TriState = 'pass' | 'fail' | 'na' | null

interface ChecklistItemSpec {
  id?: string
  label: string
  /** Optional fields the backend might attach */
  notes_required_on_fail?: boolean
}

/**
 * Slugify a label into a stable item code suitable for `checklist_item_code`.
 * Lowercase, non-alphanumerics → underscores, trimmed, capped to 60 chars.
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

interface EquipmentLite {
  id: string
  category?: {
    id: string
    name: string
    inspection_checklist?: unknown
  } | null
}

export interface InspectionItemResult {
  label: string
  result: TriState
  notes?: string | null
}

export interface Inspection {
  id?: string
  inspected_at?: string
  inspected_by_name?: string | null
  items: InspectionItemResult[]
}

interface Props {
  jobId: string
  equipment: EquipmentLite
  existingInspections?: Inspection[]
  onSaved?: () => void
}

/**
 * Normalise whatever the category.inspection_checklist field is into
 * a list of `{ label }` items. Accepts string[], { items: [...] }, or
 * an array of { label, ... } objects.
 */
function normaliseChecklist(raw: unknown): ChecklistItemSpec[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.map((item, i) => {
      if (typeof item === 'string') return { label: item }
      if (item && typeof item === 'object' && 'label' in item) {
        return {
          label: String((item as Record<string, unknown>).label),
          id: String((item as Record<string, unknown>).id ?? i),
          notes_required_on_fail: Boolean(
            (item as Record<string, unknown>).notes_required_on_fail
          ),
        }
      }
      return { label: String(item) }
    })
  }
  if (typeof raw === 'object' && raw && 'items' in raw) {
    return normaliseChecklist((raw as { items: unknown }).items)
  }
  return []
}

export function InspectionChecklist({
  jobId,
  equipment,
  existingInspections,
  onSaved,
}: Props) {
  const specItems = useMemo(
    () => normaliseChecklist(equipment.category?.inspection_checklist),
    [equipment.category?.inspection_checklist]
  )

  // Pre-fill from the most recent inspection if one was already saved.
  const initial = useMemo<InspectionItemResult[]>(() => {
    const latest = existingInspections?.[0]
    if (latest) {
      // Build a map by label so we can match against the spec
      const byLabel = new Map<string, InspectionItemResult>()
      latest.items.forEach((it) => byLabel.set(it.label, it))
      return specItems.map((s) => byLabel.get(s.label) ?? { label: s.label, result: null })
    }
    return specItems.map((s) => ({ label: s.label, result: null }))
  }, [specItems, existingInspections])

  const [results, setResults] = useState<InspectionItemResult[]>(initial)
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)

  // Keep state in sync if equipment/category changes
  useEffect(() => {
    setResults(initial)
  }, [initial])

  function setResult(idx: number, value: TriState) {
    setResults((prev) => {
      const next = [...prev]
      next[idx] = { ...next[idx], result: value }
      return next
    })
    // Auto-expand notes when failing
    if (value === 'fail') {
      setExpandedNotes((p) => new Set(p).add(idx))
    }
  }

  function setNotes(idx: number, notes: string) {
    setResults((prev) => {
      const next = [...prev]
      next[idx] = { ...next[idx], notes }
      return next
    })
  }

  function toggleNotes(idx: number) {
    setExpandedNotes((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  async function handleSave() {
    if (results.length === 0) {
      toast.error('Nothing to save')
      return
    }
    setSaving(true)
    try {
      // The API needs {checklist_item_code, checklist_item_label, result, notes}
      // per item. The local state carries `label` and `result` only.
      const payloadItems = results
        .filter((r) => r.result !== null)
        .map((r) => ({
          checklist_item_code: slugify(r.label),
          checklist_item_label: r.label,
          result: r.result,
          notes: r.notes ?? null,
        }))
      if (payloadItems.length === 0) {
        toast.error('Mark at least one item before saving')
        setSaving(false)
        return
      }
      const res = await fetch(`/api/jobs/${jobId}/inspections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_id: equipment.id,
          items: payloadItems,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || 'Save failed')
      }
      toast.success('Inspection saved')
      onSaved?.()
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : 'Could not save inspection'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  if (specItems.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" /> Inspection Checklist
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground italic">
            No checklist defined for this equipment category.
          </p>
        </CardContent>
      </Card>
    )
  }

  const latest = existingInspections?.[0]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" /> Inspection Checklist
          </span>
          {latest?.inspected_at && (
            <span className="text-xs text-muted-foreground font-normal">
              Last saved {new Date(latest.inspected_at).toLocaleString()}
              {latest.inspected_by_name ? ` by ${latest.inspected_by_name}` : ''}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y">
          {results.map((item, idx) => {
            const expanded = expandedNotes.has(idx)
            return (
              <li key={idx} className="py-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 text-sm">
                    <p>{item.label}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {(['pass', 'fail', 'na'] as const).map((opt) => {
                      const active = item.result === opt
                      const colorActive =
                        opt === 'pass'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : opt === 'fail'
                          ? 'bg-red-600 text-white border-red-600'
                          : 'bg-zinc-700 text-white border-zinc-700'
                      const colorInactive =
                        opt === 'pass'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                          : opt === 'fail'
                          ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                          : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100'
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setResult(idx, opt)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                            active ? colorActive : colorInactive
                          }`}
                        >
                          {opt === 'na' ? 'N/A' : opt[0].toUpperCase() + opt.slice(1)}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleNotes(idx)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {expanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  {expanded ? 'Hide notes' : 'Add notes'}
                </button>
                {expanded && (
                  <Textarea
                    placeholder="Notes (optional)…"
                    value={item.notes ?? ''}
                    onChange={(e) => setNotes(idx, e.target.value)}
                    className="text-sm min-h-[60px]"
                  />
                )}
              </li>
            )
          })}
        </ul>

        <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save Inspection
        </Button>
      </CardContent>
    </Card>
  )
}

export default InspectionChecklist
