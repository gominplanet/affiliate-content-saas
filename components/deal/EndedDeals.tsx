// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Ended Deals: deal posts whose sale is over, and one press to turn
// each into a lasting review at the same address.
//
// Every post says why it counts as ended, still on, or not known, and after a
// conversion the card lists what was actually done, step by step, including
// any step that was skipped and why. Nothing reads as done unless it was.
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RefreshCw, Wand2, ExternalLink, CheckCircle2, AlertTriangle, Search } from 'lucide-react'
import PageHero from '@/components/layout/PageHero'
import { EndedDealsGuide } from '@/components/guide/tool-guides'
import type { DealPostRow, AftercareReport, ReviveReport } from '@/lib/deal-aftercare-server'

const ACCENT = '#7C3AED'
const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '')

export default function EndedDeals() {
  const [posts, setPosts] = useState<DealPostRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [auto, setAuto] = useState<{ on: boolean; column: boolean } | null>(null)
  const [savingAuto, setSavingAuto] = useState(false)
  // REFRESH SAYS IT REFRESHED. It used to reload quietly: with nothing new,
  // the list looked the same and the button looked broken.
  const [refreshing, setRefreshing] = useState(false)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)
  const [convertingAll, setConvertingAll] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await fetch('/api/deal-aftercare')
      const text = await r.text()
      let j: { posts?: DealPostRow[]; error?: string; auto?: boolean; autoColumn?: boolean }
      try { j = JSON.parse(text) } catch { throw new Error(`The server answered with an error page (HTTP ${r.status}).`) }
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setPosts(j.posts ?? [])
      setAuto({ on: j.auto !== false, column: j.autoColumn !== false })
      setLoadedAt(new Date())
      return j.posts ?? []
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return null }
  }, [])

  async function refresh() {
    setRefreshing(true)
    const got = await load()
    setRefreshing(false)
    if (!got) { toast.error('Could not reload your deal posts. The reason is shown on the page.'); return }
    const live = got.filter((p) => p.phase !== 'lasting')
    const n = (f: (p: DealPostRow) => boolean) => live.filter(f).length
    toast.success(`Up to date: ${n((p) => p.state === 'ended')} ended, ${n((p) => p.state === 'on')} still on sale, ${n((p) => p.state === 'unknown')} not known yet, ${got.length - live.length} lasting reviews.`)
  }
  useEffect(() => { load() }, [load])

  const groups = useMemo(() => {
    const all = posts ?? []
    const live = all.filter((p) => p.phase !== 'lasting')
    const lasting = all.filter((p) => p.phase === 'lasting')
    return {
      ended: live.filter((p) => p.state === 'ended'),
      unknown: live.filter((p) => p.state === 'unknown'),
      on: live.filter((p) => p.state === 'on' && p.phase === 'deal'),
      revived: live.filter((p) => p.state === 'on' && p.phase === 'revived'),
      saleAgain: lasting.filter((p) => p.state === 'on'),
      done: lasting.filter((p) => p.state !== 'on'),
      toCheck: all.filter((p) => p.needsCheck ?? p.state === 'unknown').length,
    }
  }, [posts])

  async function setAutoOn(on: boolean) {
    setSavingAuto(true)
    try {
      const r = await fetch('/api/deal-aftercare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'auto', on }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setAuto({ on: j.auto === true, column: true })
      toast.success(j.auto ? 'Automatic is on.' : 'Automatic is off. Nothing changes on its own.')
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    setSavingAuto(false)
  }

  async function revive(p: DealPostRow) {
    setBusy(p.id)
    try {
      const r = await fetch('/api/deal-aftercare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revive', postId: p.id }) })
      const j = await r.json().catch(() => ({ ok: false, error: `The server answered with an error page (HTTP ${r.status}).` }))
      setResults((m) => ({ ...m, [p.id]: j.ok ? { ok: true, text: 'The deal is back in the post.' } : { ok: false, text: j.error || 'Not changed.' } }))
    } finally { setBusy(null) }
    await load()
  }

  async function checkPrices() {
    setChecking(true)
    try {
      const r = await fetch('/api/deal-aftercare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check' }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      toast.success(`Checked ${j.checked}: ${j.ended} ended, ${j.on} still on sale, ${j.unknown} could not be checked${j.left ? `. ${j.left} left, press again.` : '.'}`)
      await load()
    } catch (e) { toast.error(`Price check failed: ${e instanceof Error ? e.message : String(e)}`) }
    setChecking(false)
  }

  async function convert(p: DealPostRow): Promise<boolean> {
    setBusy(p.id)
    try {
      const r = await fetch('/api/deal-aftercare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'convert', postId: p.id }) })
      const text = await r.text()
      let j: { ok?: boolean; error?: string; report?: AftercareReport }
      try { j = JSON.parse(text) } catch { j = { ok: false, error: `The server answered with an error page (HTTP ${r.status}). Check the post before trying again.` } }
      if (!j.ok) { setResults((m) => ({ ...m, [p.id]: { ok: false, text: j.error || 'Not changed.' } })); return false }
      setResults((m) => ({ ...m, [p.id]: { ok: true, text: 'Now a lasting review.' } }))
      return true
    } finally { setBusy(null) }
  }

  async function convertAll() {
    if (convertingAll) return
    setConvertingAll(true)
    const list = [...groups.ended]
    let done = 0
    try {
      for (const p of list) { if (await convert(p)) done++ }
    } finally { setConvertingAll(false) }
    if (done === list.length) toast.success(`${done} of ${list.length} posts are now lasting reviews.`)
    else toast.warning(`${done} of ${list.length} posts are now lasting reviews. The others say why on their cards.`)
    await load()
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHero guide={<EndedDealsGuide />} title="Ended Deals" subtitle="Deal posts whose sale is over. Turn each into a lasting review at the same address, so it keeps ranking and keeps earning." />

      <div className="card p-4 mb-4 text-[13px] leading-relaxed text-[#3a3a3c] dark:text-[#d1d1d6]">
        When a deal ends, its post still says &quot;Save 27%&quot; and &quot;Active deal&quot;. Making it a lasting review marks the deal
        boxes ended (they then show &quot;This deal has ended&quot; with a working &quot;Check today&apos;s price&quot; button), takes the sale
        wording out of the article, and gives it a title and intro that stay true. The address does not change.
        <span className="block mt-1 text-[12px] text-[#86868b]">The deal boxes need the MVP plugin 1.0.97 or later on your site. Update it under Plugins in WordPress.</span>
      </div>

      {auto && (
        <div className="card p-4 mb-4 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={auto.on} disabled={savingAuto || !auto.column} onChange={(e) => setAutoOn(e.target.checked)} className="w-4 h-4 accent-[#7C3AED]" />
            <span className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Automatic {auto.on ? 'on' : 'off'}</span>
          </label>
          <span className="text-[12px] text-[#6e6e73] dark:text-[#aeaeb2] flex-1 min-w-[240px]">
            {auto.on
              ? 'Every six hours MVP makes ended deals lasting reviews, and brings the deal back when a product is on sale again. Only on a real answer: a passed end date or a fresh price check.'
              : 'Nothing changes on its own. The buttons below still work.'}
            {!auto.column && ' Run migrations 380 and 386 to be able to switch it on or off.'}
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={convertAll} disabled={!groups.ended.length || !!busy || convertingAll}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-[13px] font-semibold disabled:opacity-40" style={{ background: ACCENT }}>
          {busy || convertingAll ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Make all {groups.ended.length} ended deals lasting reviews
        </button>
        <button onClick={checkPrices} disabled={checking || !groups.toCheck}
          title={groups.toCheck ? 'Look up whether these are on sale now' : 'Every post has a recent answer; nothing to check'}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-2,#e5e5e7)] text-[13px] font-medium disabled:opacity-40">
          {checking ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Check prices for {groups.toCheck} not known yet
        </button>
        <button onClick={() => void refresh()} disabled={refreshing}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-[var(--border-2,#e5e5e7)] text-[12px] disabled:opacity-60">
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        {loadedAt && <span className="self-center text-[11.5px] text-[#86868b]">Updated {loadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
      </div>

      {error && <div className="card p-3 mb-3 text-[12px] text-[#ff3b30]">Could not load your deal posts: {error}</div>}
      {posts === null && !error && <div className="flex items-center gap-2 text-[13px] text-[#86868b] py-10 justify-center"><Loader2 size={14} className="animate-spin" /> Reading your deal posts…</div>}
      {posts && posts.length === 0 && <div className="card p-6 text-[13px] text-[#6e6e73]">You have no published single-product deal posts.</div>}

      <Section title="Deal ended" note="The sale is over and the post still says it is on." posts={groups.ended} busy={busy} results={results} action={{ label: 'Make it a lasting review', run: async (p) => { await convert(p); await load() } }} />
      <Section title="Back on sale" note="Lasting reviews whose product is on sale again. Bringing the deal back changes the deal box and the intro only." posts={groups.saleAgain} busy={busy} results={results} action={{ label: 'Bring the deal back', run: revive }} />
      <Section title="Not known yet" note="No answer yet on whether they are on sale. Check prices to find out." posts={groups.unknown} busy={busy} results={results} />
      <Section title="Deal brought back" note="On sale again, with the deal back in the box. It goes back to a lasting review when this sale ends." posts={groups.revived} busy={busy} results={results} />
      <Section title="Still on sale" note="Left as they are while the sale runs." posts={groups.on} busy={busy} results={results} />
      <Section title="Lasting reviews" note="Converted by MVP. What was done is listed on each." posts={groups.done} busy={busy} results={results} />
    </div>
  )
}

function Section({ title, note, posts, busy, results, action }: {
  title: string; note: string; posts: DealPostRow[]; busy: string | null
  results: Record<string, { ok: boolean; text: string }>; action?: { label: string; run: (p: DealPostRow) => void }
}) {
  if (!posts.length) return null
  return (
    <section className="mb-6">
      <h2 className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{title} <span className="text-[#86868b] font-normal">({posts.length})</span></h2>
      <p className="text-[12px] text-[#86868b] mb-2">{note}</p>
      <ul className="flex flex-col gap-2">
        {posts.map((p) => (
          <li key={p.id} className="card p-3 text-[12px]">
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{p.title}</p>
                <p className="text-[#86868b]">{p.asin} · published {fmt(p.publishedAt)} · {p.why}</p>
              </div>
              {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#0a84ff]">View <ExternalLink size={11} /></a>}
              {action && (
                <button onClick={() => action.run(p)} disabled={!!busy}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-white font-semibold disabled:opacity-40" style={{ background: ACCENT }}>
                  {busy === p.id ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} {action.label}
                </button>
              )}
            </div>
            {results[p.id] && (
              <p className={`mt-2 flex items-start gap-1.5 ${results[p.id].ok ? 'text-[#248a3d]' : 'text-[#d70015]'}`}>
                {results[p.id].ok ? <CheckCircle2 size={13} className="shrink-0 mt-px" /> : <AlertTriangle size={13} className="shrink-0 mt-px" />}{results[p.id].text}
              </p>
            )}
            {p.salePct != null && <p className="mt-1 text-[#248a3d]">About {Math.round(p.salePct)}% off at the latest price check.</p>}
            {p.aftercare && <Report r={p.aftercare} />}
            {p.revive && <RevivedLine r={p.revive} />}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Report({ r }: { r: AftercareReport }) {
  const line = (ok: boolean, text: string) => (
    <li className={`flex items-start gap-1.5 ${ok ? 'text-[#248a3d]' : 'text-[#c93400]'}`}>
      {ok ? <CheckCircle2 size={12} className="shrink-0 mt-px" /> : <AlertTriangle size={12} className="shrink-0 mt-px" />}<span>{text}</span>
    </li>
  )
  return (
    <ul className="mt-2 flex flex-col gap-0.5 text-[11px]">
      <li className="text-[#86868b]">Made a lasting review {fmt(r.at)}{r.auto ? ' by the automatic job' : ''}:</li>
      {line(r.boxes !== 'none', r.boxes === 'ended' ? 'Deal boxes marked ended.' : r.boxes === 'already' ? 'Deal boxes were already marked ended.' : 'The post had no deal box to mark.')}
      {line(r.article === 'rewritten' || r.article === 'already', r.article === 'rewritten' ? 'Sale wording taken out of the article.' : r.article === 'already' ? 'The article was already a lasting review from before.' : r.articleWhy || 'The article text was not changed.')}
      {line(true, r.title ? `Title: "${r.title.before}" is now "${r.title.after}".` : 'The title had no sale wording to take out.')}
      {line(r.excerpt && r.meta, 'Intro and search description replaced with lasting ones.')}
    </ul>
  )
}

function RevivedLine({ r }: { r: ReviveReport }) {
  return (
    <p className="mt-1 flex items-start gap-1.5 text-[11px] text-[#248a3d]">
      <CheckCircle2 size={12} className="shrink-0 mt-px" />
      <span>
        Deal brought back {fmt(r.at)}{r.auto ? ' by the automatic job' : ''}: {r.boxes === 'added' ? 'a deal box was added' : 'the deal box shows the sale again'}
        {r.pct != null ? ` at about ${Math.round(r.pct)}% off` : ''}{r.endsAt ? `, counting down to ${fmt(r.endsAt)}` : ''}, and the intro says it is on sale again.
      </span>
    </p>
  )
}
