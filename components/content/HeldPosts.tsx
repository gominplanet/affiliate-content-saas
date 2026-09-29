'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Posts auto-pilot wrote but did not publish. The quality gate in
// app/api/blog/generate keeps a post as a WordPress draft when it had no
// first-hand source or still read as machine-written, and records why. This is
// where the creator sees that it happened, reads the reasons, opens the draft,
// or publishes it anyway. A held post that nobody is told about is
// indistinguishable from a post that was never written, so this list is the
// other half of the gate.
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

interface Held { id: string; title: string | null; wordpressUrl: string | null; wordpressPostId: number | null; at: string; reasons: string[] }

function editLink(h: Held): string | null {
  if (!h.wordpressUrl) return null
  try {
    const u = new URL(h.wordpressUrl)
    return h.wordpressPostId ? `${u.origin}/wp-admin/post.php?post=${h.wordpressPostId}&action=edit` : h.wordpressUrl
  } catch { return h.wordpressUrl }
}

export function HeldPosts() {
  const [held, setHeld] = useState<Held[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  // Three at most until asked, so a run of held drafts never pushes the
  // generator down the page.
  const [all, setAll] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/blog/held', { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      setHeld(Array.isArray(j.held) ? j.held : [])
    } catch { /* the list is a report; a failed read leaves it empty */ }
  }, [])
  useEffect(() => { load() }, [load])

  const publish = async (h: Held) => {
    setBusy(h.id)
    try {
      const r = await fetch('/api/blog/publish-now', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blogPostId: h.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { toast.error(j.error || 'WordPress did not publish it.'); return }
      toast.success(j.verified === false ? 'Sent to WordPress. It did not confirm the status, so check the post.' : 'Published. WordPress confirms it is live.')
      setHeld((xs) => xs.filter((x) => x.id !== h.id))
    } finally { setBusy(null) }
  }

  if (!held.length) return null
  return (
    <div className="rounded-xl border p-4 mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
        {held.length} post{held.length !== 1 ? 's' : ''} held for your review
      </div>
      <p className="text-[12.5px] mt-1 mb-3" style={{ color: 'var(--text-soft)' }}>
        These were saved as drafts on your site instead of going live. Each says why: a link that is for a different product than the video, or an auto-pilot post with nothing first-hand in it or that reads as machine-written. Fix what it names, then publish. They stay drafts until you do.
      </p>
      <div className="flex flex-col gap-2">
        {(all ? held : held.slice(0, 3)).map((h) => {
          const edit = editLink(h)
          return (
            <div key={h.id} className="rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center gap-2" style={{ borderColor: 'var(--border)' }}>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>{h.title || 'Untitled post'}</div>
                <ul className="text-[12px] mt-1 list-disc pl-4" style={{ color: 'var(--text-soft)' }}>
                  {h.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
              <div className="flex gap-2 shrink-0">
                {edit && (
                  <a href={edit} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center h-8 px-3 rounded-lg border text-[12.5px] font-medium"
                    style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Open draft</a>
                )}
                <button onClick={() => publish(h)} disabled={busy === h.id}
                  className="inline-flex items-center h-8 px-3 rounded-lg text-[12.5px] font-medium text-white disabled:opacity-50"
                  style={{ background: 'var(--accent, #6d28d9)' }}>
                  {busy === h.id ? 'Publishing…' : 'Publish anyway'}
                </button>
              </div>
            </div>
          )
        })}
        {held.length > 3 && (
          <button type="button" onClick={() => setAll((v) => !v)} className="self-start text-[12.5px] font-medium" style={{ color: 'var(--accent, #6d28d9)' }}>
            {all ? 'Show fewer' : `Show all ${held.length}`}
          </button>
        )}
      </div>
    </div>
  )
}
