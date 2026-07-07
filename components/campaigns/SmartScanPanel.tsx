'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AMZ Product Finder — ONE search, two plays, both MVP-approved:
//
//   CAMPAIGNS ON  → Affiliate+ (Creator Connections): SCOUT sweeps the
//                   opportunities grid and MVP's proprietary campaign criteria
//                   keep only what's worth your time (score + buy-to-review math).
//   CAMPAIGNS OFF → ONSITE: SCOUT searches Amazon directly (US/CA/UK/AU) for
//                   products worth the buy-to-review investment — vetted against
//                   MVP's onsite criteria (price floor, demand, reviews, rating,
//                   open video carousel). Slower: every result is live-verified
//                   on its product page, in waves, until your chosen count
//                   (10/20/50) is reached or the pool runs dry.
//
// The thresholds are PROPRIETARY — the UI names the vetted dimensions, never
// the numbers (lib/cc-smart-rules.ts is the single source of truth).

import { useState } from 'react'
import { useEffect } from 'react'
import { Sparkles, Loader2, ExternalLink, MessageCircle, ShoppingCart, Play, Star, Bookmark, BookmarkCheck, SlidersHorizontal } from 'lucide-react'
import { requestCcSmartScan, requestCcVerify, requestProductSearch, type FinderProduct, type CatalogCandidate } from '@/lib/extension-frame'
import {
  ONSITE_RULES, AMZ_MARKETPLACES, type AmzMarketplace,
  campaignRules, type CampaignRuleMode,
  passesGates, scoreMatch, type ScoredMatch,
} from '@/lib/cc-smart-rules'
import type { MessageBrandCampaign } from '@/components/campaigns/MessageBrandModal'

const COUNTS = [10, 20, 50] as const
const MAX_WAVES = 6
const PER_WAVE = 12 // deep-check passers requested per SCOUT call (throttle-safe)

export default function SmartScanPanel({
  coveredAsins,
  onMessageBrand,
  onSavedChange,
}: {
  /** ASINs already in the user's queue / covered by their content — skipped. */
  coveredAsins: string[]
  onMessageBrand: (c: MessageBrandCampaign) => void
  /** Fired after a save/unsave so the parent's Saved list can refresh. */
  onSavedChange?: () => void
}) {
  const [mode, setMode] = useState<'campaigns' | 'onsite'>('campaigns')
  // Focus (MVP Profitability Rules — recommended) vs Wide (looser net).
  const [ruleMode, setRuleMode] = useState<CampaignRuleMode>('focus')
  const [focus, setFocus] = useState('')
  const [count, setCount] = useState<(typeof COUNTS)[number]>(10)
  const [market, setMarket] = useState<AmzMarketplace>('us')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Campaign-mode results
  const [matches, setMatches] = useState<ScoredMatch[] | null>(null)
  const [skippedCovered, setSkippedCovered] = useState(0)
  // Catalog pagination — advances each Campaigns-ON scan so re-scanning digs
  // DEEPER (fresh campaigns) instead of returning the same top batch. Reset to
  // 0 whenever the search changes (keyword / rule mode / campaigns toggle).
  const [scanOffset, setScanOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  // Onsite-mode results
  const [products, setProducts] = useState<FinderProduct[] | null>(null)
  // ASINs the user has Saved for later — drives the bookmark toggle on results.
  const [savedAsins, setSavedAsins] = useState<Set<string>>(new Set())

  const marketHost = AMZ_MARKETPLACES.find(m => m.id === market)?.host || 'www.amazon.com'

  // Load which ASINs are already saved so their bookmark shows filled.
  useEffect(() => {
    fetch('/api/campaigns/saved').then(r => r.json()).then(d => {
      if (d?.ok && Array.isArray(d.saved)) setSavedAsins(new Set(d.saved.map((s: { asin: string }) => s.asin.toUpperCase())))
    }).catch(() => {})
  }, [])

  // Save / unsave a find (campaign or onsite product). Optimistic; refreshes the
  // parent's Saved list on success.
  async function toggleSave(payload: {
    asin: string; source: 'campaign' | 'onsite'; title?: string | null; brand?: string | null
    campaignId?: string | null; imageUrl?: string | null; commissionPct?: number | null
    price?: number | null; monthlySales?: number | null; rating?: number | null
    hasVideo?: boolean | null; marketplace?: string; detailsUrl?: string | null
  }) {
    const asin = payload.asin.toUpperCase()
    const wasSaved = savedAsins.has(asin)
    setSavedAsins(prev => { const n = new Set(prev); if (wasSaved) n.delete(asin); else n.add(asin); return n })
    try {
      if (wasSaved) await fetch(`/api/campaigns/saved?asin=${asin}`, { method: 'DELETE' })
      else await fetch('/api/campaigns/saved', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      onSavedChange?.()
    } catch {
      // revert on failure
      setSavedAsins(prev => { const n = new Set(prev); if (wasSaved) n.add(asin); else n.delete(asin); return n })
    }
  }

  const SaveBtn = ({ asin, onClick }: { asin: string; onClick: () => void }) => {
    const saved = savedAsins.has(asin.toUpperCase())
    return (
      <button onClick={onClick}
        title={saved ? 'Saved for later — click to remove' : 'Save for later'}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border"
        style={saved
          ? { borderColor: '#f59e0b', background: 'rgba(245,158,11,0.10)', color: '#b26a00' }
          : { borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
        {saved ? <BookmarkCheck size={11} /> : <Bookmark size={11} />} {saved ? 'Saved' : 'Save'}
      </button>
    )
  }

  // Any change to what we're searching restarts pagination from the top.
  function restartSearch() { setScanOffset(0); setHasMore(false); resetRun() }

  function resetRun() {
    setError(null); setNote(null); setProgress(null)
    setMatches(null); setProducts(null); setSkippedCovered(0)
  }

  // Turn a drops object into a human line — dimensions only, no thresholds.
  function dropLine(d?: { unreadable: number; price: number; sales: number; rating: number; carousel: number; category: number }): string {
    if (!d) return ''
    const bits: string[] = []
    if (d.sales) bits.push(`sales volume ×${d.sales}`)
    if (d.carousel) bits.push(`no product-page video ×${d.carousel}`)
    if (d.price) bits.push(`price ×${d.price}`)
    if (d.rating) bits.push(`rating ×${d.rating}`)
    if (d.category) bits.push(`excluded category ×${d.category}`)
    if (d.unreadable) bits.push(`couldn't read the page ×${d.unreadable}`)
    return bits.length ? ` Dropped on: ${bits.join(' · ')}.` : ''
  }

  // ── CAMPAIGNS ON — CATALOG-FIRST, live-scan fallback ─────────────────────
  // Query the shared CC catalog (instant SQL, no Amazon) for candidates that
  // pass the on-catalog gates, then SCOUT verifies that shortlist by ASIN.
  // Falls back to the live grid scan if the catalog is empty/unavailable.
  async function runCampaigns() {
    const RULES = campaignRules(ruleMode) // MVP Focus vs Wide
    const covered = new Set(coveredAsins.map(a => a.toUpperCase()))
    // Also skip anything already shown in an earlier page this session, so a
    // re-scan never re-surfaces the same campaign even if pages overlap.
    const alreadyShown = new Set((matches ?? []).map(m => (m.asin || '').toUpperCase()).filter(Boolean))
    const paging = scanOffset > 0
    let usedCatalog = false
    try {
      const r = await fetch(`/api/campaigns/catalog-search?q=${encodeURIComponent(focus)}&limit=60&mode=${ruleMode}&offset=${scanOffset}`)
      const data = await r.json().catch(() => ({}))
      if (data?.ok && Array.isArray(data.candidates) && data.candidates.length) {
        usedCatalog = true
        setProgress(`${data.candidates.length} more candidate campaigns from the catalog — SCOUT is live-verifying the best…`)
        const fresh = (data.candidates as CatalogCandidate[]).filter(c => {
          const a = (c.asin || '').toUpperCase()
          return a && !covered.has(a) && !alreadyShown.has(a)
        })
        setSkippedCovered(prev => prev + (data.candidates.length - fresh.length))
        const ver = await requestCcVerify(fresh.slice(0, 40), { ...RULES, wantPassers: 15 })
        setProgress(null)
        if (!ver.ok) {
          setError(ver.error === 'not-installed'
            ? 'SCOUT isn’t connected — install it (see "How it works" above), then scan again.'
            : `Verification failed (${ver.error || 'unknown'}). Try again.`)
          return
        }
        const scored = (ver.results ?? [])
          .filter(m => passesGates(m, RULES))
          .map(m => scoreMatch(m, RULES))
        // Accumulate across pages (dedup by asin), keep best-scored first.
        setMatches(prev => {
          const merged = paging ? [...(prev ?? []), ...scored] : scored
          const seen = new Set<string>()
          return merged
            .filter(m => { const k = (m.asin || m.campaignName || '').toUpperCase(); if (seen.has(k)) return false; seen.add(k); return true })
            .sort((a, b) => b.score - a.score)
        })
        // Advance so the NEXT scan digs deeper; remember if more remain.
        setScanOffset(typeof data.nextOffset === 'number' ? data.nextOffset : scanOffset + 180)
        setHasMore(!!data.hasMore)
        const dl = dropLine(ver.drops)
        const more = data.hasMore ? ' Scan again for the next batch — it digs deeper each time.' : ' That’s the full catalog for this search.'
        if (ver.blocked) setNote(`Amazon asked for a pause partway through — results are partial. Wait ~15 minutes.${dl}`)
        else setNote(`Verified ${ver.deepChecked ?? 0} candidates.${dl}${more}`)
        return
      }
      // Catalog returned nothing new — either exhausted (paging) or unavailable.
      if (paging && data?.ok) { setHasMore(false); setNote('That’s every MVP-approved campaign in the catalog for this search.'); return }
    } catch { /* fall through to the live scan */ }

    // Fallback: live SCOUT grid scan (catalog not loaded yet).
    if (usedCatalog) return
    setProgress(null)
    const res = await requestCcSmartScan(RULES, focus)
    if (!res.ok) {
      setError(
        res.error === 'not-installed'
          ? 'SCOUT isn’t connected — install it (see "How it works" above), then scan again.'
          : res.error === 'timeout'
            ? 'The scan ran long and timed out — try again; a shorter opportunities list scans faster.'
            : res.error === 'sponsored-tab'
              ? 'Your Creator Connections tab is on "Sponsored Products for Creators". Switch it to the "Affiliate+ campaigns" tab (or close it and let SCOUT open its own), then scan again.'
              : `Scan failed (${res.error || 'unknown'}). Open your Creator Connections tab once, then retry.`,
      )
      return
    }
    const raw = res.matches ?? []
    const fresh = raw.filter(m => !(m.asin && covered.has(m.asin.toUpperCase())))
    setSkippedCovered(raw.length - fresh.length)
    const scored = fresh
      .filter(m => passesGates(m, RULES))
      .map(m => scoreMatch(m, RULES))
      .sort((a, b) => b.score - a.score)
    setMatches(scored)
    const s = res.stats
    const dl = dropLine(s?.drops)
    if (s?.blocked) setNote(`Amazon asked for a pause partway through — these results are partial. Wait ~15 minutes before scanning again.${dl}`)
    else if (s?.truncated) setNote(`Checked the top ${s.deepChecked} of ${s.passedOnCard} on-card candidates (Amazon-safe pacing). Scan again later to go deeper.${dl}`)
    else if (dl) setNote(`Deep-checked ${s?.deepChecked ?? 0} candidates.${dl}`)
  }

  // ── CAMPAIGNS OFF — onsite Amazon search, verified in waves ──────────────
  async function runOnsite() {
    if (!focus.trim()) { setError('Enter a keyword — the onsite search needs one (e.g. "massage gun").'); return }
    const covered = new Set(coveredAsins.map(a => a.toUpperCase()))
    const verified: FinderProduct[] = []
    const exclude: string[] = []
    const totalDrops = { card: 0, sales: 0, carousel: 0, rating: 0, unreadable: 0 }
    let blocked = false
    let dry = false
    for (let wave = 1; wave <= MAX_WAVES && verified.length < count; wave++) {
      setProgress(`Verified ${verified.length}/${count} — live-checking products on Amazon (wave ${wave})…`)
      const res = await requestProductSearch(focus, {
        priceMin: ONSITE_RULES.minPrice,
        minRating: ONSITE_RULES.minRating,
        minReviews: ONSITE_RULES.minReviews,
        minSales: ONSITE_RULES.minMonthlySales,
        mustVideo: ONSITE_RULES.requireCarousel,
        maxResults: Math.min(PER_WAVE, count - verified.length),
        marketplace: market,
        excludeAsins: exclude,
      })
      if (!res.ok) {
        if (res.error === 'not-installed') { setError('SCOUT isn’t connected — install it (see "How it works" above), then search again.'); return }
        if (res.error === 'intl-permission-needed') { setError('That marketplace needs a one-time permission: open the SCOUT extension popup and switch on "International Amazon (CA · UK · AU)", then search again.'); return }
        if (res.error === 'amazon-blocked') { blocked = true; break }
        if (res.error === 'no-results') { dry = wave === 1; break }
        if (wave === 1) { setError(`Search failed (${res.error || 'unknown'}). Try again.`); return }
        break // later-wave hiccup — keep what we have
      }
      for (const p of res.products ?? []) {
        if (p.asin && covered.has(p.asin.toUpperCase())) continue
        if (!verified.some(v => v.asin === p.asin)) verified.push(p)
      }
      for (const a of res.checkedAsins ?? []) if (!exclude.includes(a)) exclude.push(a)
      const d = res.drops
      if (d) { totalDrops.card += d.card; totalDrops.sales += d.sales; totalDrops.carousel += d.carousel; totalDrops.rating += d.rating; totalDrops.unreadable += d.unreadable }
      if (res.blocked) { blocked = true; break }
      if (res.poolExhausted) { dry = true; break }
      if (verified.length < count) await new Promise(r => setTimeout(r, 3000)) // breathe between waves
    }
    setProgress(null)
    setProducts(verified.slice(0, count))
    const bits: string[] = []
    if (totalDrops.sales) bits.push(`sales volume ×${totalDrops.sales}`)
    if (totalDrops.carousel) bits.push(`no product video ×${totalDrops.carousel}`)
    if (totalDrops.card) bits.push(`price / rating / reviews ×${totalDrops.card}`)
    if (totalDrops.rating) bits.push(`rating ×${totalDrops.rating}`)
    if (totalDrops.unreadable) bits.push(`couldn't read the page ×${totalDrops.unreadable}`)
    const dropLine = bits.length ? ` Dropped on: ${bits.join(' · ')}.` : ''
    if (blocked) setNote(`Amazon asked for a pause — results are partial. Wait ~15 minutes before searching again.${dropLine}`)
    else if (verified.length < count && dry) setNote(`The search pool ran dry at ${verified.length} MVP-approved product${verified.length !== 1 ? 's' : ''} for this keyword.${dropLine}`)
    else if (dropLine) setNote(`Every result below is live-verified.${dropLine}`)
  }

  async function run() {
    setRunning(true)
    // Paging a Campaigns-ON search (offset>0) KEEPS the accumulated matches and
    // appends; every other case starts clean.
    setError(null); setProgress(null)
    if (!(mode === 'campaigns' && scanOffset > 0)) { setNote(null); setMatches(null); setProducts(null); setSkippedCovered(0) }
    try {
      if (mode === 'campaigns') await runCampaigns()
      else await runOnsite()
    } catch {
      setError('Search failed unexpectedly — reload the page and try again.')
      setProgress(null)
    } finally {
      setRunning(false)
    }
  }

  const Chip = ({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) => (
    <button
      onClick={onClick}
      disabled={running}
      className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-60"
      style={on ? { background: '#7C3AED', color: '#fff' } : { background: 'rgba(124,58,237,0.08)', color: '#7C3AED' }}
    >
      {label}
    </button>
  )

  return (
    <div
      className="card mb-5 overflow-hidden"
      style={{ borderWidth: 2, borderColor: 'rgba(124,58,237,0.45)', boxShadow: '0 14px 36px -16px rgba(124,58,237,0.45)' }}>
      <div className="px-4 py-3" style={{ background: 'linear-gradient(180deg, rgba(124,58,237,0.10), transparent 85%)' }}>
        <div className="flex items-start gap-3 flex-wrap">
          <span className="grid place-items-center w-7 h-7 rounded-lg flex-shrink-0 mt-0.5" style={{ background: 'rgba(124,58,237,0.12)' }}>
            <Sparkles size={14} className="text-[#7C3AED]" />
          </span>
          <div className="flex-1 min-w-[240px]">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
              MVP Finder <span className="font-normal" style={{ color: 'var(--text-faint)' }}>· powered by MVP&apos;s proprietary criteria</span>
            </p>
            <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: 'var(--text-soft)' }}>
              {mode === 'campaigns'
                ? <>SCOUT sweeps your Affiliate+ opportunities and MVP keeps only the campaigns worth your time — vetted for real commission, runway, demand, product quality and review visibility — ranked with the buy-to-review math. Products already in your queue are skipped.</>
                : <>SCOUT searches Amazon directly and live-verifies each product on its page — price, demand, reviews, rating and an open video carousel. Slower by design, but every result is <b>MVP-approved</b>: a product you can confidently invest in, review, and earn from onsite.</>}
            </p>
            <a href="/collaborations" className="inline-flex items-center gap-1 text-[11px] font-semibold hover:underline mt-1.5" style={{ color: '#7C3AED' }}>
              <SlidersHorizontal size={11} /> Customize how your brand messages are written
            </a>
          </div>
        </div>
        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap mt-3">
          {/* Campaigns toggle */}
          <div className="inline-flex items-center gap-1 p-1 rounded-xl" style={{ background: 'rgba(124,58,237,0.06)' }}>
            <Chip on={mode === 'campaigns'} label="Campaigns ON" onClick={() => { setMode('campaigns'); restartSearch() }} />
            <Chip on={mode === 'onsite'} label="Campaigns OFF" onClick={() => { setMode('onsite'); restartSearch() }} />
          </div>
          {/* Focus vs Wide — how strict MVP's picks are (Campaigns ON only). */}
          {mode === 'campaigns' && (
            <div className="inline-flex items-center gap-1 p-1 rounded-xl" style={{ background: 'rgba(124,58,237,0.06)' }}
              title="MVP Focus: the tightest picks, following MVP's Profitability Rules — best results. Wide: casts a broader net (more campaigns, less focused). Both are solid; Focus is stronger.">
              <Chip on={ruleMode === 'focus'} label="MVP Focus" onClick={() => { setRuleMode('focus'); restartSearch() }} />
              <Chip on={ruleMode === 'wide'} label="Wide" onClick={() => { setRuleMode('wide'); restartSearch() }} />
            </div>
          )}
          <input
            value={focus}
            onChange={e => { setFocus(e.target.value); setScanOffset(0); setHasMore(false) }}
            onKeyDown={e => { if (e.key === 'Enter' && !running) run() }}
            placeholder={mode === 'campaigns' ? 'Focus (optional) — e.g. massage gun' : 'Keyword — e.g. massage gun'}
            disabled={running}
            className="text-[12px] px-3 py-2 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 focus:border-[#7C3AED] focus:outline-none w-[200px] disabled:opacity-60"
            style={{ color: 'var(--text)' }}
          />
          {mode === 'onsite' && (
            <>
              <select
                value={count}
                onChange={e => setCount(Number(e.target.value) as (typeof COUNTS)[number])}
                disabled={running}
                title="How many MVP-approved products to deliver"
                className="text-[12px] px-2 py-2 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 focus:outline-none disabled:opacity-60"
                style={{ color: 'var(--text)' }}
              >
                {COUNTS.map(c => <option key={c} value={c}>{c} results</option>)}
              </select>
              <select
                value={market}
                onChange={e => setMarket(e.target.value as AmzMarketplace)}
                disabled={running}
                title="Which Amazon marketplace to search (CA/UK/AU need a one-time permission in the SCOUT popup)"
                className="text-[12px] px-2 py-2 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 focus:outline-none disabled:opacity-60"
                style={{ color: 'var(--text)' }}
              >
                {AMZ_MARKETPLACES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </>
          )}
          <button
            onClick={run}
            disabled={running}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-70"
            style={{ background: '#7C3AED' }}
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {running
              ? (mode === 'onsite' ? 'Verifying…' : 'Scanning… (a few minutes)')
              : (mode === 'onsite' ? 'Find products'
                  : (mode === 'campaigns' && matches && matches.length > 0 && hasMore ? 'Scan again — more' : 'Smart Scan'))}
          </button>
        </div>
      </div>

      {running && (
        <div className="px-4 pb-3 text-[12px]" style={{ color: 'var(--text-faint)' }}>
          {progress || (mode === 'campaigns'
            ? 'Sweeping the grid, then deep-checking the best candidates one by one — paced so Amazon stays happy. Please don’t browse Amazon while this runs.'
            : `Searching ${marketHost}, then live-verifying each candidate on its product page — paced so Amazon stays happy. Bigger result counts take longer. Please don’t browse Amazon while this runs.`)}
        </div>
      )}
      {error && <div className="px-4 pb-3 text-[12px] text-[#ff3b30]">{error}</div>}
      {note && !error && <div className="px-4 pb-3 text-[12px]" style={{ color: 'var(--text-faint)' }}>{note}</div>}

      {/* ── Campaign results ── */}
      {matches && !error && (
        <div className="border-t border-gray-100 dark:border-white/10">
          <div className="px-4 py-2 text-[12px]" style={{ color: 'var(--text-faint)' }}>
            {matches.length === 0
              ? 'Nothing cleared MVP’s bar this pass — that’s the vetting doing its job. Try again when new opportunities land.'
              : <>Found <b style={{ color: 'var(--text)' }}>{matches.length}</b> campaign{matches.length !== 1 ? 's' : ''} worth your time{skippedCovered > 0 ? ` · ${skippedCovered} already in your queue skipped` : ''}.</>}
          </div>
          <div className="divide-y divide-gray-100 dark:divide-white/10">
            {matches.map((m) => (
              <div key={`${m.asin || m.detailsUrl}`} className="px-4 py-3 flex gap-3 items-start">
                {m.image
                  ? <img src={m.image} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0 bg-gray-100" />
                  : <div className="w-12 h-12 rounded-lg flex-shrink-0" style={{ background: 'rgba(124,58,237,0.08)' }} />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center justify-center min-w-[38px] px-1.5 py-0.5 rounded-md text-[12px] font-bold text-white"
                      style={{ background: m.score >= 80 ? '#34c759' : m.score >= 65 ? '#7C3AED' : '#86868b' }}>
                      {m.score}
                    </span>
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text)' }}>
                      {m.campaignName || m.asin}{m.brand ? <span className="font-normal" style={{ color: 'var(--text-faint)' }}> · {m.brand}</span> : null}
                    </p>
                  </div>
                  <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-soft)' }}>
                    {m.reasons.join(' · ')}
                  </p>
                  {m.roi && (
                    <p className="text-[11px] mt-1 font-medium" style={{ color: '#34c759' }}>
                      Buy to review: ${m.roi.costUsd.toFixed(0)} in → ${m.roi.perSaleUsd.toFixed(2)}/sale back → break even at {m.roi.breakEvenSales} sales
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {m.asin && (
                      <SaveBtn asin={m.asin} onClick={() => toggleSave({
                        asin: m.asin!, source: 'campaign', title: m.campaignName, brand: m.brand,
                        campaignId: m.campaignId, imageUrl: m.image, commissionPct: m.commissionPct,
                        price: m.price, monthlySales: m.monthlySales, rating: m.rating,
                        hasVideo: m.hasVideo, detailsUrl: m.detailsUrl,
                      })} />
                    )}
                    <button
                      onClick={() => onMessageBrand({
                        product: m.campaignName || m.asin || 'this product',
                        asin: m.asin || '',
                        commissionPct: m.commissionPct,
                        detailsUrl: m.detailsUrl || '',
                        brandLabel: m.brand || undefined,
                      })}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border"
                      style={{ borderColor: 'rgba(124,58,237,0.4)', color: '#7C3AED' }}
                    >
                      <MessageCircle size={11} /> Message brand
                    </button>
                    {m.asin && (
                      <a
                        href={`https://www.amazon.com/dp/${m.asin}`}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white"
                        style={{ background: '#34c759' }}
                      >
                        <ShoppingCart size={11} /> Buy to review
                      </a>
                    )}
                    {m.detailsUrl && (
                      <a
                        href={m.detailsUrl}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium"
                        style={{ color: 'var(--text-faint)' }}
                      >
                        <ExternalLink size={11} /> Open campaign
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Onsite results ── */}
      {products && !error && (
        <div className="border-t border-gray-100 dark:border-white/10">
          <div className="px-4 py-2 text-[12px]" style={{ color: 'var(--text-faint)' }}>
            {products.length === 0
              ? 'No products cleared MVP’s bar for this keyword — that’s the vetting doing its job. Try a broader or different keyword.'
              : <><b style={{ color: 'var(--text)' }}>{products.length}</b> MVP-approved product{products.length !== 1 ? 's' : ''} — each one live-verified on {marketHost}. Confident buy-to-review picks.</>}
          </div>
          <div className="divide-y divide-gray-100 dark:divide-white/10">
            {products.map((p) => (
              <div key={p.asin} className="px-4 py-3 flex gap-3 items-start">
                {p.image
                  ? <img src={p.image} alt="" className="w-12 h-12 rounded-lg object-contain flex-shrink-0 bg-white" />
                  : <div className="w-12 h-12 rounded-lg flex-shrink-0" style={{ background: 'rgba(124,58,237,0.08)' }} />}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold leading-snug line-clamp-2" style={{ color: 'var(--text)' }}>{p.title}</p>
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-soft)' }}>
                    {p.price || ''}
                    {p.rating ? <> · <Star size={9} className="inline -mt-0.5" style={{ color: '#ff9500' }} /> {p.rating}{p.reviews != null ? ` (${p.reviews.toLocaleString()})` : ''}</> : null}
                    {p.monthlySales != null ? <> · {p.monthlySales.toLocaleString()}+ sold/mo</> : null}
                    {p.hasVideo ? <> · 🎬 video carousel{p.carouselPos === 'top' ? ' (hero)' : ''}</> : null}
                  </p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <SaveBtn asin={p.asin} onClick={() => toggleSave({
                      asin: p.asin, source: 'onsite', title: p.title, imageUrl: p.image,
                      price: typeof p.price === 'string' ? Number(p.price.replace(/[^\d.]/g, '')) || null : null,
                      monthlySales: p.monthlySales, rating: p.rating != null ? Number(p.rating) : null,
                      hasVideo: !!p.hasVideo, marketplace: p.marketplace || market,
                    })} />
                    <a
                      href={`https://${marketHost}/dp/${p.asin}`}
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white"
                      style={{ background: '#34c759' }}
                    >
                      <ShoppingCart size={11} /> Buy to review
                    </a>
                    <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{p.asin}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
