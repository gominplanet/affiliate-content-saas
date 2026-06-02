/**
 * useConfirm() — a Promise-based replacement for window.confirm.
 *
 * Goal: let callers write `if (!await confirm({...})) return; doStuff()`
 * with the same control flow as `window.confirm()`, but rendering a
 * real ConfirmDialog instead.
 *
 * USAGE
 *
 *   function MyPage() {
 *     const { confirm, ConfirmHost } = useConfirm()
 *
 *     async function handleDelete(id: string) {
 *       const ok = await confirm({
 *         title: 'Delete this post?',
 *         description: 'The post and all its history will be removed.',
 *         confirmLabel: 'Delete post',
 *         destructive: true,
 *       })
 *       if (!ok) return
 *       await doDelete(id)
 *     }
 *
 *     return (
 *       <>
 *         ...your UI...
 *         <ConfirmHost />
 *       </>
 *     )
 *   }
 *
 * IMPLEMENTATION NOTES
 *
 * The hook keeps the dialog state inside React. Each call to confirm()
 * returns a new Promise; we resolve it when the user clicks
 * confirm/cancel/Escape/backdrop. Only one dialog at a time per host —
 * concurrent calls queue (later calls await earlier ones).
 *
 * <ConfirmHost /> MUST be rendered exactly once in the component tree
 * — typically at the bottom of the page. Forgetting to render it
 * means confirm() promises never resolve.
 */
'use client'

import { useCallback, useRef, useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  typeToConfirm?: string
}

interface PendingState {
  options: ConfirmOptions
  resolve: (value: boolean) => void
}

export function useConfirm() {
  const [pending, setPending] = useState<PendingState | null>(null)
  // Lock so concurrent confirm() calls queue rather than racing the
  // same dialog state. Each call await's the prior one's resolution.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    const next = new Promise<boolean>((resolve) => {
      // Chain onto the queue — wait for previous dialog to close.
      queueRef.current = queueRef.current.then(() => {
        return new Promise<void>((finished) => {
          setPending({
            options,
            resolve: (v) => {
              resolve(v)
              finished()
              setPending(null)
            },
          })
        })
      })
    })
    return next
  }, [])

  const ConfirmHost = useCallback(() => {
    if (!pending) return null
    return (
      <ConfirmDialog
        open
        title={pending.options.title}
        description={pending.options.description}
        confirmLabel={pending.options.confirmLabel}
        cancelLabel={pending.options.cancelLabel}
        destructive={pending.options.destructive}
        typeToConfirm={pending.options.typeToConfirm}
        onConfirm={() => pending.resolve(true)}
        onCancel={() => pending.resolve(false)}
      />
    )
  }, [pending])

  return { confirm, ConfirmHost }
}
