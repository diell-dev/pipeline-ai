'use client'

/**
 * EmptyState — Phase C shared component
 *
 * Replaces the ad-hoc "Card with centered icon + heading + helper + CTA"
 * pattern that was duplicated across /clients, /proposals, /equipment, etc.
 *
 * Usage:
 *   <EmptyState
 *     icon={Building2}
 *     title="No clients yet"
 *     description="Add your first client to start tracking sites, equipment, and jobs."
 *     action={
 *       <Button onClick={onAdd}>
 *         <Plus className="mr-2 h-4 w-4" />
 *         Add Client
 *       </Button>
 *     }
 *   />
 *
 * For "no search results" (vs "no data ever") prefer the same component
 * with different copy and no `action`, so the visual rhythm of the page
 * stays consistent regardless of the empty-state reason.
 */
import * as React from 'react'
import type { LucideIcon } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  /** When false, renders without the surrounding Card (useful when nesting). */
  card?: boolean
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  card = true,
  className,
}: EmptyStateProps) {
  const body = (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center py-16 px-6',
        className
      )}
    >
      {Icon && (
        <div className="mb-4 rounded-full bg-muted/60 p-3 ring-1 ring-border/60">
          <Icon className="h-7 w-7 text-muted-foreground/80" aria-hidden="true" />
        </div>
      )}
      <h3 className="font-heading text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h3>
      {description && (
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )

  if (!card) return body

  return (
    <Card>
      <CardContent className="p-0">{body}</CardContent>
    </Card>
  )
}
