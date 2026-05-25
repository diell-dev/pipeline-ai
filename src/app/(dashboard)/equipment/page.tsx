'use client'

/**
 * Equipment List Page
 *
 * Catalog of HVAC / mechanical equipment registered against client sites.
 * Mobile-first cards, desktop table view.
 *
 * Permissions:
 *   - equipment:view              — see this page
 *   - equipment:register          — can scan & register new equipment (Scan button)
 *   - equipment:manage_qr_batches — can generate sticker batches (QR button)
 */
import { useEffect, useMemo, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission, type Permission } from '@/lib/permissions'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { SkeletonList } from '@/components/ui/skeleton'
import {
  Building2,
  ChevronDown,
  MapPin,
  Plus,
  QrCode,
  Search,
  Wrench,
  Calendar,
  AlertTriangle,
  ScanLine,
} from 'lucide-react'

// ============================================================
// Types — kept loose because src/types/database.ts will be
// updated by the backend agent. Treat the API response as the
// source of truth.
// ============================================================

interface EquipmentCategory {
  id: string
  code: string
  name: string
  parent_category?: string | null
  icon?: string | null
  inspection_checklist?: unknown
}

interface EquipmentRow {
  id: string
  organization_id: string
  site_id: string | null
  category_id: string | null
  unit_number: string | null
  common_area_name: string | null
  make: string | null
  model: string | null
  serial_number: string | null
  next_service_due_date: string | null
  installed_date: string | null
  parent_equipment_id: string | null
  status?: string | null
  qr_code?: string | null
  // Joined fields the API may return
  category?: EquipmentCategory | null
  site?: { id: string; name: string; address?: string | null } | null
  parent?: { id: string; unit_number: string | null; make: string | null; model: string | null } | null
}

type StatusFilter = 'all' | 'due_soon' | 'overdue' | 'by_lifespan' | 'replaced'

interface SiteOption {
  id: string
  name: string
}

// ============================================================
// Helpers
// ============================================================

const MS_PER_DAY = 1000 * 60 * 60 * 24

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const due = new Date(iso).getTime()
  if (Number.isNaN(due)) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((due - today.getTime()) / MS_PER_DAY)
}

function dueChip(days: number | null): { className: string; label: string } | null {
  if (days === null) return null
  if (days < 0) {
    return {
      className: 'bg-red-100 text-red-700 border-red-200',
      label: `${Math.abs(days)}d overdue`,
    }
  }
  if (days <= 30) {
    return {
      className: 'bg-amber-100 text-amber-700 border-amber-200',
      label: `Due in ${days}d`,
    }
  }
  return {
    className: 'bg-zinc-100 text-zinc-600 border-zinc-200',
    label: `Due in ${days}d`,
  }
}

function locationLabel(eq: EquipmentRow): string {
  const site = eq.site?.name ?? 'Unknown site'
  const unit = eq.unit_number || eq.common_area_name
  return unit ? `${site} — ${unit}` : site
}

function categoryIcon(eq: EquipmentRow): string {
  // Lightweight emoji fallback — backend will eventually return a proper icon key.
  return (eq.category?.icon as string | undefined) || '🛠️'
}

// ============================================================
// Page
// ============================================================

export default function EquipmentListPage() {
  const router = useRouter()
  const { user, organization } = useAuthStore()
  const supabase = useMemo(() => createClient(), [])

  const canRegister = user?.role
    ? hasPermission(user.role, 'equipment:register' as Permission)
    : false
  const canManageBatches = user?.role
    ? hasPermission(user.role, 'equipment:manage_qr_batches' as Permission)
    : false
  const isSuperAdmin = user?.role === 'super_admin'

  // ---- Filters ----
  const [siteFilter, setSiteFilter] = useState<string>('')
  const [siteDropdownOpen, setSiteDropdownOpen] = useState(false)
  const [sites, setSites] = useState<SiteOption[]>([])
  const siteDropdownRef = useRef<HTMLDivElement>(null)

  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false)
  const [categories, setCategories] = useState<EquipmentCategory[]>([])
  const categoryDropdownRef = useRef<HTMLDivElement>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // ---- Data ----
  const [equipment, setEquipment] = useState<EquipmentRow[]>([])
  const [loading, setLoading] = useState(true)

  // ---- Outside-click for dropdowns ----
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (siteDropdownRef.current && !siteDropdownRef.current.contains(e.target as Node)) {
        setSiteDropdownOpen(false)
      }
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) {
        setCategoryDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // ---- Load sites + categories ----
  useEffect(() => {
    if (!organization) return

    async function loadSites() {
      let q = supabase
        .from('sites')
        .select('id, name')
        .is('deleted_at', null)
        .order('name')
      if (!isSuperAdmin) q = q.eq('organization_id', organization!.id)
      const { data } = await q
      setSites((data || []) as SiteOption[])
    }

    async function loadCategories() {
      try {
        const res = await fetch('/api/equipment/categories', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          setCategories(Array.isArray(data) ? data : data?.categories || [])
        }
      } catch (err) {
        console.error('Failed to load equipment categories', err)
      }
    }

    loadSites()
    loadCategories()
  }, [organization, supabase, isSuperAdmin])

  // ---- Load equipment when filters change ----
  useEffect(() => {
    if (!organization) return

    async function loadEquipment() {
      setLoading(true)
      const params = new URLSearchParams()
      if (siteFilter) params.set('site_id', siteFilter)
      if (categoryFilter) params.set('category_id', categoryFilter)
      if (search.trim()) params.set('search', search.trim())
      try {
        const res = await fetch(`/api/equipment?${params.toString()}`, { cache: 'no-store' })
        if (!res.ok) {
          console.error('Equipment fetch failed', res.status)
          setEquipment([])
        } else {
          const data = await res.json()
          setEquipment((data.equipment || []) as EquipmentRow[])
        }
      } catch (err) {
        console.error('Equipment fetch error', err)
        setEquipment([])
      } finally {
        setLoading(false)
      }
    }

    loadEquipment()
  }, [organization, siteFilter, categoryFilter, search])

  // ---- Derived counts for status pills ----
  const counts = useMemo(() => {
    let dueSoon = 0
    let overdue = 0
    let byLifespan = 0
    let replaced = 0
    for (const eq of equipment) {
      const d = daysUntil(eq.next_service_due_date)
      if (d !== null && d < 0) overdue++
      else if (d !== null && d <= 30) dueSoon++
      if (eq.status === 'replaced') replaced++
      if (eq.status === 'past_lifespan') byLifespan++
    }
    return { all: equipment.length, dueSoon, overdue, byLifespan, replaced }
  }, [equipment])

  const filteredEquipment = useMemo(() => {
    if (statusFilter === 'all') return equipment
    return equipment.filter((eq) => {
      const d = daysUntil(eq.next_service_due_date)
      if (statusFilter === 'due_soon') return d !== null && d >= 0 && d <= 30
      if (statusFilter === 'overdue') return d !== null && d < 0
      if (statusFilter === 'by_lifespan') return eq.status === 'past_lifespan'
      if (statusFilter === 'replaced') return eq.status === 'replaced'
      return true
    })
  }, [equipment, statusFilter])

  const statusTabs: Array<{ value: StatusFilter; label: string; count: number; tone: 'neutral' | 'attention' | 'danger' }> = [
    { value: 'all', label: 'All', count: counts.all, tone: 'neutral' },
    { value: 'due_soon', label: 'Due Soon', count: counts.dueSoon, tone: 'attention' },
    { value: 'overdue', label: 'Overdue', count: counts.overdue, tone: 'danger' },
    { value: 'by_lifespan', label: 'By Lifespan', count: counts.byLifespan, tone: 'attention' },
    { value: 'replaced', label: 'Replaced', count: counts.replaced, tone: 'neutral' },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <PageHeader
        title="Equipment"
        subtitle="HVAC and mechanical assets registered across your client sites."
        actions={
          <>
            {canManageBatches && (
              <Button
                variant="outline"
                className="min-h-10 w-full sm:w-auto"
                onClick={() => router.push('/equipment/qr-batches')}
              >
                <QrCode className="mr-2 h-4 w-4" />
                QR Batches
              </Button>
            )}
            {canRegister && (
              <Button
                className="min-h-10 w-full sm:w-auto"
                onClick={() => router.push('/equipment/scan')}
              >
                <ScanLine className="mr-2 h-4 w-4" />
                Scan
              </Button>
            )}
          </>
        }
      />

      {/* Filter row */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
        {/* Site filter */}
        <div className="relative w-full sm:w-auto" ref={siteDropdownRef}>
          <Button
            variant="outline"
            className="w-full sm:min-w-[180px] sm:w-auto justify-between min-h-10"
            onClick={() => setSiteDropdownOpen(!siteDropdownOpen)}
          >
            <span className="flex items-center gap-2 truncate">
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate">
                {siteFilter
                  ? sites.find((s) => s.id === siteFilter)?.name || 'Site'
                  : 'All Sites'}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          </Button>
          {siteDropdownOpen && (
            <div className="absolute z-50 mt-1 w-full sm:w-[240px] rounded-md border bg-popover shadow-lg">
              <div className="max-h-[260px] overflow-y-auto p-1">
                <button
                  className={`flex w-full items-center rounded-sm px-3 py-2 text-sm hover:bg-accent ${
                    !siteFilter ? 'font-semibold bg-accent' : ''
                  }`}
                  onClick={() => {
                    setSiteFilter('')
                    setSiteDropdownOpen(false)
                  }}
                >
                  All Sites
                </button>
                {sites.map((s) => (
                  <button
                    key={s.id}
                    className={`flex w-full items-center rounded-sm px-3 py-2 text-sm hover:bg-accent ${
                      siteFilter === s.id ? 'font-semibold bg-accent' : ''
                    }`}
                    onClick={() => {
                      setSiteFilter(s.id)
                      setSiteDropdownOpen(false)
                    }}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Category filter */}
        <div className="relative w-full sm:w-auto" ref={categoryDropdownRef}>
          <Button
            variant="outline"
            className="w-full sm:min-w-[180px] sm:w-auto justify-between min-h-10"
            onClick={() => setCategoryDropdownOpen(!categoryDropdownOpen)}
          >
            <span className="flex items-center gap-2 truncate">
              <Wrench className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate">
                {categoryFilter
                  ? categories.find((c) => c.id === categoryFilter)?.name || 'Category'
                  : 'All Categories'}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          </Button>
          {categoryDropdownOpen && (
            <div className="absolute z-50 mt-1 w-full sm:w-[240px] rounded-md border bg-popover shadow-lg">
              <div className="max-h-[300px] overflow-y-auto p-1">
                <button
                  className={`flex w-full items-center rounded-sm px-3 py-2 text-sm hover:bg-accent ${
                    !categoryFilter ? 'font-semibold bg-accent' : ''
                  }`}
                  onClick={() => {
                    setCategoryFilter('')
                    setCategoryDropdownOpen(false)
                  }}
                >
                  All Categories
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    className={`flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent ${
                      categoryFilter === c.id ? 'font-semibold bg-accent' : ''
                    }`}
                    onClick={() => {
                      setCategoryFilter(c.id)
                      setCategoryDropdownOpen(false)
                    }}
                  >
                    <span>{(c.icon as string | null) || '🛠️'}</span>
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="relative w-full sm:flex-1 sm:min-w-[200px] sm:max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search make, model, serial…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10"
          />
        </div>
      </div>

      {/* Status pills */}
      <div className="flex flex-wrap gap-2">
        {statusTabs.map((tab) => {
          const active = statusFilter === tab.value
          const baseClass =
            'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium border transition-colors'
          let toneClass = ''
          if (active) {
            toneClass = 'bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-800'
          } else if (tab.tone === 'danger' && tab.count > 0) {
            toneClass = 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
          } else if (tab.tone === 'attention' && tab.count > 0) {
            toneClass = 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'
          } else {
            toneClass = 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
          }
          const badgeClass = active
            ? 'bg-white/20 text-white'
            : tab.tone === 'danger' && tab.count > 0
            ? 'bg-red-200 text-red-900'
            : tab.tone === 'attention' && tab.count > 0
            ? 'bg-amber-200 text-amber-900'
            : 'bg-zinc-100 text-zinc-600'

          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatusFilter(tab.value)}
              className={`${baseClass} ${toneClass}`}
            >
              {tab.value === 'overdue' && tab.count > 0 && !active && (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
              <span>{tab.label}</span>
              <span
                className={`inline-flex items-center justify-center rounded-full px-1.5 min-w-[1.25rem] h-5 text-xs font-semibold ${badgeClass}`}
              >
                {tab.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Loading — content-shaped skeleton instead of a centered spinner */}
      {loading && <SkeletonList rows={6} />}

      {/* Empty */}
      {!loading && filteredEquipment.length === 0 && (
        <EmptyState
          icon={Wrench}
          title="No equipment yet"
          description={
            canRegister
              ? 'Scan a QR sticker from a unit to register your first piece of equipment.'
              : 'Equipment will appear here once your techs register units in the field.'
          }
          action={
            canRegister && (
              <Button onClick={() => router.push('/equipment/scan')}>
                <Plus className="mr-2 h-4 w-4" />
                Scan to register
              </Button>
            )
          }
        />
      )}

      {/* Mobile cards (default) / Desktop table (lg+) */}
      {!loading && filteredEquipment.length > 0 && (
        <>
          {/* Mobile / tablet cards */}
          <div className="space-y-3 md:hidden">
            {filteredEquipment.map((eq) => {
              const d = daysUntil(eq.next_service_due_date)
              const chip = dueChip(d)
              const makeModel = [eq.make, eq.model].filter(Boolean).join(' ') || 'No make/model'
              return (
                <Card
                  key={eq.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => router.push(`/equipment/${eq.id}`)}
                >
                  <CardContent className="flex items-start gap-3 py-4">
                    <div className="text-2xl shrink-0">{categoryIcon(eq)}</div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">
                          {eq.category?.name || 'Equipment'}
                        </span>
                        {chip && (
                          <Badge variant="outline" className={chip.className}>
                            {chip.label}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {locationLabel(eq)}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{makeModel}</p>
                      {eq.parent_equipment_id && eq.parent && (
                        <p className="text-[11px] text-blue-600">
                          Part of: {eq.parent.make || ''} {eq.parent.model || ''} {eq.parent.unit_number || ''}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block">
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Location</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Make / Model</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Next Service</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Parent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEquipment.map((eq) => {
                      const d = daysUntil(eq.next_service_due_date)
                      const chip = dueChip(d)
                      return (
                        <tr
                          key={eq.id}
                          className="border-t hover:bg-zinc-50 cursor-pointer"
                          onClick={() => router.push(`/equipment/${eq.id}`)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{categoryIcon(eq)}</span>
                              <span className="font-medium">{eq.category?.name || 'Equipment'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {locationLabel(eq)}
                          </td>
                          <td className="px-4 py-3">
                            {[eq.make, eq.model].filter(Boolean).join(' ') || '—'}
                          </td>
                          <td className="px-4 py-3">
                            {chip ? (
                              <Badge variant="outline" className={chip.className}>
                                <Calendar className="h-3 w-3 mr-1" />
                                {chip.label}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {eq.parent_equipment_id && eq.parent ? (
                              <Link
                                href={`/equipment/${eq.parent_equipment_id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-blue-600 hover:underline"
                              >
                                {eq.parent.make || ''} {eq.parent.model || ''} {eq.parent.unit_number || ''}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
