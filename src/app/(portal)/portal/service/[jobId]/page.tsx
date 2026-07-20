'use client'

/** Job detail — the AI service report + photos for one of the client's jobs. */
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { PortalStatus } from '@/components/portal/portal-status'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/books/format'
import { ArrowLeft, MapPin, ImageOff } from 'lucide-react'
import { useSignedPhotos } from '@/hooks/use-signed-photos'

interface Report { intro?: string; services_performed?: string[]; findings?: string[]; summary?: string; work_performed?: string[]; recommendations?: string[]; tech_notes_raw?: string }
interface JobDetail {
  id: string; service_date: string; status: string; photos: string[] | null
  ai_report_content: Report | null
  sites: { name: string | null; address: string | null } | null
}

export default function PortalJobDetail() {
  const params = useParams<{ jobId: string }>()
  const router = useRouter()
  const { user } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [job, setJob] = useState<JobDetail | null>(null)

  useEffect(() => {
    if (!user?.client_id) return
    ;(async () => {
      setLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('jobs')
        .select('id, service_date, status, photos, ai_report_content, sites(name,address)')
        .eq('id', params.jobId)
        .maybeSingle<JobDetail>()
      setJob(data ?? null)
      setLoading(false)
    })()
  }, [params.jobId, user?.client_id])

  if (loading) return <div className="space-y-4"><Skeleton className="h-8 w-40" /><Skeleton className="h-64 w-full" /></div>
  if (!job) return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={() => router.push('/portal/service')}><ArrowLeft className="mr-1.5 h-4 w-4" />Back</Button>
      <p className="text-sm text-muted-foreground">This service record isn&apos;t available.</p>
    </div>
  )

  const r = job.ai_report_content || {}
  const services = r.services_performed ?? r.work_performed ?? []
  const findings = r.findings ?? []
  const photos = job.photos ?? []

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => router.push('/portal/service')} className="-ml-2">
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Service history
      </Button>

      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">{job.sites?.name || 'Service visit'}</h1>
          <PortalStatus kind="job" status={job.status} />
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" /> {job.sites?.address || 'N/A'} · {formatDate(job.service_date)}
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <h2 className="text-sm font-semibold text-foreground">Service report</h2>
          {r.intro || r.summary ? <p className="text-sm leading-relaxed text-muted-foreground">{r.intro || r.summary}</p> : null}
          {services.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">Services performed</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">{services.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {findings.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">Findings</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">{findings.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {r.recommendations && r.recommendations.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">Recommendations</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">{r.recommendations.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {services.length === 0 && findings.length === 0 && !r.intro && !r.summary && (
            <p className="text-sm text-muted-foreground">The full report for this visit isn&apos;t available yet.</p>
          )}
        </CardContent>
      </Card>

      {photos.length > 0 && <PortalPhotoGrid photos={photos} />}
    </div>
  )
}

/**
 * S1: job-photos is a private bucket, so the stored refs are exchanged for
 * short-lived signed URLs. The signing endpoint re-checks — against this
 * client's own RLS — that the owning job is actually theirs, so a client can
 * never pull another customer's property photos.
 */
function PortalPhotoGrid({ photos }: { photos: string[] }) {
  const { signed } = useSignedPhotos(photos)

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-foreground">Photos</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {photos.map((ref, i) => {
          const url = signed[ref]

          if (url === undefined) {
            return (
              <div
                key={i}
                className="aspect-square w-full animate-pulse rounded-lg border bg-muted"
              />
            )
          }

          if (url === null) {
            return (
              <div
                key={i}
                className="flex aspect-square w-full items-center justify-center rounded-lg border bg-muted"
                title="This photo is unavailable"
              >
                <ImageOff className="h-5 w-5 text-muted-foreground/50" />
              </div>
            )
          }

          return (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-lg border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Service photo ${i + 1}`}
                className="aspect-square w-full object-cover transition-transform hover:scale-105"
                loading="lazy"
              />
            </a>
          )
        })}
      </div>
    </div>
  )
}
