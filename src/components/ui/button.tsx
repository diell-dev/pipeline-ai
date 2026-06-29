import * as React from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Emil Kowalski playbook applied (M3):
  //   - `transition-[transform,background-color,color,box-shadow,border-color]`
  //     instead of `transition-all` (never animate layout properties).
  //   - `ease-out-strong` custom curve from design tokens — built-in ease-out
  //     looks weak at the exact moment the user is watching the press.
  //   - `motion-safe:active:scale-[0.97]` + sub-pixel translateY for tactile
  //     press feedback. Transform-only so no reflow.
  //   - Duration capped at 160ms (Emil's "button press" budget).
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[transform,background-color,color,box-shadow,border-color,opacity] duration-150 ease-out-strong outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px motion-safe:active:not-aria-[haspopup]:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
        // Brand variant pulls from the per-tenant CSS variables set by
        // BrandProvider. Use for primary CTAs (New Job, New Proposal, etc.).
        brand:
          "bg-brand-primary [a]:hover:opacity-90 hover:opacity-90 focus-visible:ring-[rgb(var(--brand-primary-rgb)/0.4)]",
      },
      size: {
        // Default size bumped to h-10 (40px) for mobile tap targets. iOS HIG
        // recommends a minimum of 44pt; 40px is the closest we can get
        // without making desktop look chunky. Tighter spots can opt down
        // to `sm` (h-7) or `xs` (h-6).
        default:
          "h-10 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

interface ButtonProps
  extends ButtonPrimitive.Props,
    VariantProps<typeof buttonVariants> {
  /**
   * Phase F (F8): when true, render an absolutely-positioned spinner over
   * the existing children and fade the label to opacity-0. The button keeps
   * its original width, so the layout never shifts when an action transitions
   * to its loading state. Also auto-disables the button to prevent double
   * submits.
   *
   * Replaces the consumer-side `{saving ? <Loader2/> : "Save"}` pattern that
   * caused width-jumps. Existing call sites work unchanged — opt-in only.
   */
  loading?: boolean
}

function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  // Non-loading buttons render children directly so the existing layout,
  // gap, and icon-only sizing remain pixel-perfect.
  if (!loading) {
    return (
      <ButtonPrimitive
        data-slot="button"
        disabled={disabled}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      >
        {children}
      </ButtonPrimitive>
    )
  }

  // Loading: wrap children in a "ghosted" layout span (kept in flow so the
  // button keeps its natural width) and overlay an absolutely-positioned
  // spinner. No width-shift between idle and loading states.
  return (
    <ButtonPrimitive
      data-slot="button"
      data-loading="true"
      aria-busy="true"
      disabled
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      <span className="pointer-events-none inline-flex items-center justify-center gap-1.5 opacity-0">
        {children}
      </span>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <Loader2 className="motion-safe:animate-spin" />
      </span>
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
export type { ButtonProps }
