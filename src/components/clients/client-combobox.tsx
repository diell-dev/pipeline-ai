'use client'

/**
 * ClientCombobox
 *
 * A controlled combobox/typeahead for picking a client (and creating a
 * new one inline). Loads clients on mount via the Supabase browser
 * client, filtered by organization_id, and surfaces:
 *   - matching clients (case-insensitive on company_name OR primary_contact_name)
 *   - "+ Add \"<typed>\" as new client" when no match (creation mode only)
 *   - "+ Add new client…" footer row (creation mode only)
 *
 * Use `filterOnly` when this is wired to a filter (e.g. dashboards or
 * list filters) where creating a new client doesn't make sense.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { ChevronDown, Loader2, Plus, X } from 'lucide-react'
import { AddClientDialog } from '@/components/clients/add-client-dialog'
import type { Client } from '@/types/database'

interface ClientComboboxProps {
  /** Selected client id, or '' if none. */
  value: string
  /** Fired when user picks an existing client OR creates a new one. */
  onChange: (clientId: string, client: Client) => void
  placeholder?: string
  disabled?: boolean
  /**
   * If true, the picker only includes clients (no "Add new"). Use this for FILTERS.
   * Defaults to false (creation enabled).
   */
  filterOnly?: boolean
  /** Optional id for the input, useful for <Label htmlFor="…">. */
  id?: string
  /** Mark the underlying input as required. */
  required?: boolean
  className?: string
}

type Highlightable =
  | { kind: 'client'; client: Client }
  | { kind: 'create-typed' }
  | { kind: 'create-empty' }

export function ClientCombobox({
  value,
  onChange,
  placeholder = 'Select a client',
  disabled = false,
  filterOnly = false,
  id,
  required,
  className,
}: ClientComboboxProps) {
  const { organization } = useAuthStore()
  const generatedId = useId()
  const inputId = id ?? `client-combobox-${generatedId}`
  const listboxId = `${inputId}-listbox`

  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogDefaultName, setDialogDefaultName] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Load clients for the active org.
  useEffect(() => {
    if (!organization) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      const supabase = createSupabaseClient()
      const { data, error: err } = await supabase
        .from('clients')
        .select('*')
        .eq('organization_id', organization!.id)
        .is('deleted_at', null)
        .order('company_name')

      if (cancelled) return
      if (err) {
        console.error('ClientCombobox: failed to load clients:', err.message)
        setError('Failed to load clients')
        setClients([])
      } else {
        setClients((data || []) as Client[])
      }
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [organization])

  const selected = useMemo(
    () => clients.find((c) => c.id === value) ?? null,
    [clients, value]
  )

  // What the input shows:
  //   - while open: the user's free-text query
  //   - while closed: the selected client's company_name (or empty)
  const displayValue = open ? query : selected?.company_name ?? ''

  // Filtered list based on the typed query.
  const filteredClients = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) => {
      const name = c.company_name?.toLowerCase() ?? ''
      const contact = c.primary_contact_name?.toLowerCase() ?? ''
      return name.includes(q) || contact.includes(q)
    })
  }, [clients, query])

  // Build the unified, navigable item list (rows + create-actions).
  const items: Highlightable[] = useMemo(() => {
    const list: Highlightable[] = filteredClients.map((c) => ({
      kind: 'client' as const,
      client: c,
    }))
    if (!filterOnly) {
      const trimmed = query.trim()
      const exactMatch = trimmed
        ? clients.some(
            (c) => c.company_name?.toLowerCase() === trimmed.toLowerCase()
          )
        : false
      if (trimmed && !exactMatch) {
        list.push({ kind: 'create-typed' })
      }
      list.push({ kind: 'create-empty' })
    }
    return list
  }, [filteredClients, filterOnly, query, clients])

  // Reset highlight when the visible list changes.
  useEffect(() => {
    setHighlight(0)
  }, [items.length, open])

  // Outside click → close.
  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  // Keep highlighted row in view.
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-index="${highlight}"]`
    )
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [highlight, open])

  const openPanel = useCallback(() => {
    if (disabled) return
    setOpen(true)
  }, [disabled])

  function pickClient(client: Client) {
    onChange(client.id, client)
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  function openCreateDialog(prefill: string) {
    setDialogDefaultName(prefill)
    setDialogOpen(true)
    // Close the dropdown so the dialog has focus, but keep the picker
    // ready to receive the new client.
    setOpen(false)
  }

  function handleItemActivate(item: Highlightable) {
    if (item.kind === 'client') {
      pickClient(item.client)
      return
    }
    if (item.kind === 'create-typed') {
      openCreateDialog(query.trim())
      return
    }
    if (item.kind === 'create-empty') {
      openCreateDialog('')
      return
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      setHighlight((h) => Math.min(items.length - 1, h + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      setHighlight((h) => Math.max(0, h - 1))
      return
    }
    if (e.key === 'Enter') {
      if (!open) return
      e.preventDefault()
      const item = items[highlight]
      if (item) handleItemActivate(item)
      return
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        setOpen(false)
        setQuery('')
        inputRef.current?.blur()
      }
      return
    }
  }

  function clearSelection(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    onChange('', null as unknown as Client)
    setQuery('')
    setOpen(false)
  }

  // Row index helpers — items array is interleaved, so derive index by
  // walking the array in order.
  let rowCursor = 0

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && items[highlight]
              ? `${listboxId}-opt-${highlight}`
              : undefined
          }
          autoComplete="off"
          required={required}
          disabled={disabled}
          placeholder={loading ? 'Loading clients...' : placeholder}
          value={displayValue}
          onFocus={openPanel}
          onClick={openPanel}
          onChange={(e) => {
            setQuery(e.target.value)
            if (!open) setOpen(true)
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            'flex h-10 w-full min-w-0 rounded-lg border border-input bg-transparent pl-3 pr-16 py-1 text-sm transition-colors outline-none',
            'placeholder:text-muted-foreground',
            'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
            'disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50'
          )}
        />
        {/* Right-side adornments: clear (when value selected & not disabled) + chevron */}
        <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 pr-1.5 text-muted-foreground">
          {!disabled && selected && !open && (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Clear selection"
              onClick={clearSelection}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            aria-label={open ? 'Close client list' : 'Open client list'}
            onClick={() => {
              if (disabled) return
              if (open) {
                setOpen(false)
                setQuery('')
              } else {
                setOpen(true)
                inputRef.current?.focus()
              }
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                'h-4 w-4 transition-transform',
                open && 'rotate-180'
              )}
            />
          </button>
        </div>
      </div>

      {open && (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1 max-h-64 overflow-auto rounded-lg border bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 z-50"
        >
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading clients...
            </div>
          )}

          {!loading && error && (
            <div className="px-3 py-2 text-sm text-destructive">{error}</div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No clients found.
            </div>
          )}

          {!loading &&
            !error &&
            items.map((item) => {
              const idx = rowCursor++
              const isActive = idx === highlight
              const optionId = `${listboxId}-opt-${idx}`

              if (item.kind === 'client') {
                const c = item.client
                const isSelected = c.id === value
                return (
                  <div
                    key={`c-${c.id}`}
                    id={optionId}
                    role="option"
                    aria-selected={isSelected}
                    data-index={idx}
                    onMouseDown={(e) => {
                      // prevent input blur stealing focus before click registers
                      e.preventDefault()
                    }}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => pickClient(c)}
                    className={cn(
                      'flex min-h-10 cursor-pointer items-center gap-2 px-3 py-2 text-sm',
                      isActive && 'bg-muted',
                      isSelected && 'font-medium'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{c.company_name}</div>
                      {c.primary_contact_name && (
                        <div className="truncate text-xs text-muted-foreground">
                          {c.primary_contact_name}
                        </div>
                      )}
                    </div>
                  </div>
                )
              }

              if (item.kind === 'create-typed') {
                return (
                  <div
                    key="create-typed"
                    id={optionId}
                    role="option"
                    aria-selected={false}
                    data-index={idx}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => openCreateDialog(query.trim())}
                    className={cn(
                      'flex min-h-10 cursor-pointer items-center gap-2 border-t px-3 py-2 text-sm text-primary',
                      isActive && 'bg-muted'
                    )}
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      Add &ldquo;{query.trim()}&rdquo; as new client
                    </span>
                  </div>
                )
              }

              // create-empty
              return (
                <div
                  key="create-empty"
                  id={optionId}
                  role="option"
                  aria-selected={false}
                  data-index={idx}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlight(idx)}
                  onClick={() => openCreateDialog('')}
                  className={cn(
                    'flex min-h-10 cursor-pointer items-center gap-2 border-t px-3 py-2 text-sm text-muted-foreground hover:text-foreground',
                    isActive && 'bg-muted'
                  )}
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  <span>Add new client…</span>
                </div>
              )
            })}
        </div>
      )}

      {!filterOnly && (
        <AddClientDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          defaultName={dialogDefaultName}
          onCreated={(newClient) => {
            // Optimistically add to local list so the picker shows it.
            setClients((prev) => {
              const next = [...prev, newClient]
              next.sort((a, b) =>
                (a.company_name || '').localeCompare(b.company_name || '')
              )
              return next
            })
            onChange(newClient.id, newClient)
            setQuery('')
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
