"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

interface LabelProps extends React.ComponentProps<"label"> {
  /** When true, renders a small red asterisk after the label text. */
  required?: boolean
}

function Label({ className, children, required, ...props }: LabelProps) {
  return (
    <label
      data-slot="label"
      data-required={required ? "true" : undefined}
      className={cn(
        // Slightly looser line-height than `leading-none` so descenders
        // don't get clipped against the input below.
        "flex items-center gap-1.5 text-sm leading-tight font-medium text-foreground select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      {required && (
        <span
          aria-hidden="true"
          className="text-destructive leading-none"
          title="Required"
        >
          *
        </span>
      )}
    </label>
  )
}

export { Label }
