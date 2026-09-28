'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The titles as they are on the creator's sites, against MVP's record
// (/api/tools/title-audit/live). Finds a title that was changed on the site,
// including one written to the wrong post, which the body-vs-title scan below
// it cannot see.
import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Globe, ExternalLink } from 'lucide-react'

interface Differs { postId: string; url: string; mvpTitle: string; liveTitle: string; suggest: 'mvp' | 'site' | null; why: string }
interface Misfiled { postId: string; url: string; mvpTitle: string; numberNowNames: string }
interface Result { checked: number; missing: number; differs: Differs[]; misfiled: Misfiled[]; unread: string[]; unconnected: string[] }

export default function LiveTitleCheck() {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<Result | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})
  const [acting, setActing] = useState<string | null>(null)

  const run = async () => {
    setBusy(true); setDone({})
    try {
      const r = await fetch('/api/tools/title-audit/live', { cache: 'no-store', signal: AbortSignal.timeout(130_000) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j.error || 'Could not read your sites.'); return }
      setRes(j as Result)
    } catch { toast.error('The check took too long. Run it again; it picks up the same posts.') }
    finally { setBusy(false) }
  }

  const choose = async (d: Differs, use: 'mvp' | 'site') => {
    setActing(d.postId)
    try {
      const r = await fetch('/api/tools/title-audit/live', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: d.postId, use, title: d.liveTitle }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { toast.error(j.error || 'Nothing was changed.'); return }
      setDone((x) => ({ ...x, [d.postId]: use === 'mvp' ? (j.verified ? 'Title put back on your site, and your site confirms it.' : 'Sent to your site; it did not confirm, so check the post.') : 'Kept the title on your site and recorded it in MVP.' }))
    } finally { setActing(null) }
  }

  const open = res ? res.differs.filter((d) => !done[d.postId]).length : 0
  return (
    <div className="mb-6 card p-5">
      <div className="flex items-start gap-3">
        <Globe size={18} className="text-[#7C3AED] flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Titles on your live site</p>
          <p className="text-[13px] mt-1 text-[#3a3a3c] dark:text-[#d1d1d6] leading-relaxed">
            Reads every post&apos;s title from WordPress and compares it with MVP&apos;s record. This finds a title that was changed on the site, including one that landed on the wrong post. Each post&apos;s address still carries the words of its first title, so MVP says which title the address supports. Nothing changes until you choose.
          </p>
          <button onClick={run} disabled={busy}
            className="mt-3 inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-60">
            {busy ? <><Loader2 size={12} className="animate-spin" /> Reading your sites…</> : 'Check live titles'}
          </button>
        </div>
      </div>

      {res && (
        <div className="mt-4 text-[13px]">
          <p className="text-[#3a3a3c] dark:text-[#d1d1d6]">
            Checked {res.checked.toLocaleString()} posts. {res.differs.length ? `${res.differs.length} have a different title on the site${open !== res.differs.length ? ` (${open} left)` : ''}.` : 'Every live title matches MVP.'}
            {res.missing ? ` ${res.missing.toLocaleString()} are no longer on the site.` : ''}
          </p>
          {res.unread.length > 0 && <p className="mt-1 text-[#c93400]">Could not read: {res.unread.join(', ')}. Those posts were not checked.</p>}
          {res.unconnected.length > 0 && <p className="mt-1 text-[#c93400]">Posts on {res.unconnected.join(', ')} were not checked: that site is not connected.</p>}

          {res.misfiled.length > 0 && (
            <div className="mt-3 rounded-lg border border-[#ff9500]/40 p-3">
              <p className="font-semibold">{res.misfiled.length} post{res.misfiled.length === 1 ? '' : 's'} in MVP point at a different post on the site</p>
              <p className="text-[12px] text-[#6e6e73] mt-0.5">MVP will not write to these; each change is refused until it is sorted out.</p>
              <ul className="mt-2 flex flex-col gap-1 text-[12px]">
                {res.misfiled.slice(0, 20).map((m) => (
                  <li key={m.postId}><a href={m.url} target="_blank" rel="noopener noreferrer" className="underline">{m.mvpTitle || m.url}</a>: that number on the site is now {m.numberNowNames}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 flex flex-col gap-2">
            {res.differs.map((d) => (
              <div key={d.postId} className="rounded-lg border border-[var(--border,#e5e5e7)] p-3">
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-[#6e6e73] inline-flex items-center gap-1 hover:underline break-all">
                  {d.url} <ExternalLink size={11} />
                </a>
                <div className="mt-1.5 grid gap-1">
                  <div><span className="text-[11px] uppercase tracking-wide text-[#86868b]">On your site</span><p className={d.suggest === 'mvp' ? 'text-[#c93400]' : ''}>{d.liveTitle}</p></div>
                  <div><span className="text-[11px] uppercase tracking-wide text-[#86868b]">MVP has</span><p className={d.suggest === 'site' ? 'text-[#c93400]' : ''}>{d.mvpTitle}</p></div>
                </div>
                <p className="text-[12px] text-[#6e6e73] mt-1">{d.why}</p>
                {done[d.postId]
                  ? <p className="mt-2 text-[12px] text-[#1f8a3a]">{done[d.postId]}</p>
                  : (
                    <div className="mt-2 flex gap-2 flex-wrap">
                      <button onClick={() => choose(d, 'mvp')} disabled={acting === d.postId}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${d.suggest === 'mvp' ? 'bg-[#7C3AED] text-white' : 'border border-[var(--border,#e5e5e7)]'} disabled:opacity-60`}>
                        Put MVP&apos;s title on the site
                      </button>
                      <button onClick={() => choose(d, 'site')} disabled={acting === d.postId}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${d.suggest === 'site' ? 'bg-[#7C3AED] text-white' : 'border border-[var(--border,#e5e5e7)]'} disabled:opacity-60`}>
                        Keep the title on my site
                      </button>
                    </div>
                  )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
