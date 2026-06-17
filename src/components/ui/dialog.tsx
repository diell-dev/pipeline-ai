"use client"

/**
 * Responsive Dialog primitive (M2.2)
 *
 * Same API as before — `<Dialog>`, `<DialogTrigger>`, `<DialogContent>`,
 * `<DialogHeader>`, `<DialogTitle>`, `<DialogDescription>`, `<DialogFooter>`,
 * `<DialogBody>` — but the rendering implementation changes by viewport:
 *
 *   ≥640px (sm and up): Base UI centered Dialog (the existing behavior)
 *   <640px (mobile):    Vaul bottom Drawer with drag handle, drag-to-dismiss,
 *                       iOS-native drawer curve, snap points (when provided),
 *                       and safe-area-inset-bottom padding
 *
 * Consumers don't change anything. The switch is gated by
 * `useMediaQuery('(min-width: 640px)')` and falls back to mobile drawer
 * during SSR / first paint — that's correct on mobile and gets corrected
 * to desktop after the first effect tick before the user can interact.
 *
 * Snap points: pass `snapPoints={[0.4, 0.85, 1]}` (or any array) on
 * `<DialogContent>` for long forms (Edit Equipment / Schedule Work Order).
 * Omit for content-height drawers (the default).
 */
import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { useMediaQuery } from "@/hooks/use-media-query"

// ─────────────────────────────────────────────────────────────────────────
// Context — lets descendants (Content / Trigger / Close) know whether
// they're rendering inside a Base UI Dialog or a Vaul Drawer, so they can
// pick the right slot primitive.
// ─────────────────────────────────────────────────────────────────────────

type DialogMode = "drawer" | "dialog"

type DialogContextValue = {
  mode: DialogMode
  /** Snap points active for the current drawer (mobile only, null on desktop) */
  snapPoints?: (string | number)[]
}

const DialogContext = React.createContext<DialogContextValue>({
  mode: "dialog",
})

function useDialogContext(): DialogContextValue {
  return React.useContext(DialogContext)
}

function useDialogMode(): DialogMode {
  return useDialogContext().mode
}

// ─────────────────────────────────────────────────────────────────────────
// Root — picks Drawer (mobile) vs Dialog (desktop) and seeds the context.
// We forward only the props each implementation understands.
// ─────────────────────────────────────────────────────────────────────────

type DialogRootProps = DialogPrimitive.Root.Props & {
  /**
   * Force the drawer or dialog implementation regardless of viewport.
   * Default: `undefined` (responsive — drawer below 640px, dialog above).
   */
  forceMode?: DialogMode
  /**
   * Mobile-only — Vaul snap points (e.g. `[0.4, 0.85, 1]` for an Edit form
   * that should peek, sit comfortably, then go full screen). Ignored on
   * desktop. When omitted the drawer is content-height.
   *
   * Pass this on the `<Dialog>` root rather than `<DialogContent>` so
   * Vaul's Root component (which must own the snap state) sees it.
   */
  snapPoints?: (string | number)[]
}

function Dialog({ forceMode, snapPoints, ...props }: DialogRootProps) {
  const isDesktop = useMediaQuery("(min-width: 640px)")
  const mode: DialogMode = forceMode ?? (isDesktop ? "dialog" : "drawer")

  // Active snap is held at the Root because Vaul requires the controlled
  // `activeSnapPoint` to live with `Drawer.Root`. We default to the
  // second-to-last (the "comfortable" sit) — usually 85%.
  const initialActiveSnap = snapPoints
    ? snapPoints[Math.min(1, snapPoints.length - 1)]
    : null
  const [activeSnap, setActiveSnap] = React.useState<string | number | null>(
    initialActiveSnap
  )

  if (mode === "drawer") {
    // Base UI's `onOpenChange` carries `(open, details)`; Vaul / Radix
    // wants `(open)` — drop the second arg on the way through. We also
    // reset the active snap on close so the next open starts at the
    // default sit-comfortable point.
    const onOpenChange = (open: boolean) => {
      if (!open && snapPoints) {
        setActiveSnap(initialActiveSnap)
      }
      if (props.onOpenChange) {
        ;(props.onOpenChange as (open: boolean) => void)(open)
      }
    }

    // Base UI `modal` can be `"trap-focus"`; map to `true` for Vaul.
    const modal =
      typeof props.modal === "boolean" ? props.modal : props.modal != null

    return (
      <DialogContext.Provider value={{ mode: "drawer", snapPoints }}>
        <DrawerPrimitive.Root
          open={props.open}
          defaultOpen={props.defaultOpen}
          onOpenChange={onOpenChange}
          modal={modal}
          {...(snapPoints
            ? {
                snapPoints,
                activeSnapPoint: activeSnap,
                setActiveSnapPoint: setActiveSnap,
              }
            : {})}
        >
          {props.children as React.ReactNode}
        </DrawerPrimitive.Root>
      </DialogContext.Provider>
    )
  }

  return (
    <DialogContext.Provider value={{ mode: "dialog" }}>
      <DialogPrimitive.Root data-slot="dialog" {...props} />
    </DialogContext.Provider>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Trigger / Portal / Close — pick the right slot based on context.
// ─────────────────────────────────────────────────────────────────────────

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  const mode = useDialogMode()
  if (mode === "drawer") {
    // Vaul Trigger expects Radix's prop shape; Base UI's wider types
    // (function children, function className) are pruned here.
    return (
      <DrawerPrimitive.Trigger
        data-slot="dialog-trigger"
        {...(props as React.ComponentProps<typeof DrawerPrimitive.Trigger>)}
      />
    )
  }
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal(props: DialogPrimitive.Portal.Props) {
  const mode = useDialogMode()
  if (mode === "drawer") {
    return (
      <DrawerPrimitive.Portal
        data-slot="dialog-portal"
        {...(props as React.ComponentProps<typeof DrawerPrimitive.Portal>)}
      />
    )
  }
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  const mode = useDialogMode()
  if (mode === "drawer") {
    return (
      <DrawerPrimitive.Close
        data-slot="dialog-close"
        {...(props as React.ComponentProps<typeof DrawerPrimitive.Close>)}
      />
    )
  }
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

// ─────────────────────────────────────────────────────────────────────────
// Overlay — backdrop for desktop dialog. Vaul ships its own.
// ─────────────────────────────────────────────────────────────────────────

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/40 duration-150 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Content — the heavy lifter. Two branches: drawer vs dialog.
// ─────────────────────────────────────────────────────────────────────────

type DialogContentProps = DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  /**
   * @deprecated Pass `snapPoints` on the `<Dialog>` root instead — Vaul's
   * snap-point state lives on its Root component, so the prop on Content
   * is just forwarded up. Kept here only so legacy callers don't break.
   */
  snapPoints?: (string | number)[]
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogContentProps) {
  const mode = useDialogMode()

  if (mode === "drawer") {
    // Drawer doesn't accept Base UI's function-className shape; narrow it
    // to a plain string for the mobile branch.
    const flatClassName = typeof className === "function" ? undefined : className
    return (
      <MobileDrawerContent
        className={flatClassName}
        showCloseButton={showCloseButton}
      >
        {children as React.ReactNode}
      </MobileDrawerContent>
    )
  }

  return (
    <DesktopDialogContent
      className={className}
      showCloseButton={showCloseButton}
      {...props}
    >
      {children}
    </DesktopDialogContent>
  )
}

/**
 * Mobile bottom-sheet body — Vaul Drawer.
 *
 * Uses Vaul's built-in iOS-curve animation (cubic-bezier(0.32, 0.72, 0, 1))
 * and drag-to-dismiss physics with momentum. The drag handle, backdrop
 * blur, and safe-area inset are all hand-tuned to match Apple's sheet
 * presentation.
 */
function MobileDrawerContent({
  className,
  children,
  showCloseButton,
}: {
  className?: string
  children?: React.ReactNode
  showCloseButton?: boolean
}) {
  return (
    <DrawerPrimitive.Portal data-slot="dialog-portal">
      <DrawerPrimitive.Overlay
        data-slot="dialog-overlay"
        className="fixed inset-0 z-50 bg-black/40 supports-backdrop-filter:backdrop-blur-sm"
      />
      <DrawerPrimitive.Content
        data-slot="dialog-content"
        data-vaul-drawer
        // Vaul sets transform itself; we keep the layout / surface styles.
        // The drag handle is rendered as a child below so it sits inside
        // the rounded top of the sheet. Snap-point props live on
        // `Drawer.Root`, not here — passed via the `snapPoints` prop on
        // `<Dialog>` itself.
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl bg-popover text-sm text-popover-foreground outline-none ring-1 ring-foreground/10",
          // Padding rhythm matches desktop dialog (p-4) so DialogHeader /
          // DialogBody / DialogFooter internal spacing reads the same.
          "p-4 pb-[max(env(safe-area-inset-bottom),1rem)]",
          className
        )}
      >
        {/* Drag handle bar — 36×4 rounded muted, hand-placed so it lives
            inside the rounded sheet top. The clickable area is larger for
            accessibility (py-2) but the visible bar stays at 4px tall. */}
        <div
          aria-hidden
          className="-mt-1 mb-3 flex shrink-0 cursor-grab items-center justify-center py-2 active:cursor-grabbing"
        >
          <div className="h-1 w-9 rounded-full bg-muted-foreground/30" />
        </div>

        {children}

        {showCloseButton && (
          <DrawerPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DrawerPrimitive.Close>
        )}
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  )
}

/**
 * Desktop dialog body — preserves the original Phase C/F look exactly:
 * centered modal with spring-overshoot open animation.
 */
function DesktopDialogContent({
  className,
  children,
  showCloseButton,
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
          // Centered modal (desktop). Mobile classes from the old responsive
          // implementation are dropped here since mobile is now Vaul.
          "fixed left-1/2 top-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md max-h-[88dvh] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl bg-popover p-5 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none",
          // Open / close animation — spring overshoot, see globals.css.
          "duration-200 ease-out data-open:animate-in data-closed:animate-out",
          "data-open:fade-in-0 data-closed:fade-out-0",
          "data-open:zoom-in-95 data-closed:zoom-out-95",
          "dialog-spring-open",
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

// ─────────────────────────────────────────────────────────────────────────
// Header / Body / Footer / Title / Description — these are pure layout
// wrappers and don't depend on dialog vs drawer mode. The DialogTitle /
// DialogDescription DO need to route to the drawer primitive on mobile
// so Vaul can announce them to screen readers correctly.
// ─────────────────────────────────────────────────────────────────────────

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 pr-8", className)}
      {...props}
    />
  )
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      // Same edge-to-edge scroll region as desktop; mobile uses p-4 too.
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
  const mode = useDialogMode()

  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 sm:-mx-5 sm:-mb-5 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/40 p-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:flex-row sm:justify-end sm:p-4 sm:pb-4",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton &&
        (mode === "drawer" ? (
          // Vaul Close doesn't accept Base UI's `render` prop; use asChild
          // with a Button child to inherit the same affordance.
          <DrawerPrimitive.Close asChild>
            <Button variant="outline">Close</Button>
          </DrawerPrimitive.Close>
        ) : (
          <DialogPrimitive.Close render={<Button variant="outline" />}>
            Close
          </DialogPrimitive.Close>
        ))}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  const mode = useDialogMode()
  if (mode === "drawer") {
    return (
      <DrawerPrimitive.Title
        data-slot="dialog-title"
        className={cn(
          "font-heading text-lg leading-tight font-semibold tracking-tight",
          className
        )}
        {...(props as React.ComponentProps<typeof DrawerPrimitive.Title>)}
      />
    )
  }
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
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
  const mode = useDialogMode()
  if (mode === "drawer") {
    return (
      <DrawerPrimitive.Description
        data-slot="dialog-description"
        className={cn(
          "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
          className
        )}
        {...(props as React.ComponentProps<typeof DrawerPrimitive.Description>)}
      />
    )
  }
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
