/**
 * <Modal> — accessible modal primitive with proper focus management.
 *
 * What it does that ad-hoc `<div className="fixed inset-0…">` modals don't:
 *
 *   1. **Focus trap.** Tab + Shift-Tab cycle through focusable elements
 *      INSIDE the dialog only. Focus can't leak out to the page behind
 *      (a screen-reader user otherwise navigates into hidden content).
 *
 *   2. **Initial focus.** Moves focus into the dialog when it opens so the
 *      user can immediately interact via keyboard. By default we focus
 *      the first focusable element; pass `initialFocus` for a different
 *      target (e.g. the cancel button on destructive modals).
 *
 *   3. **Restore focus on close.** Saves whatever was focused when the
 *      modal opened and restores it when the modal closes. Without
 *      this the user "loses their place" — focus drops to <body> and
 *      keyboard nav restarts from scratch.
 *
 *   4. **Escape closes.** Standard expected behavior, free.
 *
 *   5. **Backdrop click closes.** Click outside the panel closes — but
 *      only if `dismissOnBackdrop` is true (default). Some flows want
 *      mandatory action via a button.
 *
 *   6. **Scroll lock.** Locks the body scroll while the modal is open so
 *      the page behind doesn't scroll under the dialog.
 *
 *   7. **ARIA wiring.** `role="dialog"` + `aria-modal="true"` + auto
 *      `aria-labelledby` from the `title` prop.
 *
 *   8. **Portal-friendly.** Renders in place; if a caller wants a portal
 *      they can wrap in createPortal at the call site.
 *
 * USAGE
 *
 *   <Modal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     title="Delete this post?"
 *     description="The post will be removed from WordPress."
 *   >
 *     <div className="flex gap-2 justify-end">
 *       <button onClick={() => setOpen(false)}>Cancel</button>
 *       <button onClick={confirmDelete}>Delete</button>
 *     </div>
 *   </Modal>
 *
 * This primitive is intentionally NOT a confirm dialog — for confirms
 * use `useConfirm()` (which already wraps ConfirmDialog with proper
 * focus + Escape semantics). Use Modal for ad-hoc dialogs (compose
 * forms, preview panels, multi-step flows).
 */
'use client'

import { useCallback, useEffect, useId, useRef } from 'react'

/** All elements considered focusable. The order is important — `[tabindex]:not([tabindex="-1"])`
 *  catches custom focusable divs after natural form controls.  */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  '[role="button"]:not([disabled])',
].join(',')

export interface ModalProps {
  /** Controls visibility. When false, nothing renders. */
  open: boolean
  /** Called on Escape, backdrop click (when dismissOnBackdrop=true), or
   *  any other implicit-dismiss path the modal supports. */
  onClose: () => void
  /** Modal title — rendered as the visible heading AND wired to
   *  aria-labelledby for screen readers. */
  title?: string
  /** Optional secondary text below the title. */
  description?: string
  /** Body content. */
  children: React.ReactNode
  /** Tailwind max-width class for the panel (default 'max-w-md'). */
  maxWidthClass?: string
  /** When true (default), clicking the backdrop closes the modal. Set false
   *  for "must explicitly confirm or cancel" flows. */
  dismissOnBackdrop?: boolean
  /** Optional ref to the element that should receive focus when the modal
   *  opens. When omitted we focus the first focusable element. Set to null
   *  to skip auto-focus (rare — usually you want focus inside the modal). */
  initialFocus?: React.RefObject<HTMLElement | null>
  /** Optional extra classes on the panel. */
  className?: string
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  maxWidthClass = 'max-w-md',
  dismissOnBackdrop = true,
  initialFocus,
  className,
}: ModalProps) {
  // Stable id for aria-labelledby. useId is React 18-safe (server + client
  // match) so SSR doesn't hydrate-mismatch the aria attr.
  const reactId = useId()
  const labelId = title ? `modal-label-${reactId}` : undefined

  const panelRef = useRef<HTMLDivElement | null>(null)
  // Snapshot of the element that was focused when the modal opened, so we
  // can restore focus when it closes.
  const previouslyFocused = useRef<HTMLElement | null>(null)

  // ── Body scroll lock + previous-focus snapshot on open ────────────────────
  useEffect(() => {
    if (!open) return
    previouslyFocused.current = (document.activeElement as HTMLElement) || null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      // Restore focus to whatever was focused before. Guard against the
      // element having been removed from the DOM in the meantime (e.g.
      // page navigation while a modal was open).
      const target = previouslyFocused.current
      if (target && document.body.contains(target)) {
        try { target.focus({ preventScroll: true }) } catch { /* no-op */ }
      }
    }
  }, [open])

  // ── Initial focus when the modal opens ────────────────────────────────────
  useEffect(() => {
    if (!open) return
    // Defer to next tick so children have mounted + refs are populated.
    const handle = window.setTimeout(() => {
      const explicit = initialFocus?.current
      if (explicit) {
        try { explicit.focus({ preventScroll: true }) } catch { /* no-op */ }
        return
      }
      const panel = panelRef.current
      if (!panel) return
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      if (first) {
        try { first.focus({ preventScroll: true }) } catch { /* no-op */ }
      } else {
        // No focusable child — focus the panel itself so Escape/Tab still
        // route to our keyboard handler.
        try { panel.focus({ preventScroll: true }) } catch { /* no-op */ }
      }
    }, 0)
    return () => window.clearTimeout(handle)
  }, [open, initialFocus])

  // ── Escape + Tab trap ─────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        // Filter out invisible elements — focus() on display:none is a no-op
        // but it eats the Tab event and traps the user.
        .filter(n => n.offsetWidth > 0 || n.offsetHeight > 0 || n === document.activeElement)
      if (nodes.length === 0) {
        e.preventDefault()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        // Shift-Tab from the first element wraps to the last.
        if (active === first || !panel.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        // Tab from the last element wraps to the first.
        if (active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    },
    [onClose],
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={() => { if (dismissOnBackdrop) onClose() }}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={`bg-white dark:bg-[#1a1a1c] rounded-2xl shadow-2xl w-full ${maxWidthClass} p-6 border border-gray-200 dark:border-white/10 my-4 outline-none ${className ?? ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
      >
        {title && (
          <h2 id={labelId} className="text-[20px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
            {title}
          </h2>
        )}
        {description && (
          <p className="text-[14px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mb-4">
            {description}
          </p>
        )}
        {children}
      </div>
    </div>
  )
}
