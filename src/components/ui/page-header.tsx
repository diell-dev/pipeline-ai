'use client'

/**
 * PageHeader — Phase C shared component
 *
 * Standardizes the title strip used by every dashboard page. Before this,
 * every page hand-rolled a `flex flex-col sm:flex-row…` block with the same
 * h1 + p combo and the same right-aligned actions slot. They drifted apart
 * (some 2xl, some 3xl, some used `<h1>`, some `<h2>`, some left actions
 * un-wrapped on mobile, etc.).
 *
 * Usage:
 *   <PageHeader
 *     title="Clients"
 *     subtitle="Manage client accounts, contacts, and sites."
 *     actions={<Button>Add Client</Button>}
 *   />
 *
 * Breadcrumb support is optional and renders above the title row.
 */
import * as React from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface PageHeaderCrumb {
  label: string
  /** When omitted, the crumb renders as plain text (current page). */
  href?: string
}

interface PageHeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Right-hand action slot — typically one or more <Button>s. */
  actions?: React.ReactNode
  /** Optional breadcrumb trail rendered above the title. */
  breadcrumb?: PageHeaderCrumb[]
  /** Extra classes on the outer wrapper. */
  className?: string
}

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-1">
            {breadcrumb.map((crumb, idx) => {
              const isLast = idx === breadcrumb.length - 1
              return (
                <li key={`${crumb.label}-${idx}`} className="flex items-center gap-1">
                  {crumb.href && !isLast ? (
                    <Link
                      href={crumb.href}
                      // M3: explicit color-only transition + strong ease-out
                      // so the breadcrumb hover settles cleanly.
                      className="transition-[color] duration-150 ease-out-strong hover:text-foreground"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className={isLast ? 'text-foreground font-medium' : ''}>
                      {crumb.label}
                    </span>
                  )}
                  {!isLast && (
                    <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
                  )}
                </li>
              )
            })}
          </ol>
        </nav>
      )}

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="font-heading text-2xl font-bold tracking-tight leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            {actions}
          </div>
        )}
      </div>
    </header>
  )
}
