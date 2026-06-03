/**
 * Reusable confirmation modal — replaces window.confirm() across the app.
 *
 * Why: window.confirm() is blocked by Safari content-filter extensions,
 * looks broken on mobile, locks the page while open, and can't surface
 * any context beyond a single line of text. For destructive actions
 * (disconnect site, delete post, etc.) the audit (2026-06-02) flagged
 * 14 confirm() callers across the dashboard.
 *
 * USAGE
 *
 *   const [confirmOpen, setConfirmOpen] = useState(false)
 *
 *   <button onClick={() => setConfirmOpen(true)}>Delete</button>
 *
 *   <ConfirmDialog
 *     open={confirmOpen}
 *     title="Delete this post?"
 *     description="The post and all its history will be removed. This can't be undone."
 *     confirmLabel="Delete post"
 *     destructive
 *     onConfirm={() => { setConfirmOpen(false); doDelete() }}
 *     onCancel={() => setConfirmOpen(false)}
 *   />
 *
 * The dialog:
 *   - Backdrop-blurred overlay; click outside to cancel.
 *   - Escape closes (cancels).
 *   - Autofocus on the cancel button by default (safe default — Enter
 *     defaults to cancel, not confirm).
 *   - For VERY destructive actions, pass `typeToConfirm="DELETE"` —
 *     the user must type that exact string to enable the confirm
 *     button (prevents Enter-mash through the modal).
 *   - role="dialog" + aria-modal + aria-labelledby for screen readers.
 *
 * Focus + a11y discipline (2026-06-03 sweep):
 *   - Focus trap (Tab/Shift-Tab cycle within the dialog)
 *   - Restore focus to the trigger on close
 *   - Body scroll lock while open
 *   - Escape closes, click-outside closes
 *   - role=dialog + aria-modal + aria-labelledby wired
 *   - typeToConfirm path autofocuses the input; otherwise autofocus
 *     lands on Cancel (Enter-mash safe default)
 */
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface Props {
  /** Toggles the modal. Controlled by the caller. */
  open: boolean
  /** Bold heading. Phrase as a question for destructive actions. */
  title: string
  /** Detail body. Plain text — keep it short (1-2 sentences). */
  description?: string
  /** CTA button label. Default: "Confirm". */
  confirmLabel?: string
  /** Cancel button label. Default: "Cancel". */
  cancelLabel?: string
  /** Red destructive styling. Use for "delete", "disconnect", "remove". */
  destructive?: boolean
  /** Require the user to type a specific string to enable the confirm
   *  button. Use for the highest-stakes actions (newsletter blast,
   *  account-wide delete). The string is compared case-insensitively. */
  typeToConfirm?: string
  /** Called when user clicks the confirm button (or presses Enter
   *  when typeToConfirm matches). */
  onConfirm: () => void | Promise<void>
  /** Called on Cancel button click, Escape press, or backdrop click. */
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  typeToConfirm,
  onConfirm,
  onCancel,
}: Props) {
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  // Snapshot the element focused when the dialog opens so we can restore it
  // on close — without this, focus drops to <body> and keyboard nav restarts.
  const previouslyFocused = useRef<HTMLElement | null>(null)

  // Reset state + initial focus + scroll lock + previous-focus snapshot.
  useEffect(() => {
    if (!open) return
    setTyped('')
    previouslyFocused.current = (document.activeElement as HTMLElement) || null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Defer to next tick so the panel + children have mounted.
    const handle = window.setTimeout(() => {
      // Focus the input if type-to-confirm, else focus Cancel (safer
      // default for Enter-mashers).
      ;(typeToConfirm ? inputRef : cancelRef).current?.focus()
    }, 0)
    return () => {
      window.clearTimeout(handle)
      document.body.style.overflow = prevOverflow
      const target = previouslyFocused.current
      if (target && document.body.contains(target)) {
        try { target.focus({ preventScroll: true }) } catch { /* no-op */ }
      }
    }
  }, [open, typeToConfirm])

  // Tab + Shift-Tab cycle within the dialog (focus trap). Escape closes.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onCancel()
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
  }, [onCancel])

  if (!open) return null

  const typeOk = !typeToConfirm || typed.trim().toUpperCase() === typeToConfirm.toUpperCase()
  const confirmDisabled = !typeOk

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="bg-white dark:bg-[#1a1a1c] rounded-2xl shadow-2xl max-w-md w-full p-6 border border-gray-200 dark:border-white/10 outline-none"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        tabIndex={-1}
      >
        <h2
          id="confirm-dialog-title"
          className="text-[18px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7] mb-2"
        >
          {title}
        </h2>
        {description && (
          <p className="text-[14px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mb-4">
            {description}
          </p>
        )}

        {typeToConfirm && (
          <div className="mb-4">
            <label
              htmlFor="confirm-type-input"
              className="block text-[12px] text-[#6e6e73] dark:text-[#ebebf0] mb-1.5"
            >
              Type <strong className="text-[#7C3AED]">{typeToConfirm}</strong> to confirm
            </label>
            <input
              id="confirm-type-input"
              ref={inputRef}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="characters"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 text-[14px] font-mono uppercase tracking-wider text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:border-[#7C3AED]"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !confirmDisabled) {
                  void onConfirm()
                }
              }}
            />
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-[13px] text-[#6e6e73] dark:text-[#ebebf0] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => void onConfirm()}
            disabled={confirmDisabled}
            className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white inline-flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: destructive
                ? 'linear-gradient(135deg, #ff3b30 0%, #d70015 100%)'
                : 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
              boxShadow: destructive
                ? '0 4px 16px rgba(255,59,48,0.30)'
                : '0 4px 16px rgba(124,58,237,0.30)',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
