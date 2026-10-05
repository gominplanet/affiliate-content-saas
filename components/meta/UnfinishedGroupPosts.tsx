'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// IN YOUR GROUP, NOT ON YOUR PAGE YET. Group posts whose Page post never went
// out (Facebook refused it, the tab closed, an older SCOUT), from the record in
// app/api/facebook/hub. One press finishes each the way it should have gone:
// a review gets its Page post with the thumbnail, linking to that Group post;
// a clip gets its Page Reel with "Get it here 👉" and the Group post on the
// first line. A Group post made outside MVP can be pasted in and shared too.
// Each row says what actually happened, and a failure stays on screen.

import { useState } from 'react'
import { Loader2, Check, AlertTriangle } from 'lucide-react'
import { isFacebookGroupLink, isFacebookGroupPostLink } from '@/lib/facebook-group-link'

export type UnfinishedPost = {
  kind: string
  title: string | null
  sourceId: string | null
  videoId: string | null
  groupUrl: string | null
  groupPostUrl: string
  at: string
  clipUrl: string | null
  imageUrl: string | null
}

type RowState = { phase: 'busy' } | { phase: 'done'; text: string } | { phase: 'failed'; text: string }

const FB = '#1877F2'

const groupKey = (u: string | null | undefined) => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.|m\.|web\.)?/, '').replace(/\/+$/, '')

export function pageTeaser(groupName: string, title: string): string {
  return [`New in ${groupName}:`, title.trim(), 'The full post, links and all, is in the Group 👇'].filter(Boolean).join('\n\n')
}

async function record(body: Record<string, unknown>) {
  try { await fetch('/api/facebook/hub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }) } catch { /* the record is best effort */ }
}

export default function UnfinishedGroupPosts({ items, groups, pageName, onDone }: {
  items: UnfinishedPost[]
  groups: Array<{ name: string; url: string }>
  pageName: string | null
  onDone: () => void
}) {
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [pasteLink, setPasteLink] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [paste, setPaste] = useState<RowState | null>(null)
  const page = pageName || 'your Page'
  const nameFor = (url: string | null, postUrl: string) => {
    const k = groupKey(url) || groupKey(postUrl).split('/posts/')[0].split('/permalink/')[0]
    return groups.find((g) => k.startsWith(groupKey(g.url)) || groupKey(g.url).startsWith(k))?.name || 'my Group'
  }
  const set = (k: string, v: RowState) => setRows((m) => ({ ...m, [k]: v }))

  async function shareTeaser(message: string, link: string, imageUrl: string | null) {
    const r = await fetch('/api/blog/facebook-group-teaser', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, link, imageUrl: imageUrl || undefined }),
      signal: AbortSignal.timeout(45000),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || !d.ok) throw new Error(d.error || `Facebook said no (${r.status})`)
    return d as { id?: string; page?: string; photo?: boolean; photoTried?: boolean }
  }

  async function finish(it: UnfinishedPost) {
    const k = it.groupPostUrl
    set(k, { phase: 'busy' })
    const title = (it.title || '').trim()
    try {
      if (it.kind === 'clip') {
        if (!it.clipUrl) throw new Error('The clip file is no longer there. Make the Reel again in step 4.')
        const description = [`Get it here 👉 ${it.groupPostUrl}`, title].filter(Boolean).join('\n\n')
        const r = await fetch('/api/clip-factory/facebook-reel', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: it.clipUrl, description }),
          signal: AbortSignal.timeout(300000),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok || !d.ok) throw new Error(d.error || 'Facebook did not post the Reel.')
        await record({ kind: 'clip', sourceId: it.sourceId, videoId: it.videoId, title: it.title, groupUrl: it.groupUrl, groupPostUrl: it.groupPostUrl, pagePostUrl: d.url || null })
        set(k, { phase: 'done', text: d.state === 'published'
          ? `The Reel is live on ${d.page || page}, linking to this Group post.`
          : `Facebook accepted the Reel and is still processing it; it appears on ${d.page || page} shortly.` })
      } else {
        const d = await shareTeaser(pageTeaser(nameFor(it.groupUrl, it.groupPostUrl), title), it.groupPostUrl, it.imageUrl)
        await record({ kind: it.kind === 'post' ? 'post' : 'blog', sourceId: it.sourceId, videoId: it.videoId, title: it.title, groupUrl: it.groupUrl, groupPostUrl: it.groupPostUrl, pagePostUrl: d.id ? `https://www.facebook.com/${d.id}` : null })
        const pic = d.photo ? ' with the thumbnail' : d.photoTried ? ' as text only (Facebook refused the thumbnail)' : ''
        set(k, { phase: 'done', text: `Shared on ${d.page || page}${pic}, linking to this Group post.` })
      }
      onDone()
    } catch (e) {
      set(k, { phase: 'failed', text: e instanceof Error ? e.message : 'It did not go out.' })
    }
  }

  async function sharePasted() {
    const link = pasteLink.trim()
    if (!isFacebookGroupLink(link)) { setPaste({ phase: 'failed', text: 'That is not a Facebook Group link. Open the post in your Group, click its time stamp and copy the address.' }); return }
    setPaste({ phase: 'busy' })
    try {
      const d = await shareTeaser(pageTeaser(nameFor(null, link), pasteText.trim()), link, null)
      await record({ kind: 'post', title: pasteText.trim().split('\n')[0]?.slice(0, 160) || null, groupPostUrl: link, pagePostUrl: d.id ? `https://www.facebook.com/${d.id}` : null })
      setPaste({ phase: 'done', text: `Shared on ${d.page || page}, linking to ${isFacebookGroupPostLink(link) ? 'that Group post' : 'your Group'}.` })
      setPasteLink(''); setPasteText('')
      onDone()
    } catch (e) { setPaste({ phase: 'failed', text: e instanceof Error ? e.message : 'It did not go out.' }) }
  }

  const status = (r: RowState | null | undefined) => !r ? null
    : r.phase === 'busy' ? <span className="text-[12px] flex items-center gap-1.5" style={{ color: 'var(--text-faint)' }}><Loader2 size={13} className="animate-spin" /> Posting on {page}…</span>
      : r.phase === 'done' ? <span className="text-[12px] flex items-center gap-1.5" style={{ color: '#10B981' }}><Check size={13} /> {r.text}</span>
        : <span className="text-[12px] flex items-start gap-1.5" style={{ color: '#DC2626' }}><AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> {r.text}</span>

  return (
    <section className="card rounded-2xl border p-4 flex flex-col gap-3" style={{ borderColor: items.length ? 'rgba(217,119,6,0.45)' : 'var(--border)' }}>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>In your Group, not on your Page yet</h2>
        <p className="text-[12.5px]" style={{ color: 'var(--text-soft)' }}>
          Group posts whose Page post never went out. One press each: a review gets its Page post with the thumbnail, a clip gets its Page Reel, both linking to that exact Group post.
        </p>
      </div>
      {items.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--text-faint)' }}>Nothing waiting. Every Group post MVP recorded is on your Page too.</p>
      ) : (
        <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
          {items.map((it) => {
            const r = rows[it.groupPostUrl]
            const done = r?.phase === 'done'
            return (
              <li key={it.groupPostUrl} className="py-2.5 flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px] flex flex-col gap-0.5">
                  <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
                    {it.kind === 'clip' ? 'Reel' : 'Review'} · {it.title || 'Group post'}
                  </span>
                  <span className="text-[11.5px] flex gap-2 flex-wrap" style={{ color: 'var(--text-faint)' }}>
                    <a href={it.groupPostUrl} target="_blank" rel="noopener noreferrer" className="underline">Group post</a>
                    {new Date(it.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                  {status(r)}
                </div>
                {!done && (
                  <button onClick={() => void finish(it)} disabled={r?.phase === 'busy' || (it.kind === 'clip' && !it.clipUrl)}
                    className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white whitespace-nowrap disabled:opacity-50" style={{ background: FB }}>
                    {it.kind === 'clip' ? 'Post the Reel on my Page' : 'Share on my Page'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
        <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Posted in a Group outside MVP? Share it on your Page</p>
        <input value={pasteLink} onChange={(e) => setPasteLink(e.target.value)} placeholder="facebook.com/groups/your-group/posts/… (click the post's time stamp, copy the address)"
          className="rounded-lg border px-3 py-2 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
        <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={2} placeholder="One line about it, like: This dash cam saved me after a crash"
          className="rounded-lg border px-3 py-2 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => void sharePasted()} disabled={!pasteLink.trim() || paste?.phase === 'busy'}
            className="self-start px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white disabled:opacity-50" style={{ background: FB }}>
            Share on my Page
          </button>
          {status(paste)}
        </div>
      </div>
    </section>
  )
}
