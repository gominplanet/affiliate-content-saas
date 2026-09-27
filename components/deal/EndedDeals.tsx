// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Ended deals (LABS): deal posts whose sale is over, and one press to turn
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
import type { DealPostRow, AftercareReport } from '@/lib/deal-aftercare-server'

const ACCENT = '#7C3AED'
const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '')

export default function EndedDeals() {
  const [posts, setPosts] = useState<DealPostRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({})

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await fetch('/api/deal-aftercare')
      const text = await r.text()
      let j: { posts?: DealPostRow[]; error?: string }
      try { j = JSON.parse(text) } catch { throw new Error(`The server answered with an error page (HTTP ${r.status}).`) }
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setPosts(j.posts ?? [])
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const groups = useMemo(() => {
    const all = posts ?? []
    return {
      ended: all.filter((p) => p.state === 'ended' && !p.convertedAt),
      done: all.filter((p) => !!p.convertedAt),
      unknown: all.filter((p) => p.state === 'unknown' && !p.convertedAt),
      on: all.filter((p) => p.state === 'on' && !p.convertedAt),
    }
  }, [posts])

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
    let done = 0
    for (const p of groups.ended) { if (await convert(p)) done++ }
    toast.success(`${done} of ${groups.ended.length} posts are now lasting reviews.`)
    await load()
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHero title="Ended deals" subtitle="Deal posts whose sale is over. Turn each into a lasting review at the same address, so it keeps ranking and keeps earning." />

      <div className="card p-4 mb-4 text-[13px] leading-relaxed text-[#3a3a3c] dark:text-[#d1d1d6]">
        When a deal ends, its post still says &quot;Save 27%&quot; and &quot;Active deal&quot;. Making it a lasting review marks the deal
        boxes ended (they then show &quot;This deal has ended&quot; with a working &quot;Check today&apos;s price&quot; button), takes the sale
        wording out of the article, and gives it a title and intro that stay true. The address does not change.
        <span className="block mt-1 text-[12px] text-[#86868b]">The deal boxes need the MVP plugin 1.0.97 or later on your site. Update it under Plugins in WordPress.</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={convertAll} disabled={!groups.ended.length || !!busy}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-[13px] font-semibold disabled:opacity-40" style={{ background: ACCENT }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Make all {groups.ended.length} ended deals lasting reviews
        </button>
        <button onClick={checkPrices} disabled={checking || !groups.unknown.length}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-2,#e5e5e7)] text-[13px] font-medium disabled:opacity-40">
          {checking ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Check prices for {groups.unknown.length} with no end date
        </button>
        <button onClick={load} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-[var(--border-2,#e5e5e7)] text-[12px]"><RefreshCw size={12} /> Refresh</button>
      </div>

      {error && <div className="card p-3 mb-3 text-[12px] text-[#ff3b30]">Could not load your deal posts: {error}</div>}
      {posts === null && !error && <div className="flex items-center gap-2 text-[13px] text-[#86868b] py-10 justify-center"><Loader2 size={14} className="animate-spin" /> Reading your deal posts…</div>}
      {posts && posts.length === 0 && <div className="card p-6 text-[13px] text-[#6e6e73]">You have no published single-product deal posts.</div>}

      <Section title="Deal ended" note="The sale is over and the post still says it is on." posts={groups.ended} busy={busy} results={results} onConvert={async (p) => { await convert(p); await load() }} />
      <Section title="Not known yet" note="No end date was saved. Check prices to find out whether they are still on sale." posts={groups.unknown} busy={busy} results={results} />
      <Section title="Still on sale" note="Left as they are while the sale runs." posts={groups.on} busy={busy} results={results} />
      <Section title="Already lasting reviews" note="Converted by MVP. What was done is listed on each." posts={groups.done} busy={busy} results={results} />
    </div>
  )
}

function Section({ title, note, posts, busy, results, onConvert }: {
  title: string; note: string; posts: DealPostRow[]; busy: string | null
  results: Record<string, { ok: boolean; text: string }>; onConvert?: (p: DealPostRow) => void
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
              {onConvert && (
                <button onClick={() => onConvert(p)} disabled={!!busy}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-white font-semibold disabled:opacity-40" style={{ background: ACCENT }}>
                  {busy === p.id ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Make it a lasting review
                </button>
              )}
            </div>
            {results[p.id] && (
              <p className={`mt-2 flex items-start gap-1.5 ${results[p.id].ok ? 'text-[#248a3d]' : 'text-[#d70015]'}`}>
                {results[p.id].ok ? <CheckCircle2 size={13} className="shrink-0 mt-px" /> : <AlertTriangle size={13} className="shrink-0 mt-px" />}{results[p.id].text}
              </p>
            )}
            {p.aftercare && <Report r={p.aftercare} />}
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
      <li className="text-[#86868b]">Converted {fmt(r.at)}:</li>
      {line(r.boxes !== 'none', r.boxes === 'ended' ? 'Deal boxes marked ended.' : r.boxes === 'already' ? 'Deal boxes were already marked ended.' : 'The post had no deal box to mark.')}
      {line(r.article === 'rewritten', r.article === 'rewritten' ? 'Sale wording taken out of the article.' : r.articleWhy || 'The article text was not changed.')}
      {line(true, r.title ? `Title: "${r.title.before}" is now "${r.title.after}".` : 'The title had no sale wording to take out.')}
      {line(r.excerpt && r.meta, 'Intro and search description replaced with lasting ones.')}
    </ul>
  )
}
