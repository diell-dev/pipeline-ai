"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        // Slightly darker backdrop + soft blur reads as "modal" without
        // becoming visually heavy. Phase C polish.
        "fixed inset-0 isolate z-50 bg-black/40 duration-150 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * Phase C dialog content.
 *
 * Key changes vs Phase B:
 *  - Mobile: docks to the bottom edge as a sheet (slides up). Desktop:
 *    centered modal as before. Driven by responsive layout utilities only —
 *    no Radix variants needed.
 *  - The popup is a flex column with `max-h-[90dvh]` so the header + footer
 *    can sit flush while the body scrolls between them. Children use
 *    `DialogBody` to opt into the scrolling region; legacy children that
 *    don't use DialogBody still render fine (they just don't get a sticky
 *    footer — same as before).
 *  - `max-w` defaults to `sm:max-w-md` for plain confirm dialogs. Forms
 *    that need more room can pass their own `max-w-2xl` / `max-w-lg`.
 *  - Increased padding rhythm: header gets a touch more top breathing room,
 *    footer hugs the bottom edge as before.
 *  - Open animation: subtle scale + fade rather than a hard snap.
 */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // Layout: full-width bottom sheet on mobile, centered modal at sm+.
          // The fixed/translate positioning is applied at sm+ only so mobile
          // can dock to the bottom edge with a slide-up animation.
          "fixed left-0 right-0 bottom-0 z-50 flex w-full max-h-[92dvh] flex-col gap-4 rounded-t-2xl bg-popover p-4 pb-[max(env(safe-area-inset-bottom),1rem)] text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none",
          // Desktop: re-anchor to center, default narrow width (consumers
          // can override with sm:max-w-lg / sm:max-w-2xl), fully rounded.
          "sm:left-1/2 sm:top-1/2 sm:right-auto sm:bottom-auto sm:w-[calc(100%-2rem)] sm:max-w-md sm:max-h-[88dvh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-5 sm:pb-5",
          // Animations: mobile slides up from the bottom, desktop fades+scales
          "duration-200 ease-out data-open:animate-in data-closed:animate-out",
          "data-open:slide-in-from-bottom data-closed:slide-out-to-bottom",
          "sm:data-open:slide-in-from-bottom-0 sm:data-closed:slide-out-to-bottom-0",
          "data-open:fade-in-0 data-closed:fade-out-0",
          "sm:data-open:zoom-in-95 sm:data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        // Slightly more vertical breathing room above the title, gutter for
        // the close button so it doesn't crowd the text.
        "flex flex-col gap-1.5 pr-8",
        className
      )}
      {...props}
    />
  )
}

/**
 * Optional scrolling body region for long forms. When used, content scrolls
 * between the (sticky) header and (sticky) footer. The negative horizontal
 * margins extend the scroll area to the dialog edges so the scrollbar sits
 * where it visually belongs.
 */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        "-mx-4 sm:-mx-5 flex-1 overflow-y-auto px-4 sm:px-5",
        className
      )}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // Pinned to the bottom of the dialog (sticky-by-flex), with a
        // subtle separator + muted bg so the action row reads as a system
        // surface, not body content.
        "-mx-4 -mb-4 sm:-mx-5 sm:-mb-5 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/40 p-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:flex-row sm:justify-end sm:p-4 sm:pb-4",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        // Slightly larger title — was text-base, bumped to text-lg for
        // hierarchy now that we have proper headings type tokens.
        "font-heading text-lg leading-tight font-semibold tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
