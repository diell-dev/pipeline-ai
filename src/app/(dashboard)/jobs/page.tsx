'use client'

/**
 * Jobs List Page
 *
 * - Field Techs: see only their own submitted jobs
 * - Office Manager / Owner / Super Admin: see all org jobs
 * - Client: see jobs associated with their client record (future)
 *
 * Links to /jobs/new for job creation.
 */
import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  ClipboardList,
  Plus,
  Loader2,
  MapPin,
  Calendar,
  AlertTriangle,
  Eye,
  ChevronDown,
  Building2,
} from 'lucide-react'
import type { Job, JobStatus, JobPriority } from '@/types/database'

// Status badge colors
const STATUS_CONFIG: Record<JobStatus, { label: string; className: string }> = {
  submitted: { label: 'Submitted', className: 'bg-blue-100 text-blue-700' },
  ai_generating: { label: 'AI Processing', className: 'bg-purple-100 text-purple-700' },
  pending_review: { label: 'Pending Review', className: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Approved', className: 'bg-green-100 text-green-700' },
  sent: { label: 'Sent to Client', className: 'bg-teal-100 text-teal-700' },
  revision_requested: { label: 'Revision Requested', className: 'bg-orange-100 text-orange-700' },
  revised: { label: 'Revised', className: 'bg-indigo-100 text-indigo-700' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700' },
  completed: { label: 'Completed', className: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'Cancelled', className: 'bg-zinc-100 text-zinc-500' },
}

const PRIORITY_CONFIG: Record<JobPriority, { label: string; className: string }> = {
  normal: { label: 'Normal', className: 'bg-zinc-100 text-zinc-600' },
  urgent: { label: 'Urgent', className: 'bg-amber-100 text-amber-700' },
  emergency: { label: 'Emergency', className: 'bg-red-100 text-red-700' },
}

interface JobWithRelations extends Job {
  clients?: { company_name: string } | null
  sites?: { name: string; address: string } | null
  submitter?: { full_name: string } | null
}

export default function JobsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, organization } = useAuthStore()
  const canCreate = user?.role ? hasPermission(user.role, 'jobs:create') : false
  const canViewAll = user?.role ? hasPermission(user.role, 'jobs:view_all') : false

  const [jobs, setJobs] = useState<JobWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | JobStatus>('all')
  const [clients, setClients] = useState<{ id: string; company_name: string }[]>([])
  const [selectedClient, setSelectedClient] = useState<string>(searchParams.get('client') || '')
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false)
  const clientFilter = selectedClient || searchParams.get('client')
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setClientDropdownOpen(false)
      }
    }
    if (clientDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [clientDropdownOpen])

  // Load clients for dropdown
  useEffect(() => {
    if (!organization) return
    async function loadClients() {
      const supabase = createClient()
      const { data } = await supabase
        .from('clients')
        .select('id, company_name')
        .eq('organization_id', organization!.id)
        .is('deleted_at', null)
        .order('company_name')
      setClients(data || [])
    }
    loadClients()
  }, [organization])

  useEffect(() => {
    if (!organization || !user) return

    async function loadJobs() {
      setLoading(true)
      const supabase = createClient()

      let query = supabase
        .from('jobs')
        .select(`
          *,
          clients:client_id ( company_name ),
          sites:site_id ( name, address ),
          submitter:submitted_by ( full_name )
        `)
        .eq('organization_id', organization!.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      // Field techs only see their own jobs
      if (!canViewAll) {
        query = query.eq('submitted_by', user!.id)
      }

      // Client filter from query param
      if (clientFilter) {
        query = query.eq('client_id', clientFilter)
      }

      // Status filter
      if (filter !== 'all') {
        query = query.eq('status', filter)
      }

      const { data, error } = await query.limit(50)

      if (error) {
        console.error('Failed to load jobs:', error.message)
      } else {
        setJobs((data as JobWithRelations[]) || [])
      }
      setLoading(false)
    }

    loadJobs()
  }, [organization, user, canViewAll, filter, clientFilter])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {canViewAll ? 'All Jobs' : 'My Jobs'}
          </h1>
          <p className="text-muted-foreground text-sm">
            {canViewAll
              ? 'Manage field service jobs, submissions, and approvals.'
              : 'Your submitted jobs and their current status.'}
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => router.push('/jobs/new')}>
            <Plus className="mr-2 h-4 w-4" />
            New Job
          </Button>
        )}
      </div>

      {/* Filters row: Client dropdown + Status tabs */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Client dropdown */}
        <div className="relative" ref={dropdownRef}>
          <Button
            variant="outline"
            size="sm"
            className="min-w-[200px] justify-between"
            onClick={() => setClientDropdownOpen(!clientDropdownOpen)}
          >
            <span className="flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              {selectedClient
                ? clients.find((c) => c.id === selectedClient)?.company_name || 'Client'
                : 'All Clients'}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
          {clientDropdownOpen && (
            <div className="absolute z-50 mt-1 w-[240px] rounded-md border bg-popover shadow-lg">
              <div className="max-h-[260px] overflow-y-auto p-1">
                <button
                  className={`flex w-full items-center rounded-sm px-3 py-2 text-sm hover:bg-accent ${
                    !selectedClient ? 'font-semibold bg-accent' : ''
                  }`}
                  onClick={() => {
                    setSelectedClient('')
                    setClientDropdownOpen(false)
                  }}
                >
                  All Clients
                </button>
                {clients.map((client) => (
                  <button
                    key={client.id}
                    className={`flex w-full items-center rounded-sm px-3 py-2 text-sm hover:bg-accent ${
                      selectedClient === client.id ? 'font-semibold bg-accent' : ''
                    }`}
                    onClick={() => {
                      setSelectedClient(client.id)
                      setClientDropdownOpen(false)
                    }}
                  >
                    {client.company_name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2">
        {[
          { value: 'all', label: 'All' },
          { value: 'submitted', label: 'Submitted' },
          { value: 'ai_generating', label: 'AI Processing' },
          { value: 'pending_review', label: 'Pending Review' },
          { value: 'approved', label: 'Approved' },
          { value: 'sent', label: 'Sent' },
          { value: 'completed', label: 'Completed' },
        ].map((tab) => (
          <Button
            key={tab.value}
            variant={filter === tab.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(tab.value as typeof filter)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && jobs.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <ClipboardList className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-1">
              {filter !== 'all' ? 'No jobs with this status' : 'No jobs yet'}
            </h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              {canCreate
                ? 'Click "New Job" to submit your first field service job.'
                : 'Jobs will appear here once submitted.'}
            </p>
            {canCreate && (
              <Button className="mt-4" onClick={() => router.push('/jobs/new')}>
                <Plus className="mr-2 h-4 w-4" />
                Submit First Job
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Job list */}
      {!loading && jobs.length > 0 && (
        <div className="space-y-3">
          {jobs.map((job) => {
            const statusConf = STATUS_CONFIG[job.status]
            const priorityConf = PRIORITY_CONFIG[job.priority]
            return (
              <Card
                key={job.id}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => router.push(`/jobs/${job.id}`)}
              >
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {job.clients?.company_name || 'Unknown Client'}
                      </span>
                      <Badge className={statusConf.className} variant="outline">
                        {statusConf.label}
                      </Badge>
                      {job.priority !== 'normal' && (
                        <Badge className={priorityConf.className} variant="outline">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          {priorityConf.label}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {job.sites?.name || 'Unknown Site'}
                        {job.sites?.address ? ` — ${job.sites.address}` : ''}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(job.service_date).toLocaleDateString()}
                      </span>
                    </div>
                    {canViewAll && job.submitter && (
                      <p className="text-xs text-muted-foreground">
                        Submitted by {job.submitter.full_name}
                      </p>
                    )}
                    {job.photos && job.photos.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {job.photos.length} photo{job.photos.length !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" className="shrink-0 ml-2">
                    <Eye className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
