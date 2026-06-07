// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// ManualEdit — an inline contentEditable expander on each Library row.
// Lets the user tweak the wording of a published post without leaving
// the dashboard. Pulls the article HTML from /api/blog/content, lets
// them edit, posts back. Pushes through to WP on save.
//
// Extracted from app/(dashboard)/content/page.tsx 2026-06-07 — was the
// smallest of the 4 components nested inside VideoCard, used as the
// pilot for the rest of the content-page split.
'use client'

import { useState, useEffect, useRef } from 'react'
import { Edit3, Loader2, Save } from 'lucide-react'

export function ManualEdit({ postId }: { postId?: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [html, setHtml] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const seeded = useRef(false)

  // Seed the contentEditable AFTER it mounts (it only renders once
  // loading is false). Only once per open so user edits aren't clobbered.
  useEffect(() => {
    if (open && !loading && ref.current && !seeded.current) {
      ref.current.innerHTML = html
      seeded.current = true
    }
  }, [open, loading, html])

  async function toggle() {
    if (open) { setOpen(false); seeded.current = false; return }
    seeded.current = false
    setMsg(null)
    if (!postId) { setHtml(''); setOpen(true); setMsg('No post to edit yet.'); return }
    setOpen(true); setLoading(true)
    try {
      const res = await fetch(`/api/blog/content?postId=${postId}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not load the article')
      setHtml(data.content || '')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    if (!ref.current || !postId) return
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/blog/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, content: ref.current.innerHTML }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Save failed')
      if (data.warning) {
        // Saved locally but WP push had an issue — keep open so the
        // user sees why.
        setMsg(data.warning)
      } else {
        // Success — collapse the editor.
        setOpen(false)
        seeded.current = false
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={open ? 'basis-full order-last mt-1' : ''}>
      <button
        onClick={toggle}
        className="inline-flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#7C3AED] transition-colors"
      >
        <Edit3 size={11} /> {open ? 'Close editor' : 'Manual edit'}
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-3">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-[#86868b] py-8 justify-center">
              <Loader2 size={14} className="animate-spin" /> Loading article…
            </div>
          ) : (
            <>
              <div
                ref={ref}
                contentEditable
                suppressContentEditableWarning
                className="max-w-none min-h-[220px] max-h-[480px] overflow-auto text-sm leading-relaxed text-[#1d1d1f] dark:text-[#f5f5f7] outline-none rounded-lg border border-gray-100 dark:border-white/5 p-3 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:font-semibold [&_a]:text-[#7C3AED] [&_a]:underline [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2"
              />
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <button
                  onClick={save}
                  disabled={saving || !postId}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 transition-colors"
                >
                  {saving ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : <><Save size={12} /> Save changes</>}
                </button>
                <button onClick={() => { setOpen(false); seeded.current = false }} className="text-xs text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-white">Cancel</button>
                {msg && <span className="text-[11px] text-[#6e6e73] dark:text-[#8e8e93]">{msg}</span>}
              </div>
              <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-2">
                Edit the wording directly. Headings and links (including affiliate links) are kept — saving updates the live WordPress post.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
