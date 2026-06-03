/**
 * useModalA11y — retrofit focus trap, scroll lock, and focus restore into
 * existing ad-hoc modals without rewriting their JSX.
 *
 * Why a hook instead of swapping every modal to <Modal>:
 *   - The dashboard has 12+ bespoke modals (Newsletter compose, Instagram
 *     direct, TikTok direct, Pinterest preview, Bulk schedule, etc.) with
 *     very different inner layouts (multi-step flows, live previews,
 *     embedded forms). Migrating each to <Modal> would mean rewriting
 *     half the dashboard's UI.
 *   - The accessibility wins (focus trap, scroll lock, restore focus,
 *     Escape) are mechanical — same code per modal. Extracting them into
 *     a hook means a one-line retrofit per file.
 *
 * USAGE
 *
 *   const panelRef = useRef<HTMLDivElement | null>(null)
 *   const onKeyDown = useModalA11y(open, panelRef, onClose)
 *
 *   return (
 *     <div className="fixed inset-0 z-50 …" onKeyDown={onKeyDown} onClick={onClose}>
 *       <div ref={panelRef} role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
 *         ...your existing content...
 *       </div>
 *     </div>
 *   )
 *
 * What the hook provides:
 *   1. Body scroll lock on open, restored on close.
 *   2. Snapshot of the previously-focused element, restored on close so
 *      keyboard nav resumes from the trigger.
 *   3. Initial focus on the first focusable child of the panel (so
 *      keyboard users land inside the dialog).
 *   4. A keydown handler the caller wires onto the backdrop element:
 *        - Escape → calls onClose
 *        - Tab    → cycles focus inside the panel only
 *        - Shift+Tab → cycles backwards inside the panel only
 *
 * The hook does NOT render anything — the caller owns the JSX. The hook
 * does NOT manage ARIA attributes — the caller is responsible for
 * role="dialog" + aria-modal + aria-labelledby. (We can't set those
 * because we don't know the title id of an existing modal.)
 */
'use client'

import { useCallback, useEffect, type RefObject } from 'react'

/** All elements considered focusable. Order matters — natural form controls
 *  first, then custom focusables. */
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

export function useModalA11y(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): (e: React.KeyboardEvent<HTMLElement>) => void {
  // Scroll lock + previous-focus snapshot + initial focus when the modal
  // opens; everything reverses on close.
  useEffect(() => {
    if (!open) return
    const previouslyFocused = (document.activeElement as HTMLElement) || null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Initial focus deferred to next tick so children have mounted.
    const focusHandle = window.setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      if (first) {
        try { first.focus({ preventScroll: true }) } catch { /* no-op */ }
      } else {
        // No focusable child — focus the panel itself if it has tabIndex,
        // otherwise leave focus alone.
        try { panel.focus?.({ preventScroll: true }) } catch { /* no-op */ }
      }
    }, 0)

    return () => {
      window.clearTimeout(focusHandle)
      document.body.style.overflow = prevOverflow
      if (previouslyFocused && document.body.contains(previouslyFocused)) {
        try { previouslyFocused.focus({ preventScroll: true }) } catch { /* no-op */ }
      }
    }
  }, [open, panelRef])

  // Escape + Tab focus trap. Caller wires this onto the backdrop element
  // (or anywhere inside the modal — events bubble).
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (!open) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter(n => n.offsetWidth > 0 || n.offsetHeight > 0 || n === document.activeElement)
    if (nodes.length === 0) { e.preventDefault(); return }
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const active = document.activeElement as HTMLElement | null
    if (e.shiftKey) {
      if (active === first || !panel.contains(active)) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (active === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }, [open, panelRef, onClose])

  return onKeyDown
}
