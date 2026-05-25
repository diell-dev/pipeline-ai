import { cn } from "@/lib/utils"

/**
 * Skeleton — content-shape loading placeholder.
 *
 * Use anywhere a list/card/detail page is fetching its data instead of a
 * centered <Loader2 /> spinner. Shape the skeleton like the content that's
 * coming so the page doesn't jump on load.
 *
 * Spinners (Loader2) are reserved for inline action loading (button
 * loading states, dialog "Save" buttons). For everything else — pages,
 * cards, lists — reach for <Skeleton />.
 *
 * Variants:
 *   <Skeleton className="h-4 w-32" />              — text line
 *   <Skeleton className="h-9 w-9 rounded-full" />  — avatar
 *   <Skeleton className="h-24 w-full rounded-xl" />— card
 *
 * Helper components (SkeletonText / SkeletonCard / SkeletonRow) cover the
 * three most common shapes so calling code stays one-liner.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "relative overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800",
        // Shimmer overlay — purely decorative, motion-safe only.
        "before:absolute before:inset-0 before:-translate-x-full",
        "before:bg-gradient-to-r before:from-transparent before:via-white/60 before:to-transparent",
        "before:motion-safe:animate-[shimmer_1.6s_ease-in-out_infinite]",
        "dark:before:via-white/5",
        // Fallback pulse for prefers-reduced-motion users.
        "motion-reduce:animate-pulse",
        className
      )}
      {...props}
    />
  )
}

/**
 * Multi-line text skeleton. Last line is shorter to mimic a paragraph end.
 */
function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number
  className?: string
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  )
}

/**
 * Card-shaped skeleton — for KPI loading, dashboard widget loading.
 */
function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-200 bg-white p-4 space-y-3 dark:border-zinc-800 dark:bg-zinc-900",
        className
      )}
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  )
}

/**
 * Row-shaped skeleton — for list loading (jobs, invoices, clients).
 * Renders inside a Card so it matches the surrounding row visual.
 */
function SkeletonRow({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900",
        className
      )}
    >
      <Skeleton className="h-10 w-10 rounded-full shrink-0" />
      <div className="flex-1 space-y-2 min-w-0">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <Skeleton className="h-6 w-16 shrink-0" />
    </div>
  )
}

/**
 * List of N row skeletons — most common list-loading shape.
 */
function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  )
}

export { Skeleton, SkeletonText, SkeletonCard, SkeletonRow, SkeletonList }
