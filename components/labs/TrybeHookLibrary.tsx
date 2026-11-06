'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE HOOK LIBRARY (Seb, 2026-11-06: "proper scripts ... a very high-end
// output of information, of data that comes from Tribe"). Every opening line
// MVP has written down from TRYBE's Top 100, across every day it watched, not
// only today's: searchable by word, brand or category, filtered by the kind of
// opening (the same five kinds What's working counts), best placed first or
// shortest first, each one to copy. TrybeDaily keeps these behind sign-up.

import { useEffect, useMemo, useState } from 'react'
import { Search, Copy, Check, Loader2, Trophy, PlayCircle } from 'lucide-react'
import { hookType, HOOK_TYPES, type HookType } from '@/lib/trybe-working'
import { BrandName } from '@/components/labs/trybe-dossier-context'

interface Hook { id: string; brandId: string | null; brand: string | null; creator: string | null; rank: number | null; category: string | null; seconds: number | null; hook: string; video: string | null }

const SHOWN = 30

export default function TrybeHookLibrary() {
  const [hooks, setHooks] = useState<Hook[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<HookType | null>(null)
  const [cat, setCat] = useState('')
  const [sort, setSort] = useState<'rank' | 'short'>('rank')
  const [limit, setLimit] = useState(SHOWN)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'hook_library' }) })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `The server answered ${r.status}`); return j })
      .then((j) => { if (live) setHooks((j.hooks || []) as Hook[]) })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : 'no answer') })
    return () => { live = false }
  }, [])

  const cats = useMemo(() => Array.from(new Set((hooks || []).map((h) => h.category).filter(Boolean) as string[])).sort(), [hooks])
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const list = (hooks || []).filter((h) => (!kind || hookType(h.hook) === kind) && (!cat || h.category === cat)
      && words.every((w) => `${h.hook} ${h.brand || ''} ${h.category || ''}`.toLowerCase().includes(w)))
    return sort === 'short' ? [...list].sort((a, b) => a.hook.length - b.hook.length) : list
  }, [hooks, q, kind, cat, sort])

  async function copy(h: Hook) {
    try { await navigator.clipboard.writeText(h.hook); setCopied(h.id); window.setTimeout(() => setCopied((c) => (c === h.id ? null : c)), 1500) } catch { /* the line stays on screen to copy by hand */ }
  }

  const input = 'rounded-xl px-3 py-2 text-[13px]'
  const box = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }

  return (
    <section id="ww-library" className="scroll-mt-24 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-[17px] font-bold" style={{ color: 'var(--text)' }}>Hook library</h3>
        <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>{hooks ? `${hooks.length.toLocaleString()} opening lines from TRYBE’s Top 100, written down by MVP` : 'Every opening line MVP wrote down from TRYBE’s Top 100'}</span>
      </div>
      {err && <p className="text-[13px]" style={{ color: 'var(--text)' }}>The hook library did not load: {err}</p>}
      {!hooks && !err && <p className="text-[13px] inline-flex items-center gap-2" style={{ color: 'var(--text-3)' }}><Loader2 size={14} className="animate-spin" /> Reading the hook library&hellip;</p>}
      {hooks && (<>
        <div className="flex flex-wrap gap-2 items-center">
          <label className={`${input} flex items-center gap-2 flex-1 min-w-[200px]`} style={box}>
            <Search size={14} style={{ color: 'var(--text-3)' }} />
            <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(SHOWN) }} placeholder="Search a word, a product or a brand" className="bg-transparent outline-none flex-1 min-w-0" aria-label="Search the hook library" />
          </label>
          {cats.length > 1 && (
            <select value={cat} onChange={(e) => { setCat(e.target.value); setLimit(SHOWN) }} className={input} style={box} aria-label="Category">
              <option value="">Every category</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select value={sort} onChange={(e) => setSort(e.target.value as 'rank' | 'short')} className={input} style={box} aria-label="Order">
            <option value="rank">Best placed first</option>
            <option value="short">Shortest first</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setKind(null)} aria-pressed={!kind} className="rounded-full px-3 py-1 text-[12px] font-semibold" style={!kind ? { background: 'var(--accent)', color: '#fff' } : box}>Every kind</button>
          {HOOK_TYPES.filter((t) => t.type !== 'other').map((t) => (
            <button key={t.type} type="button" onClick={() => { setKind(kind === t.type ? null : t.type); setLimit(SHOWN) }} aria-pressed={kind === t.type} title={t.says}
              className="rounded-full px-3 py-1 text-[12px] font-semibold" style={kind === t.type ? { background: 'var(--accent)', color: '#fff' } : box}>{t.label}</button>
          ))}
        </div>
        <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>{shown.length.toLocaleString()} match{shown.length === 1 ? '' : 'es'}. Make it yours: change the product and the claim to what you can show on camera.</p>
        <div className="rounded-2xl overflow-hidden" style={box}>
          {shown.slice(0, limit).map((h, i) => (
            <div key={h.id} className="flex items-start gap-3 px-4 py-3" style={{ borderTop: i ? '1px solid var(--border)' : undefined }}>
              <span className="w-10 shrink-0 text-[12px] font-bold pt-0.5 inline-flex items-center gap-1" style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{h.rank ? <><Trophy size={11} style={{ color: '#F59E0B' }} />{h.rank}</> : null}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] leading-snug font-semibold" style={{ color: 'var(--text)' }}>&ldquo;{h.hook}&rdquo;</p>
                <p className="text-[11.5px] mt-1 flex flex-wrap gap-x-2" style={{ color: 'var(--text-3)' }}>
                  {h.brand && (h.brandId ? <BrandName id={h.brandId} name={h.brand} className="font-semibold" /> : <span className="font-semibold">{h.brand}</span>)}
                  {h.category && <span>{h.category}</span>}
                  {h.seconds && <span>{h.seconds}s video</span>}
                  {h.creator && <span>by {h.creator}</span>}
                </p>
              </div>
              <span className="shrink-0 flex flex-col items-end gap-1.5">
                <button type="button" onClick={() => void copy(h)} className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: 'var(--accent-text, var(--accent))' }}>{copied === h.id ? <Check size={12} /> : <Copy size={12} />} {copied === h.id ? 'Copied' : 'Copy'}</button>
                {h.video && <a href={h.video} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11.5px]" style={{ color: 'var(--text-3)' }}><PlayCircle size={12} /> Watch on TRYBE</a>}
              </span>
            </div>
          ))}
          {!shown.length && <p className="px-4 py-4 text-[13px]" style={{ color: 'var(--text-3)' }}>No opening line matches. Try fewer words or every kind.</p>}
        </div>
        {shown.length > limit && <button type="button" onClick={() => setLimit((n) => n + SHOWN)} className="self-start text-[13px] font-semibold rounded-xl px-3.5 py-2" style={box}>Show {Math.min(SHOWN, shown.length - limit)} more</button>}
      </>)}
    </section>
  )
}
