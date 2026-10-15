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
interface OffTopic { postId: string; url: string; title: string; editUrl?: string }
interface Shared { url: string; liveTitle?: string | null; records: Array<{ postId: string; title: string | null; onSite?: boolean }> }
interface Result { checked: number; missing: number; differs: Differs[]; misfiled: Misfiled[]; offTopic?: OffTopic[]; shared?: Shared[]; unread: string[]; unconnected: string[] }

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

  // One post, two records: keep the chosen record on the post; the others are
  // unlinked and kept in MVP as drafts.
  const keepRecord = async (g: Shared, keepId: string) => {
    setActing(g.url)
    try {
      const r = await fetch('/api/tools/title-audit/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'keep-record', keepId }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { toast.error(j.error || 'Nothing was changed.'); return }
      setDone((x) => ({ ...x, [g.url]: j.unlinked ? `Kept this record on the post. ${j.unlinked === 1 ? 'The other record was' : `The other ${j.unlinked} records were`} unlinked and kept in MVP as ${j.unlinked === 1 ? 'a draft' : 'drafts'}, so nothing is lost.` : 'Only this record points at the post now. Nothing else to change.' }))
    } finally { setActing(null) }
  }

  // A post about something other than its address: a new address from its
  // title, with a 301 from the old one.
  const matchAddress = async (o: OffTopic) => {
    setActing(o.postId)
    try {
      const r = await fetch('/api/tools/title-audit/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'match-address', postId: o.postId }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { toast.error(j.error || 'Nothing was changed.'); return }
      setDone((x) => ({ ...x, [o.postId]: j.unchanged ? 'The address already matches the title.' : `New address: ${j.url}. The old one sends visitors and Google there${j.redirect === 'plugin' ? ' (a 301 in the MVP plugin)' : ' (WordPress redirects an old post address on its own)'}.` }))
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

          {(res.shared?.length ?? 0) > 0 && (
            <div className="mt-3 rounded-lg border border-[#ff3b30]/40 p-3">
              <p className="font-semibold">{res.shared!.length} post{res.shared!.length === 1 ? ' is' : 's are'} claimed by more than one video in MVP</p>
              <p className="text-[12px] text-[#6e6e73] mt-0.5">
                Each fix MVP runs from either record writes that record&apos;s text into the same post, so it can end up with one video&apos;s title and another video&apos;s review. Keep the record that belongs on this post. The others are unlinked from it and kept in MVP as drafts; nothing on your site changes.
              </p>
              <div className="mt-2 flex flex-col gap-3 text-[12px]">
                {res.shared!.map((g) => (
                  <div key={g.url}>
                    <a href={g.url} target="_blank" rel="noopener noreferrer" className="underline break-all">{g.url}</a>
                    {done[g.url]
                      ? <p className="mt-1 text-[#1f8a3a]">{done[g.url]}</p>
                      : (
                        <ul className="mt-1.5 flex flex-col gap-1.5">
                          {g.records.map((rec) => (
                            <li key={rec.postId} className="flex flex-wrap items-center gap-2">
                              <span className="flex-1 min-w-[12rem]">
                                {rec.title || 'Untitled record'}
                                {rec.onSite && <span className="ml-1.5 text-[11px] font-semibold text-[#1f8a3a]">This is the title on your site</span>}
                              </span>
                              <button onClick={() => keepRecord(g, rec.postId)} disabled={acting === g.url}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${rec.onSite ? 'bg-[#7C3AED] text-white' : 'border border-[var(--border,#e5e5e7)]'} disabled:opacity-60`}>
                                {acting === g.url ? 'Working…' : 'Keep this one'}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(res.offTopic?.length ?? 0) > 0 && (
            <div className="mt-3 rounded-lg border border-[#ff3b30]/40 p-3">
              <p className="font-semibold">{res.offTopic!.length} post{res.offTopic!.length === 1 ? ' is' : 's are'} about something other than {res.offTopic!.length === 1 ? 'its' : 'their'} address</p>
              <p className="text-[12px] text-[#6e6e73] mt-0.5">
                The title shares no word with the post&apos;s address, which was made from its first title. Open the post first. If the post is right and only the address is old, give it a matching address: the old one keeps working and sends visitors and Google to the new one. If the post is about the wrong product, fix it in WordPress instead.
              </p>
              <div className="mt-2 flex flex-col gap-3 text-[12px]">
                {res.offTopic!.map((o) => (
                  <div key={o.postId}>
                    <p><a href={o.url} target="_blank" rel="noopener noreferrer" className="underline break-all">{o.url}</a>: titled &quot;{o.title}&quot;</p>
                    {done[o.postId]
                      ? <p className="mt-1 text-[#1f8a3a] break-all">{done[o.postId]}</p>
                      : (
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          <button onClick={() => matchAddress(o)} disabled={acting === o.postId}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#7C3AED] text-white disabled:opacity-60">
                            {acting === o.postId ? 'Working…' : 'Give it a matching address'}
                          </button>
                          {o.editUrl && (
                            <a href={o.editUrl} target="_blank" rel="noopener noreferrer"
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[var(--border,#e5e5e7)] inline-flex items-center gap-1">
                              Open in WordPress <ExternalLink size={11} />
                            </a>
                          )}
                        </div>
                      )}
                  </div>
                ))}
              </div>
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
