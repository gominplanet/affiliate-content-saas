// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Idea Lists → Shopping Guide. Pick one of your SCOUT-synced Amazon idea lists
// (or paste a URL), MVP scores the products and writes a curated shopping-guide
// post linking each pick + your full list.
'use client'

import { useCallback, useEffect, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { toast } from 'sonner'
import { Loader2, Search, Sparkles, ExternalLink, ListChecks, Pencil, RefreshCw } from 'lucide-react'
import { errText } from '@/lib/err-text'
import { createBrowserClient } from '@/lib/supabase/client'
import { HeadlineStyleToggle, useHeadlineStyle, headlineStyleValue } from '@/components/thumbnails/HeadlineStyleToggle'


interface Item { asin: string; title: string | null; image: string | null }
interface SyncedList { id: string; title: string | null; url: string | null; itemCount: number | null; coverImage: string | null; syncedItems: number; hasItems: boolean }
// A ranked product for the manual checklist.
interface RankedItem { asin: string; title: string; image: string | null; priceCents: number | null; rating: number | null; reviews: number | null; discountPct: number | null; hasCampaign: boolean; rank: number }
// The active list to generate from: either a synced list (by id) or a pasted-URL scan.
interface Active { source: 'synced' | 'url'; listId?: string; title: string | null; count: number | null; items: Item[]; url: string | null; partial: boolean }
const PURPLE = '#7C3AED'
const dollars = (c: number | null) => (c == null ? null : `$${(c / 100).toFixed(2)}`)

export default function IdeaListsPage() {
  const [synced, setSynced] = useState<SyncedList[]>([])
  const [loadingSynced, setLoadingSynced] = useState(true)
  const [storefrontUrl, setStorefrontUrl] = useState<string | null>(null)
  const [storefrontInput, setStorefrontInput] = useState('')
  const [url, setUrl] = useState('')
  const [scanning, setScanning] = useState(false)
  const [active, setActive] = useState<Active | null>(null)
  const [count, setCount] = useState(10)
  const [question, setQuestion] = useHeadlineStyle()
  const [generating, setGenerating] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [done, setDone] = useState<{ url: string; title: string; picked: number; postId: string | null; wpPostId: number | null } | null>(null)
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [ranked, setRanked] = useState<RankedItem[] | null>(null)
  const [ranking, setRanking] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const loadSynced = useCallback(async () => {
    setLoadingSynced(true)
    try {
      const res = await fetch('/api/idea-list/ingest')
      const d = await res.json()
      if (res.ok) {
        setSynced((d.lists || []) as SyncedList[])
        setStorefrontUrl((d.storefrontUrl as string | null) || null)
      }
    } catch { /* non-fatal */ }
    finally { setLoadingSynced(false) }
  }, [])
  useEffect(() => { void loadSynced() }, [loadSynced])

  // Open the creator's Amazon storefront in a new tab so SCOUT can enumerate
  // their idea lists. `raw` is either the saved storefront or a URL they type;
  // we reduce it to the /shop/<handle> root and, if they typed it, save it to
  // the brand profile so next time it's a one-click button.
  const openStorefront = async (raw: string, persist: boolean) => {
    const m = (raw || '').match(/amazon\.[a-z.]+\/shop\/([^/?#\s]+)/i) || (raw || '').trim().match(/^@?([A-Za-z0-9._-]{2,})$/)
    if (!m) { toast.error('Enter your Amazon storefront link (amazon.com/shop/yourhandle).'); return }
    const root = `https://www.amazon.com/shop/${m[1]}`
    // #mvp-sync tells SCOUT this visit is MVP-initiated, so it runs the idea-list
    // scan. A plain storefront visit (no marker) leaves idea lists alone.
    window.open(`${root}#mvp-sync`, '_blank', 'noopener,noreferrer')
    setStorefrontUrl(root)
    if (persist) {
      try {
        const supabase = createBrowserClient()
        const { data: { user } } = await supabase.auth.getUser()
        // Update only — never insert a bare brand_profiles row (it has required
        // columns). If the profile doesn't exist yet this is a harmless no-op.
        if (user) await supabase.from('brand_profiles').update({ amazon_storefront_url: root } as never).eq('user_id', user.id)
      } catch { /* best-effort — the tab already opened */ }
    }
  }

  const resetManual = () => { setMode('auto'); setRanked(null); setSelected(new Set()) }

  const pickSynced = (l: SyncedList) => {
    setDone(null); resetManual()
    setActive({ source: 'synced', listId: l.id, title: l.title, count: l.itemCount, items: [], url: l.url, partial: false })
    setCount(Math.min(10, Math.max(3, Math.min(l.syncedItems || l.itemCount || 10, 10))))
  }

  const runScan = async () => {
    if (!url.trim()) { toast.error('Paste your Amazon idea-list link.'); return }
    setScanning(true); setActive(null); setDone(null); resetManual()
    try {
      const res = await fetch('/api/idea-list/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) })
      const d = await res.json()
      if (!res.ok || !d.ok) throw new Error(d.error || 'Could not read that list.')
      setActive({ source: 'url', title: d.title, count: d.declaredCount, items: d.items as Item[], url: url.trim(), partial: !!d.partial })
      setCount(Math.min(10, Math.max(3, Math.min((d.items?.length ?? 10), 10))))
    } catch (e) { toast.error(errText(e)) }
    finally { setScanning(false) }
  }

  // Poll the sync endpoint until this list's products land (SCOUT captures them
  // in the tab we opened). Returns true once synced, false after ~70s.
  const pollForProducts = async (listId: string): Promise<boolean> => {
    for (let i = 0; i < 23; i++) {
      await new Promise(r => setTimeout(r, 3000))
      try {
        const res = await fetch('/api/idea-list/ingest')
        const d = await res.json()
        if (res.ok) {
          const lists = (d.lists || []) as SyncedList[]
          setSynced(lists)
          const l = lists.find(x => x.id === listId)
          if (l && l.hasItems) return true
        }
      } catch { /* keep polling */ }
    }
    return false
  }

  // Manual mode: rank every product in the list so the creator can hand-pick.
  // If a synced list hasn't pulled its products yet, sync it first (open Amazon,
  // SCOUT reads it) — no auto→create→manual round-trip.
  const loadRanking = async () => {
    if (!active || ranking) return
    setRanking(true); setRanked(null)
    try {
      if (active.source === 'synced') {
        const l = synced.find(s => s.id === active.listId)
        // No items synced yet → try SCOUT (opens Amazon, reads the FULL list).
        // If it doesn't finish, don't dead-end: fall through and let the rank
        // call read the list URL server-side (~first 20) so there's always
        // something to pick from.
        if (l && !l.hasItems && active.url) {
          const tab = window.open(active.url + '#mvp-sync', '_blank')   // #mvp-sync authorizes SCOUT (your own list)
          const ok = await pollForProducts(active.listId!)
          try { tab?.close() } catch { /* user can close */ }
          if (!ok) toast('Loaded the first products from Amazon — open the list with SCOUT for the full set.')
        }
      }
      const payload = active.source === 'synced' ? { listId: active.listId, listUrl: active.url } : { items: active.items }
      const res = await fetch('/api/idea-list/rank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const d = await res.json()
      if (!res.ok || !d.ok) throw new Error(d.error || 'Could not rank this list.')
      const items = (d.products || []) as RankedItem[]
      setRanked(items)
      // Pre-tick MVP's top picks as a starting point.
      setSelected(new Set(items.slice(0, Math.min(count, 20)).map(p => p.asin)))
    } catch (e) { toast.error(errText(e)) }
    finally { setRanking(false) }
  }
  const toggleSelect = (asin: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(asin)) next.delete(asin)
      else if (next.size >= 20) { toast.error('A guide can hold up to 20 products.'); return prev }
      else next.add(asin)
      return next
    })
  }
  const goManual = () => { setMode('manual'); if (!ranked && !ranking) void loadRanking() }

  const generate = async () => {
    if (!active) return
    // Manual mode: build from exactly the ticked products (MVP-ranked order).
    if (mode === 'manual') {
      if (selected.size < 3) { toast.error('Pick at least 3 products.'); return }
      const asins = (ranked || []).filter(p => selected.has(p.asin)).map(p => p.asin).slice(0, 20)
      setGenerating(true); setDone(null)
      try {
        const payload = active.source === 'synced'
          ? { listId: active.listId, asins, count: asins.length, listTitle: active.title, listUrl: active.url, headlineStyle: headlineStyleValue(question) }
          : { items: active.items, asins, count: asins.length, listTitle: active.title, listUrl: active.url, headlineStyle: headlineStyleValue(question) }
        const res = await fetch('/api/idea-list/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        const d = await res.json()
        if (!res.ok || !d.ok) throw new Error(d.error || 'Could not build the guide.')
        setDone({ url: d.url, title: d.title, picked: d.picked, postId: d.postId ?? null, wpPostId: d.wpPostId ?? null })
        toast.success('Shopping guide published')
      } catch (e) { toast.error(errText(e)) }
      finally { setGenerating(false) }
      return
    }
    // If a synced list has no products yet, open it on Amazon so SCOUT captures
    // them, wait for them to land, THEN build the guide — no manual refresh.
    if (active.source === 'synced') {
      const l = synced.find(s => s.id === active.listId)
      if (l && !l.hasItems) {
        if (!active.url) { toast.error('No Amazon link for this list — paste its URL above instead.'); return }
        // Open synchronously inside the click so the popup isn't blocked. No
        // `noopener` here on purpose — we keep the handle so we can auto-close
        // the tab once SCOUT has read the products (least friction for the user).
        const tab = window.open(active.url + '#mvp-sync', '_blank')   // #mvp-sync authorizes SCOUT (your own list)
        setSyncing(true)
        const ok = await pollForProducts(active.listId!)
        setSyncing(false)
        try { tab?.close() } catch { /* user can close it */ }
        if (!ok) { toast.error('Amazon didn’t finish loading this list in time. Click Create again to retry.'); return }
        toast.success('Products synced — building your guide')
      }
    }
    setGenerating(true); setDone(null)
    try {
      const payload = active.source === 'synced'
        ? { listId: active.listId, count, headlineStyle: headlineStyleValue(question) }
        : { items: active.items, listTitle: active.title, listUrl: active.url, count, headlineStyle: headlineStyleValue(question) }
      const res = await fetch('/api/idea-list/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const d = await res.json()
      if (!res.ok || !d.ok) throw new Error(d.error || 'Could not build the guide.')
      setDone({ url: d.url, title: d.title, picked: d.picked, postId: d.postId ?? null, wpPostId: d.wpPostId ?? null })
      toast.success('Shopping guide published')
    } catch (e) { toast.error(errText(e)) }
    finally { setGenerating(false) }
  }

  // How many products we can actually pick from.
  const available = active ? (active.source === 'synced' ? (synced.find(s => s.id === active.listId)?.syncedItems || active.count || 20) : active.items.length) : 20
  const maxPicks = Math.min(20, available || 20)
  // Clean presets — "Top 10 / 12 / 15 / 20", capped at what's available.
  const presets = [10, 12, 15, 20].filter(n => n <= maxPicks)
  if (presets.length === 0 && maxPicks >= 3) presets.push(maxPicks)

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <PageHero
        title="Idea Lists → Shopping Guide"
        subtitle="Turn an Amazon idea list into a curated shopping-guide post. MVP scores the products, picks the best, and links each one plus your full list."
      />

      {/* How it works — explainer */}
      <div className="rounded-xl border border-[#7C3AED]/25 bg-[#7C3AED]/[0.06] p-4 mt-4">
        <p className="text-[13px] font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">How it works</p>
        <p className="text-[12px] text-[#4b4b4f] dark:text-[#b0b0b5] mb-3">
          Turn any Amazon idea list into a ready-to-publish <strong>shopping guide</strong> on your blog. MVP reads the products, checks each one, ranks them and writes the whole post for you.
        </p>
        <div className="grid sm:grid-cols-3 gap-3 text-[12px]">
          <div>
            <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">1. Load a list</p>
            <p className="text-[#4b4b4f] dark:text-[#b0b0b5] leading-snug"><strong>Paste a link</strong> (below) for a quick read of the first ~20 products, or <strong>choose from the list below</strong> (synced by SCOUT) to pull <em>every</em> product from your storefront.</p>
          </div>
          <div>
            <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">2. MVP ranks it</p>
            <p className="text-[#4b4b4f] dark:text-[#b0b0b5] leading-snug">MVP scores every product against its own ranking criteria — live price, rating, reviews, demand and current deals — and against your Creator Connections campaigns. Campaign products get priority; off-theme products are left out.</p>
          </div>
          <div>
            <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">3. It writes the post</p>
            <p className="text-[#4b4b4f] dark:text-[#b0b0b5] leading-snug">You pick the size (Top 10–20). MVP writes an SEO title, intro, a real blurb per product, a conclusion and a designed thumbnail — each pick with your affiliate link, plus a CTA to your full list.</p>
          </div>
        </div>
        <p className="text-[11px] text-[#86868b] mt-3 leading-snug">
          <strong>What to expect:</strong> the guide publishes straight to your blog (editable and deletable right here). A synced list pulls its products the moment you hit Create (a tab opens, reads it, closes itself). Each guide counts against your monthly generation limit.
        </p>
      </div>

      {/* Paste a list URL — primary path */}
      <div className="rounded-xl border border-black/5 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mt-4">
        <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Paste an idea-list link</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void runScan() }} placeholder="https://www.amazon.com/shop/yourhandle/list/…" className="flex-1 rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]" />
          <button onClick={runScan} disabled={scanning || !url.trim()} className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: PURPLE }}>
            {scanning ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            {scanning ? 'Reading…' : 'Read list'}
          </button>
        </div>
        <p className="text-[11px] text-[#86868b] mt-2">Quickest way in. A pasted link reads the first ~20 products. To use every product in a list, sync it with SCOUT below.</p>
      </div>

      {/* Selected list → pick count → generate */}
      {active && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{active.title || 'Your list'}</p>
            <p className="text-[12px] text-[#86868b]">{available} products available</p>
          </div>
          {active.source === 'url' && active.partial && (
            <div className="rounded-lg border border-[#ff9500]/40 bg-[#ff9500]/10 p-2.5 text-[11px] text-[#9a5d00] dark:text-[#ffcf8f] mb-3">
              Amazon lazy-loads long lists, so this pasted link read the first {active.items.length}. Sync via SCOUT to use all {active.count}.
            </div>
          )}
          {active.source === 'synced' && !synced.find(s => s.id === active.listId)?.hasItems && (
            <div className="rounded-lg border border-[#7C3AED]/40 bg-[#7C3AED]/10 p-2.5 text-[11px] text-[#5b3aa6] dark:text-[#c9b6ff] mb-3">
              This list&apos;s products load on demand. When you click <strong>Create shopping guide</strong>, MVP opens it on Amazon so SCOUT reads every product, then builds the guide automatically. Keep the Amazon tab open until it finishes (SCOUT needs it visible).
            </div>
          )}
          {/* Mode: MVP picks (auto) vs I choose (manual) */}
          <div className="flex gap-1.5 mb-3">
            <button onClick={() => setMode('auto')} className={`rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${mode === 'auto' ? 'text-white border-transparent bg-[#7C3AED]' : 'text-[#4b4b4f] dark:text-[#b0b0b5] border-black/10 dark:border-white/15 hover:border-[#7C3AED]/60'}`}>MVP picks (auto)</button>
            <button onClick={goManual} className={`rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${mode === 'manual' ? 'text-white border-transparent bg-[#7C3AED]' : 'text-[#4b4b4f] dark:text-[#b0b0b5] border-black/10 dark:border-white/15 hover:border-[#7C3AED]/60'}`}>I choose (manual)</button>
          </div>

          {mode === 'auto' ? (
            <div className="flex flex-col sm:flex-row sm:items-end gap-3 rounded-xl border border-[#7C3AED]/25 bg-[#7C3AED]/5 p-4">
              <div className="flex-1">
                <p className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">How big is the guide?</p>
                <div className="flex flex-wrap gap-1.5">
                  {presets.map(n => (
                    <button key={n} onClick={() => setCount(n)} className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${Math.min(count, maxPicks) === n ? 'text-white border-transparent bg-[#7C3AED]' : 'text-[#4b4b4f] dark:text-[#b0b0b5] border-black/10 dark:border-white/15 hover:border-[#7C3AED]/60'}`}>Top {n}</button>
                  ))}
                </div>
                <p className="text-[11px] text-[#86868b] mt-1.5">MVP checks every product in the list and ranks by your sales, demand, deals, campaigns and ratings, then picks the best.</p>
                <div className="mt-3 max-w-xs">
                  <HeadlineStyleToggle question={question} onChange={setQuestion} disabled={generating || syncing} />
                </div>
              </div>
              <button onClick={generate} disabled={generating || syncing} className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-[14px] font-bold text-white disabled:opacity-60" style={{ backgroundColor: PURPLE }}>
                {(generating || syncing) ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {syncing ? 'Syncing products from Amazon…' : generating ? 'Writing your guide…' : 'Create shopping guide'}
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-[#7C3AED]/25 bg-[#7C3AED]/5 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Tick the products you want <span className="font-normal text-[#86868b]">— ranked by MVP to help you choose</span></p>
                <p className="text-[12px] font-bold text-[#7C3AED]">{selected.size} selected</p>
              </div>
              {ranking ? (
                <div className="flex items-center gap-2 text-[13px] text-[#86868b] py-6"><Loader2 size={14} className="animate-spin" /> Loading this list&apos;s products and ranking them… (if an Amazon tab opens, leave it until this finishes)</div>
              ) : !ranked ? (
                <div className="text-[12px] text-[#86868b] py-3">
                  <button onClick={loadRanking} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white" style={{ backgroundColor: PURPLE }}>Load &amp; rank products</button>
                </div>
              ) : (
                <>
                  <div className="max-h-[420px] overflow-y-auto rounded-lg border border-black/5 dark:border-white/10 divide-y divide-black/5 dark:divide-white/10">
                    {ranked.map(p => {
                      const on = selected.has(p.asin)
                      const meta = [dollars(p.priceCents), p.rating ? `${p.rating}★${p.reviews ? ` (${p.reviews.toLocaleString()})` : ''}` : null].filter(Boolean).join(' · ')
                      return (
                        <label key={p.asin} className="flex items-center gap-2.5 p-2 cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                          <input type="checkbox" checked={on} onChange={() => toggleSelect(p.asin)} className="accent-[#7C3AED] w-4 h-4 shrink-0" />
                          <span className="text-[10px] font-bold text-[#86868b] w-6 text-center shrink-0">#{p.rank}</span>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {p.image ? <img src={p.image} alt="" className="w-9 h-9 rounded object-cover bg-black/5 shrink-0" /> : <span className="w-9 h-9 rounded bg-black/5 dark:bg-white/5 shrink-0" />}
                          <span className="flex-1 min-w-0">
                            <span className="block text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7] line-clamp-1">{p.title}</span>
                            <span className="block text-[11px] text-[#86868b] line-clamp-1">{meta || 'No price/rating data'}</span>
                          </span>
                          {p.hasCampaign && <span className="shrink-0 text-[9px] font-bold text-white bg-[#7C3AED] rounded px-1.5 py-0.5">CC</span>}
                        </label>
                      )
                    })}
                  </div>
                  <div className="flex items-center justify-between mt-3 gap-3">
                    <div className="flex gap-3 text-[11px]">
                      <button onClick={() => setSelected(new Set(ranked.slice(0, 10).map(p => p.asin)))} className="text-[#7C3AED] hover:underline font-medium">MVP&apos;s top 10</button>
                      <button onClick={() => setSelected(new Set())} className="text-[#86868b] hover:underline">Clear</button>
                    </div>
                    <button onClick={generate} disabled={generating || selected.size < 3} className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-[14px] font-bold text-white disabled:opacity-60" style={{ backgroundColor: PURPLE }}>
                      {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                      {generating ? 'Writing your guide…' : `Create guide (${selected.size})`}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {done && (
        <div className="mt-4 rounded-xl border border-[#34c759]/30 bg-[#34c759]/[0.06] p-4">
          <p className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Published: {done.title}</p>
          <p className="text-[12px] text-[#4b4b4f] dark:text-[#b0b0b5] mt-0.5 mb-2.5">{done.picked} picks, a fresh thumbnail, and a link to your full list.</p>
          <div className="flex flex-wrap items-center gap-4">
            <a href={done.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#7C3AED] hover:underline">View the post <ExternalLink size={13} /></a>
            <a href="https://www.mvpaffiliate.io/content?tab=posts" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] hover:text-[#7C3AED]"><Pencil size={13} /> Edit or delete in Posts <ExternalLink size={12} /></a>
          </div>
        </div>
      )}
      {/* Your synced idea lists (from SCOUT) */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] inline-flex items-center gap-1.5"><ListChecks size={14} /> Your idea lists</p>
          <div className="flex items-center gap-3">
            {storefrontUrl && (
              <button onClick={() => openStorefront(storefrontUrl, false)} className="text-[12px] font-semibold text-white inline-flex items-center gap-1.5 rounded-full px-3 py-1.5" style={{ backgroundColor: PURPLE }}>
                <ExternalLink size={12} /> Open my storefront
              </button>
            )}
            <button onClick={loadSynced} className="text-[12px] font-medium text-[#7C3AED] hover:underline inline-flex items-center gap-1"><RefreshCw size={12} /> Refresh</button>
          </div>
        </div>
        {loadingSynced ? (
          <div className="flex items-center gap-2 text-[13px] text-[#86868b] py-4"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : synced.length === 0 ? (
          <div className="rounded-xl border border-dashed border-black/10 dark:border-white/15 p-4">
            <p className="text-[12px] text-[#4b4b4f] dark:text-[#b0b0b5]">
              No lists synced yet. Open your Amazon storefront with the SCOUT extension installed and it&apos;ll sync your idea lists here. Or paste a list link above.
            </p>
            {storefrontUrl ? (
              <button onClick={() => openStorefront(storefrontUrl, false)} className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-white" style={{ backgroundColor: PURPLE }}>
                <ExternalLink size={12} /> Open my storefront so SCOUT can sync
              </button>
            ) : (
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <input
                  value={storefrontInput}
                  onChange={e => setStorefrontInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') openStorefront(storefrontInput, true) }}
                  placeholder="amazon.com/shop/yourhandle"
                  className="flex-1 rounded-lg border border-black/10 dark:border-white/15 bg-white dark:bg-[#1c1c1e] px-3 py-2 text-[13px] outline-none focus:border-[#7C3AED]"
                />
                <button onClick={() => openStorefront(storefrontInput, true)} className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white" style={{ backgroundColor: PURPLE }}>
                  <ExternalLink size={13} /> Open storefront
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
            {synced.map(l => {
              const on = active?.source === 'synced' && active.listId === l.id
              return (
                <div key={l.id} className="relative">
                  <button onClick={() => pickSynced(l)} className="w-full text-left rounded-xl border-2 overflow-hidden bg-white dark:bg-[#1c1c1e] transition-colors" style={{ borderColor: on ? PURPLE : 'rgba(128,128,128,0.2)' }}>
                    <div className="aspect-[4/3] bg-black/5 dark:bg-white/5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {l.coverImage ? <img src={l.coverImage} alt={l.title || ''} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[#c7c7cc]"><ListChecks size={22} /></div>}
                    </div>
                    <div className="p-1.5">
                      <p className="text-[11px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] leading-tight line-clamp-2">{l.title || 'Untitled list'}</p>
                      <p className="text-[9px] text-[#86868b] mt-0.5 line-clamp-1">
                        {l.hasItems ? `${l.syncedItems} synced` : `${l.itemCount ?? '?'} items`}
                      </p>
                    </div>
                  </button>
                  {l.url && (
                    <a href={l.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} title="Open this list on Amazon to view or edit it"
                       className="absolute top-1 right-1 inline-flex items-center justify-center rounded-md bg-black/65 hover:bg-black/80 text-white p-1 backdrop-blur-sm">
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
