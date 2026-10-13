'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WAITING FOR YOUR GROUP (Seb, 2026-10-13: scheduled and auto-pilot Facebook
// posts "queue for the Group"). Facebook posts MVP made while nobody was there
// to press Post in a Group: scheduled reviews, deal posts, Amazon designs
// (lib/facebook-queue). Send does what Social Push does, one post at a time:
//   1. SCOUT opens the Group and fills in the post (the creator presses Post)
//   2. SCOUT reads the new post's address
//   3. MVP posts on the Page pointing to that Group post
// Each row says what actually happened. "Sent" is only marked once the Group
// post is up, and a Page post that failed stays on screen with a retry.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Send, X, Check, AlertTriangle } from 'lucide-react'
import { isFacebookGroupLink, isFacebookGroupPostLink } from '@/lib/facebook-group-link'
import { SOURCE_LABEL, type QueueSource } from '@/lib/facebook-queue-words'
import { pageTeaser } from '@/components/meta/UnfinishedGroupPosts'

const FB = '#1877F2'

type Item = { id: string; source: QueueSource; source_id: string | null; title: string | null; body: string; link: string | null; image_url: string | null; created_at: string }
type Row =
  | { phase: 'filling' }
  | { phase: 'waiting'; text: string }
  | { phase: 'page'; text: string }
  | { phase: 'done'; text: string }
  | { phase: 'stuck'; text: string; groupPostUrl?: string }

export default function FacebookQueue({ groups, onChanged }: {
  groups: Array<{ name: string; url: string }>
  onChanged?: () => void
}) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [pick, setPick] = useState<Record<string, number>>({})
  const [open, setOpen] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const set = (id: string, r: Row) => setRows((m) => ({ ...m, [id]: r }))

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/facebook/queue', { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      if (d.needsMigration) { setNote('The Facebook queue needs migration 426 before posts can wait in it. Until then they go on your Page as before.'); setItems([]); return }
      if (!r.ok) { setNote(d.error || 'MVP could not read your Facebook queue.'); setItems([]); return }
      setItems((d.items || []) as Item[])
    } catch { setNote('MVP could not read your Facebook queue.'); setItems([]) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function mark(id: string, body: Record<string, unknown>) {
    const r = await fetch('/api/facebook/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
    return r.ok
  }

  async function sharePage(it: Item, g: { name: string; url: string }, link: string) {
    set(it.id, { phase: 'page', text: `Posted in ${g.name}. Sharing it on your Page now...` })
    try {
      const res = await fetch('/api/blog/facebook-group-teaser', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: pageTeaser(g.name, it.title || it.body.split('\n')[0] || ''), link, imageUrl: it.image_url || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `Facebook said no (${res.status})`)
      const page = data.id ? `https://www.facebook.com/${data.id}` : null
      await mark(it.id, { action: 'sent', groupPostUrl: link, pagePostUrl: page })
      // In the hub's history, and a scheduled review counts as that review.
      void fetch('/api/facebook/hub', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: it.source === 'scheduled' ? 'blog' : 'post', sourceId: it.source_id || it.id, title: it.title, groupUrl: g.url, groupPostUrl: link, pagePostUrl: page }),
      }).catch(() => {})
      const where = isFacebookGroupPostLink(link) ? 'the Group post' : 'your Group'
      set(it.id, { phase: 'done', text: `Done: in ${g.name}, and on ${data.page || 'your Page'}, linking to ${where}.` })
      onChanged?.()
    } catch (e) {
      // The Group post is up and the Page post is not: said, with a retry.
      set(it.id, { phase: 'stuck', groupPostUrl: link, text: `Your Group post is up, but the Page post did not go out: ${e instanceof Error ? e.message : 'Facebook refused it'}.` })
    }
  }

  async function send(it: Item) {
    const g = groups[pick[it.id] ?? 0]
    if (!g) return
    try { await navigator.clipboard.writeText(it.body) } catch { /* the message still says what to do */ }
    set(it.id, { phase: 'filling' })
    const { requestFacebookGroupPrefill, getFacebookGroupPostStatus } = await import('@/lib/extension-frame')
    const res = await requestFacebookGroupPrefill(g.url, it.body, it.image_url ? { kind: 'thumbnail', url: it.image_url } : null)
    if (!res.filled) { set(it.id, { phase: 'stuck', text: res.error || 'SCOUT could not fill it. The post is copied: paste it in the Group yourself, then come back.' }); return }
    if (!res.canWatch || !res.watchId) { set(it.id, { phase: 'stuck', text: 'SCOUT filled the post, but it is too old to see it go up. Press Post in the Facebook tab; then update SCOUT so MVP can share it on your Page.' }); return }
    set(it.id, { phase: 'waiting', text: `SCOUT filled the post in ${g.name}${res.media ? ` (${res.media})` : ''}. Press Post in the Facebook tab: MVP shares it on your Page by itself.` })
    const end = Date.now() + 16 * 60 * 1000
    while (mounted.current && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 3000))
      const st = await getFacebookGroupPostStatus(res.watchId)
      if (st.state === 'watching') continue
      if (st.state === 'posted' && st.url && isFacebookGroupLink(st.url)) return void sharePage(it, g, st.url)
      if (st.state === 'posted_no_link' || st.state === 'posted') return void sharePage(it, g, g.url)
      set(it.id, { phase: 'stuck', text: st.state === 'closed' ? 'The Facebook tab closed before SCOUT saw the post go up. Press Send to try again.'
        : st.state === 'not_seen' ? 'SCOUT did not see the post appear. If the Group holds posts for approval, send it again once approved.'
        : 'SCOUT stopped watching before it saw the post. Press Send to try again.' })
      return
    }
  }

  async function dismiss(it: Item) {
    if (await mark(it.id, { action: 'dismiss' })) setItems((l) => (l || []).filter((x) => x.id !== it.id))
  }

  if (items === null) return <p className="text-[12px] inline-flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}><Loader2 size={12} className="animate-spin" /> Reading your Facebook queue</p>
  if (!items.length && !note) return null
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Waiting for your Group ({items.length})</p>
      <p className="text-[12px] mt-0.5 mb-3" style={{ color: 'var(--text-2)' }}>
        Posts MVP made while you were away. Only you can press Post in a Group, so each one waits here. Send: SCOUT fills it in your Group, you press Post, and MVP posts on your Page pointing to it.
      </p>
      {note && <p className="text-[12px] mb-2" style={{ color: '#d97706' }}>{note}</p>}
      {groups.length === 0 && items.length > 0 && <p className="text-[12px] mb-2" style={{ color: '#d97706' }}>Save a Group in step 2 first: the queue sends to it.</p>}
      <div className="flex flex-col gap-2.5">
        {items.map((it) => {
          const r = rows[it.id]
          const busy = r?.phase === 'filling' || r?.phase === 'waiting' || r?.phase === 'page'
          return (
            <div key={it.id} className="rounded-lg border p-3 flex gap-3" style={{ borderColor: 'var(--border)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {it.image_url && <img src={it.image_url} alt="" className="w-16 h-16 rounded-md object-cover flex-shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: FB }}>{SOURCE_LABEL[it.source] || 'Post'} · {new Date(it.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text)' }}>{it.title || it.body.split('\n')[0]}</p>
                <button onClick={() => setOpen(open === it.id ? null : it.id)} className="text-[11.5px] underline" style={{ color: 'var(--text-2)' }}>{open === it.id ? 'Hide the post' : 'See the post'}</button>
                {open === it.id && <p className="text-[12px] mt-1 whitespace-pre-line" style={{ color: 'var(--text)' }}>{it.body}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {groups.length > 1 && (
                    <select value={pick[it.id] ?? 0} onChange={(e) => setPick((m) => ({ ...m, [it.id]: Number(e.target.value) }))} disabled={busy}
                      className="text-[12px] rounded-md border px-2 py-1 bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                      {groups.map((g, i) => <option key={g.url} value={i}>{g.name}</option>)}
                    </select>
                  )}
                  {r?.phase !== 'done' && (
                    <button onClick={() => void send(it)} disabled={busy || !groups.length} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50" style={{ background: FB }}>
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} {groups.length > 1 ? 'Send to this Group, then Page' : `Send to ${groups[0]?.name || 'your Group'}, then Page`}
                    </button>
                  )}
                  {r?.phase === 'stuck' && r.groupPostUrl && (
                    <button onClick={() => void sharePage(it, groups[pick[it.id] ?? 0], r.groupPostUrl!)} className="text-[12px] font-semibold underline" style={{ color: FB }}>Try the Page post again</button>
                  )}
                  {!busy && r?.phase !== 'done' && (
                    <button onClick={() => void dismiss(it)} className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-2)' }} title="Remove it from the queue without posting"><X size={12} /> Dismiss</button>
                  )}
                </div>
                {r && 'text' in r && (
                  <p className="text-[12px] mt-1.5 inline-flex items-start gap-1.5" style={{ color: r.phase === 'done' ? '#16a34a' : r.phase === 'stuck' ? '#d97706' : 'var(--text-2)' }}>
                    {r.phase === 'done' ? <Check size={13} className="mt-0.5 shrink-0" /> : r.phase === 'stuck' ? <AlertTriangle size={13} className="mt-0.5 shrink-0" /> : <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin" />}
                    {r.text}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
