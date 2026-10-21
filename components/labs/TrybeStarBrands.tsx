'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// STAR BRANDS: THE NEXT BIG OPPORTUNITY (Seb, 2026-10-21: "Search for Tribe
// brands that have the least amount of creators, the most amount of active
// meta ads ... a brand that gives out the most ads per creator ... look at the
// website's brand and see the traffic ... only have brands that have a Tribe
// rating of over 90"; then "maybe in the top menu ... a fourth button that
// basically has a new page").
//
// All of TRYBE, not the creator's niche: brands creators rate 4.5 stars or
// more on TRYBE (Seb's "over 90" is 90% of 5 stars; TRYBE's list has no score
// out of 100, Seb's check 2026-10-21), ranked by Meta ads running for each
// creator they have (by Meta ads alone while TRYBE's list gives no creator
// counts, and the page says so), each with its website's rank among the world's websites and whether
// people search Google for it (lib/brand-popularity). The same search is in
// Find brands as the sort "Most ads per creator" with the TRYBE score filter,
// for a niche.
//
// Meta ads are counted by SCOUT from Meta's Ad Library, a few brands at a
// time, and kept for every member for a week; website ranks and Google are
// read in the background. So the page always says how many of the brands
// each was read for, lists the ones with no Meta count after the rest, and
// offers to count the next ones. A list ranked on ten counts never looks
// like a ranking of all of TRYBE.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Megaphone, Sparkles, RotateCcw, Users } from 'lucide-react'
import { BrandMark, PayChip, StarButton, PopularityChips, RatingChip, NO_FILTERS, type LivePayEst, type LivePopularity } from '@/components/labs/TrybeFinderControls'
import { readMetaAdsAll, metaAdsWords } from '@/components/labs/metaAdsRead'
import { metaTrustWords, type MetaTrust } from '@/lib/trybe-pick'

const COLOR = '#C026D3'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const RED = '#DC2626'
const soft = { color: 'var(--text-3)' }
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold disabled:opacity-50'
/** Brands SCOUT counts Meta ads for per press. */
const COUNT_PER_PRESS = 40

interface StarBrand extends LivePopularity {
  brand_id: string; name: string; website: string | null
  trybe_score: number | null; total_creators: number | null
  pay_text: string | null; pay_est?: LivePayEst | null
  meta_ads?: number | null; meta_ads_checked_at?: string | null; meta_fresh?: boolean
  /** Whether the count is the brand's own (lib/trybe-pick metaTrustOf). */
  meta_trust?: MetaTrust | null; meta_ads_own?: number | null; meta_ads_sample?: number | null
  review_rating?: number | null; review_count?: number | null
  starred?: boolean; is_new?: boolean
}
interface ReadCounts { notOwn?: number; ratingKnown?: number; looked?: number; creators?: number; rankedBy?: 'perCreator' | 'perReview'; total: number; meta: number; web: number; google: number; popularityReady: boolean }
interface Answer { brands: StarBrand[]; matched: number; hiddenMine: number; readCounts?: ReadCounts; metaTodo?: Array<{ brand_id: string; name: string }>; blankBy?: Record<string, number>; hiddenBy?: Record<string, number> }

async function api(body: Record<string, unknown>) {
  const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
  return d
}

export default function TrybeStarBrands({ canCount, cards, scoutVersion, hasCore, onWrite }: {
  /** SCOUT can read Meta's Ad Library here (allowed on TRYBE, recent enough). */
  canCount: boolean
  /** The MVP team: the ads themselves are copied for What's working too. */
  cards: boolean
  scoutVersion: string | null
  /** The creator has a core message, so requests can be written. */
  hasCore: boolean
  /** Put these brands on the creator's list and write their requests. */
  onWrite: (ids: string[]) => Promise<void>
}) {
  // 4.5 of 5 stars is Seb's "over 90".
  const [minRating, setMinRating] = useState<number | null>(4.5)
  const [maxCreators, setMaxCreators] = useState<number | null>(null)
  const [data, setData] = useState<Answer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [counting, setCounting] = useState<{ done: number; total: number; all: boolean } | null>(null)
  const stopRef = useRef(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null)
  const [writing, setWriting] = useState(false)
  // NO RATING IN MVP'S COPY: the rating filter could only empty the list, so
  // it is taken off and the page says why, instead of "no brand matches".
  const [ratingMissing, setRatingMissing] = useState<number | null>(null)
  const left = useRef(false)
  useEffect(() => () => { left.current = true }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const d = await api({ action: 'browse', categories: [], keywords: [], limit: 40, sort: 'adsPerCreator', payType: 'any', includeMine: false, filters: { ...NO_FILTERS, minRating, maxCreators } })
      const a = d as Answer
      if (minRating && a.readCounts && a.readCounts.ratingKnown === 0 && (a.readCounts.looked ?? 0) > 0) {
        setRatingMissing(a.readCounts.looked ?? 0)
        setMinRating(null)
        return
      }
      setData(a)
    } catch (e) { setError(e instanceof Error ? e.message : 'The list could not be read.') }
    finally { setLoading(false) }
  }, [minRating, maxCreators])
  useEffect(() => { const t = window.setTimeout(() => void load(), 350); return () => window.clearTimeout(t) }, [load])

  async function countMeta(all = false) {
    // One press: the next forty. Count all: every brand on the list, the
    // ranking refreshed after each forty, until done or stopped.
    const list = data?.metaTodo || []
    const todo = all ? list : list.slice(0, COUNT_PER_PRESS)
    if (!todo.length) return
    stopRef.current = false
    setNote(null); setCounting({ done: 0, total: todo.length, all })
    try {
      const run = await readMetaAdsAll(todo.map((b) => ({ brandId: b.brand_id, name: b.name })), { cards, onProgress: (done, total) => setCounting({ done, total, all }), gone: () => left.current, stop: () => stopRef.current, onChunk: all ? () => load() : undefined })
      setNote(metaAdsWords(run, scoutVersion))
      await load()
    } catch (e) {
      setNote({ tone: 'bad', text: e instanceof Error ? e.message : 'The Meta ad counts could not be saved.' })
    } finally { setCounting(null) }
  }

  async function star(b: StarBrand) {
    const on = !b.starred
    setData((d) => d && { ...d, brands: d.brands.map((x) => (x.brand_id === b.brand_id ? { ...x, starred: on } : x)) })
    try { await api({ action: 'star', brandId: b.brand_id, on }) } catch (e) {
      setData((d) => d && { ...d, brands: d.brands.map((x) => (x.brand_id === b.brand_id ? { ...x, starred: !on } : x)) })
      toast.error(`Not ${on ? 'starred' : 'unstarred'}: ${e instanceof Error ? e.message : 'the save failed'}`)
    }
  }

  async function write(ids: string[]) {
    if (!ids.length) return
    setWriting(true)
    try { await onWrite(ids); setPicked(new Set()); await load() } finally { setWriting(false) }
  }

  const c = data?.readCounts
  const todo = data?.metaTodo?.length ?? 0
  const brands = data?.brands || []
  const counted = brands.filter((b) => b.meta_fresh)
  const perReview = c?.rankedBy === 'perReview'
  const pickedIds = brands.filter((b) => picked.has(b.brand_id)).map((b) => b.brand_id)
  const numberBox = (label: string, after: string, value: number | null, set: (n: number | null) => void, placeholder: string, max?: number, step?: number) => (
    <label className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] focus-within:ring-2" style={{ borderColor: 'var(--border-2)', ['--tw-ring-color' as string]: COLOR } as React.CSSProperties}>
      <span style={soft}>{label}</span>
      <input type="number" inputMode={step ? 'decimal' : 'numeric'} min={step ?? 1} max={max} step={step ?? 1} value={value ?? ''} placeholder={placeholder} aria-label={`${label} ${after}`}
        onChange={(e) => { const n = Number(e.target.value); set(e.target.value && Number.isFinite(n) && n > 0 ? Math.min(max ?? 1_000_000, n) : null) }}
        className="w-14 bg-transparent outline-none text-center tabular-nums font-semibold" style={{ color: 'var(--text)' }} />
      <span style={soft}>{after}</span>
    </label>
  )

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border p-4 sm:p-5 space-y-3" style={{ borderColor: `${COLOR}40`, background: `linear-gradient(120deg, ${COLOR}10 0%, transparent 65%), var(--surface)` }}>
        <p className="text-[14px] leading-relaxed max-w-[70ch]" style={{ color: 'var(--text-2)' }}>
          The next big opportunity on TRYBE: brands creators rate highly, ranked by how many Meta ads they run for each creator who has worked with them. A big ad budget shared by few creators means more of it can go to you. Each brand also shows how its website ranks among the world&rsquo;s websites, and whether people search Google for it.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {numberBox('TRYBE rating', '\u2605 or more', minRating, setMinRating, 'any', 5, 0.1)}
          {/* Only once TRYBE's list gives creator counts: before, it could only empty the list. */}
          {(c?.creators ?? 0) > 0 && numberBox('Up to', 'creators', maxCreators, setMaxCreators, 'any')}
          <span className="text-[12px]" style={soft}>4.5 of 5 stars is 90%.</span>
          <button onClick={() => void load()} disabled={loading} className={btn} style={{ border: '1px solid var(--border-2)' }}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Refresh
          </button>
        </div>
      </div>

      {error && <p className="text-[13px] rounded-lg px-3 py-2" style={{ background: 'rgba(220,38,38,0.08)', color: RED }}>The list could not be read: {error}</p>}
      {ratingMissing != null && !minRating && (
        <p className="text-[13px] rounded-lg px-3 py-2" style={{ background: 'rgba(180,83,9,0.10)', color: AMBER }}>
          TRYBE&rsquo;s rating is not in MVP&rsquo;s copy of TRYBE: none of the {ratingMissing.toLocaleString()} brands MVP looked at has one. So this list is not limited by rating for now.
        </p>
      )}

      {/* HOW MUCH IS READ, before the list, so a ranking on a few counts says so. */}
      {c && (
        <div className="rounded-xl border px-4 py-3 text-[13px] space-y-1.5" style={{ borderColor: 'var(--border)' }}>
          <p>
            <b>{c.total.toLocaleString()} brand{c.total === 1 ? '' : 's'}</b>{minRating ? ` rated ${minRating} stars or more by creators on TRYBE` : ' on TRYBE'}{maxCreators ? ` with ${maxCreators.toLocaleString()} creators or fewer` : ''}
            {data && data.hiddenMine > 0 ? <span style={soft}> ({data.hiddenMine.toLocaleString()} more already on your list)</span> : null}.
            {minRating ? <span style={soft}> Only brands creators have reviewed on TRYBE have a rating, about 600 of TRYBE&rsquo;s brands.</span> : null}
          </p>
          <p style={{ color: c.meta < c.total ? AMBER : GREEN }}>
            Meta ads counted for {c.meta.toLocaleString()} of {c.total.toLocaleString()}.{c.notOwn ? ` ${c.notOwn.toLocaleString()} of those ${c.notOwn === 1 ? 'is' : 'are'} not the brand\u2019s own (a common-word name), listed after the rest.` : ''}{c.meta < c.total ? ' The ones not counted yet are listed after the rest, best rated first.' : ' Every brand on this list is ranked on its own count.'}
          </p>
          {perReview && <p style={soft}>Ranked by Meta ads per creator review. TRYBE does not say how many creators a brand has; its reviews are the closest it gives, since at least that many creators worked with it. Ads per creator takes over once MVP has creator counts.</p>}
          {c.popularityReady
            ? <p style={soft}>Website rank read for {c.web.toLocaleString()}, Google searches for {c.google.toLocaleString()}. MVP reads both in the background for all of TRYBE, about 240 brands an hour.</p>
            : cards && <p style={{ color: AMBER }}>Website rank and Google searches need migration 452 in Supabase (team only sees this).</p>}
          {todo > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {canCount
                ? counting
                  ? <>
                      <span className={btn} style={{ background: COLOR, color: '#fff' }}><Loader2 size={13} className="animate-spin" /> Reading Meta&rsquo;s Ad Library: {counting.done} of {counting.total}</span>
                      <button onClick={() => { stopRef.current = true }} className={btn} style={{ border: '1px solid var(--border-2)' }}>Stop</button>
                      {counting.all && <span className="text-[12px]" style={soft}>About {Math.max(1, Math.ceil(((counting.total - counting.done) * 10) / 60))} minutes left. Leave this tab open; the list ranks itself again after every 40.</span>}
                    </>
                  : <>
                      <button onClick={() => void countMeta(false)} className={btn} style={{ background: COLOR, color: '#fff' }}><Megaphone size={13} /> Count the next {Math.min(COUNT_PER_PRESS, todo)}</button>
                      {todo > COUNT_PER_PRESS && <button onClick={() => void countMeta(true)} className={btn} style={{ border: `1px solid ${COLOR}`, color: COLOR }}>Count all {todo.toLocaleString()} (about {Math.ceil((todo * 10) / 60)} min)</button>}
                    </>
                : <span style={soft}>SCOUT counts Meta ads in this Chrome. Allow SCOUT on TRYBE (top of this page) to count the rest.</span>}
              <span className="text-[12px]" style={soft}>Counts are kept for every MVP member for a week.</span>
            </div>
          )}
          {note && <p style={{ color: note.tone === 'ok' ? GREEN : note.tone === 'warn' ? AMBER : RED }}>{note.text}</p>}
        </div>
      )}

      {loading && !data && <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Ranking TRYBE&rsquo;s brands...</p>}
      {data && !brands.length && !loading && (
        <p className="text-[13px]" style={soft}>No brand matches{minRating ? ` a rating of ${minRating} stars or more` : ''}{maxCreators ? ` with ${maxCreators} creators or fewer` : ''}. Lower the rating to see more.</p>
      )}

      {brands.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void write(pickedIds)} disabled={writing || !pickedIds.length || !hasCore} className={btn} style={{ background: COLOR, color: '#fff' }}>
              {writing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Write {pickedIds.length || ''} request{pickedIds.length === 1 ? '' : 's'}
            </button>
            <span className="text-[12px]" style={soft}>{hasCore ? 'Tick the brands you want: MVP writes each one a request from your core message, into Ready to send.' : 'Write your core message in Find brands first: every request starts from it.'}</span>
          </div>
          <ol className="space-y-2">
            {brands.map((b, i) => {
              const ratio = b.ads_per_creator
              const perRev = b.ads_per_review ?? null
              const known = !!b.meta_fresh
              const notOwn = known && (b.meta_trust === 'capped' || b.meta_trust === 'mixed')
              const groupOf = (x: StarBrand) => !x.meta_fresh ? 2 : x.meta_trust === 'capped' || x.meta_trust === 'mixed' ? 1 : 0
              const first = i === 0 || groupOf(brands[i - 1]) !== groupOf(b)
              const trustSaid = notOwn && b.meta_trust ? metaTrustWords(b.meta_trust, { name: b.name, count: b.meta_ads ?? 0, own: b.meta_ads_own, sample: b.meta_ads_sample }) : null
              return (
                <li key={b.brand_id}>
                  {first && i > 0 && notOwn && <p className="text-[12px] font-semibold uppercase tracking-wide mt-3 mb-1.5" style={soft}>Counts that include other advertisers&rsquo; ads</p>}
                  {first && !known && counted.length > 0 && <p className="text-[12px] font-semibold uppercase tracking-wide mt-3 mb-1.5" style={soft}>Meta ads not counted yet</p>}
                  <label className="flex gap-3 rounded-xl border p-3 cursor-pointer" style={{ borderColor: picked.has(b.brand_id) ? COLOR : 'var(--border)', background: 'var(--surface)' }}>
                    <input type="checkbox" className="mt-1 accent-[#C026D3]" checked={picked.has(b.brand_id)}
                      onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(b.brand_id); else n.delete(b.brand_id); return n })} />
                    <span className="w-7 shrink-0 text-[13px] font-bold tabular-nums mt-0.5" style={{ color: known && !notOwn ? COLOR : 'var(--text-3)' }}>#{i + 1}</span>
                    <BrandMark name={b.name} website={b.website} size={36} />
                    <span className="flex-1 min-w-0 space-y-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-bold">{b.name}</span>
                        <RatingChip stars={b.review_rating} reviews={b.review_count} />
                        <StarButton on={!!b.starred} onClick={() => void star(b)} />
                      </span>
                      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        {!known
                          ? <span className="text-[12.5px] font-semibold" style={soft}>Meta ads not counted yet</span>
                          : trustSaid
                            ? <span className="text-[12.5px]" style={{ color: AMBER }} title={trustSaid.long}><b>{trustSaid.short}</b>: {trustSaid.long}</span>
                          : ratio != null
                            ? <><span className="text-[20px] font-extrabold tabular-nums" style={{ color: ratio >= 5 ? GREEN : 'var(--text)' }}>{ratio.toLocaleString('en-US')}</span><span className="text-[12.5px]" style={{ color: 'var(--text-2)' }}>Meta ads per creator</span></>
                            : perRev != null
                              ? <><span className="text-[20px] font-extrabold tabular-nums" style={{ color: perRev >= 5 ? GREEN : 'var(--text)' }}>{perRev.toLocaleString('en-US')}</span><span className="text-[12.5px]" style={{ color: 'var(--text-2)' }}>Meta ads per review</span></>
                              : <><span className="text-[20px] font-extrabold tabular-nums" style={{ color: (b.meta_ads ?? 0) >= 50 ? GREEN : 'var(--text)' }}>{(b.meta_ads ?? 0).toLocaleString('en-US')}</span><span className="text-[12.5px]" style={{ color: 'var(--text-2)' }}>Meta ad{b.meta_ads === 1 ? '' : 's'} running now, no reviews yet</span></>}
                        <span className="text-[12.5px] inline-flex items-center gap-1" style={soft}>
                          {known && !notOwn && (ratio != null || perRev != null) ? `${(b.meta_ads ?? 0).toLocaleString('en-US')} ads running \u00b7 ` : ''}
                          {b.total_creators != null
                            ? <><Users size={11} />{b.total_creators.toLocaleString('en-US')} creator{b.total_creators === 1 ? '' : 's'}</>
                            : b.review_count != null ? `${b.review_count.toLocaleString('en-US')} creator review${b.review_count === 1 ? '' : 's'}` : ''}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <PopularityChips b={{ ...b, meta_trust: null }} />
                        <PayChip est={b.pay_est} payText={b.pay_text} />
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ol>
          {data && data.matched > brands.length && <p className="text-[12px]" style={soft}>Showing the top {brands.length} of {data.matched.toLocaleString()}. Raise the rating to narrow it.</p>}
        </>
      )}
    </section>
  )
}
