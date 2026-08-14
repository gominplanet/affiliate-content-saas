// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BlogEditModal — edit a generated blog post's title + body INSIDE MVP, without
// opening WordPress. Loads GET /api/blog/edit?postId=…, edits the headline and
// the article body in a lightweight rich-text surface (contenteditable +
// bold/italic/heading/list/link toolbar), and PATCHes it back: saves to
// blog_posts and re-pushes to WordPress (live or scheduled) in one go.
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { X, Loader2, Bold, Italic, Heading2, List, Link2, Save, ExternalLink } from 'lucide-react'

interface Props {
  postId: string
  onClose: () => void
  onSaved?: () => void
}

interface Loaded { title: string; content: string; status: string | null; wordpressUrl: string | null; scheduledFor: string | null }

export default function BlogEditModal({ postId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<Loaded | null>(null)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/blog/edit?postId=${encodeURIComponent(postId)}`)
        const d = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) { setError(d.error || 'Could not load this post.'); return }
        setMeta({ title: d.title || '', content: d.content || '', status: d.status ?? null, wordpressUrl: d.wordpressUrl ?? null, scheduledFor: d.scheduledFor ?? null })
        setTitle(d.title || '')
        // Seed the contenteditable once (uncontrolled after mount so the caret
        // doesn't jump on every keystroke).
        requestAnimationFrame(() => { if (bodyRef.current) bodyRef.current.innerHTML = d.content || '' })
      } catch {
        if (!cancelled) setError('Network error — try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [postId])

  // execCommand is deprecated but still the simplest cross-browser rich-text
  // path for editing WordPress HTML in place. Wrapped so the button focus
  // doesn't steal the selection.
  const exec = useCallback((cmd: string, value?: string) => {
    bodyRef.current?.focus()
    try { document.execCommand(cmd, false, value) } catch { /* no-op */ }
  }, [])

  const addLink = useCallback(() => {
    const url = window.prompt('Link URL (https://…)')
    if (!url) return
    const safe = /^https?:\/\//i.test(url) ? url : `https://${url}`
    exec('createLink', safe)
  }, [exec])

  async function save() {
    const html = bodyRef.current?.innerHTML ?? ''
    const t = title.trim()
    if (!t) { toast.error('Give the post a title.'); return }
    setSaving(true)
    const tId = `blog-edit-${postId}`
    toast.loading('Saving…', { id: tId, duration: Infinity })
    try {
      const res = await fetch('/api/blog/edit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, title: t, content: html }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Save failed.', { id: tId, duration: 6000 }); return }
      if (d.wpError) {
        toast.error(`Saved in MVP, but WordPress didn’t update: ${d.wpError}`, { id: tId, duration: 8000 })
      } else {
        toast.success(d.wpUpdated ? 'Saved and pushed to your site.' : 'Saved.', { id: tId, duration: 4000 })
      }
      onSaved?.()
      onClose()
    } catch {
      toast.error('Network error — try again.', { id: tId, duration: 6000 })
    } finally {
      setSaving(false)
    }
  }

  const isScheduled = !!meta?.scheduledFor && new Date(meta.scheduledFor).getTime() > Date.now()

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[90vh] rounded-2xl border flex flex-col overflow-hidden shadow-2xl bg-white dark:bg-[#1c1c1e] border-gray-200 dark:border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-gray-200 dark:border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[15px] font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Edit post</span>
            {isScheduled && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#7C3AED]/12 text-[#7C3AED]">Scheduled</span>}
            {meta && !isScheduled && meta.wordpressUrl && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#34c759]/15 text-[#1c7a35]">Live</span>}
          </div>
          <div className="flex items-center gap-2">
            {meta?.wordpressUrl && (
              <a href={meta.wordpressUrl} target="_blank" rel="noreferrer" className="text-[12px] font-medium text-[#7C3AED] hover:underline inline-flex items-center gap-1">
                View <ExternalLink size={12} />
              </a>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={18} /></button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-[#86868b]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : error ? (
          <div className="px-5 py-16 text-center text-sm text-[#ff3b30]">{error}</div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
              {/* Title */}
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                />
              </label>

              {/* Toolbar */}
              <div className="flex items-center gap-1 flex-wrap">
                {([
                  { icon: <Bold size={15} />, cmd: () => exec('bold'), title: 'Bold' },
                  { icon: <Italic size={15} />, cmd: () => exec('italic'), title: 'Italic' },
                  { icon: <Heading2 size={15} />, cmd: () => exec('formatBlock', 'H2'), title: 'Heading' },
                  { icon: <List size={15} />, cmd: () => exec('insertUnorderedList'), title: 'Bullet list' },
                  { icon: <Link2 size={15} />, cmd: addLink, title: 'Add link' },
                ]).map((b, i) => (
                  <button key={i} type="button" title={b.title} onMouseDown={(e) => e.preventDefault()} onClick={b.cmd}
                    className="w-8 h-8 rounded-lg grid place-items-center text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-gray-100 dark:hover:bg-white/10">
                    {b.icon}
                  </button>
                ))}
                <span className="text-[11px] text-[#86868b] ml-1">Format the article body</span>
              </div>

              {/* Body */}
              <div
                ref={bodyRef}
                contentEditable
                suppressContentEditableWarning
                className="prose-editor min-h-[280px] w-full px-4 py-3 rounded-lg text-sm leading-relaxed border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:border-[#7C3AED] overflow-y-auto"
                style={{ maxHeight: '48vh' }}
              />
              <p className="text-[11px] text-[#86868b]">
                Edits save to MVP and push straight to your site{isScheduled ? ' (the post stays scheduled for its publish time)' : ''}. Complex WordPress block layouts are best edited in WP.
              </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-200 dark:border-white/10">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-gray-100 dark:hover:bg-white/10">Cancel</button>
              <button onClick={save} disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-60 inline-flex items-center gap-1.5">
                {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : <><Save size={15} /> Save changes</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
