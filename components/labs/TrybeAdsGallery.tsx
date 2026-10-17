'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ADS TRYBE BRANDS RUN ON META, at the foot of What's working (Seb,
// 2026-10-17: "do ... five", after TrybeDaily's Meta ads). The ad cards the
// MVP team's SCOUT copied from Meta's public Ad Library (lib/trybe-adsgallery):
// the opening line, how long each has run, paid partnerships, videos. Every
// member sees them; only an admin's read adds to them, and the admin reads
// the brands in TRYBE's Top 100 from here. A gallery nobody read yet, a SCOUT
// too old to copy cards, and a read that got nothing each say so.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, AlertTriangle, ExternalLink, Play, Handshake, RotateCcw } from 'lucide-react'
import { galleryStats, sortAds, adDays, adUrl, type MetaAd, type AdSort } from '@/lib/trybe-adsgallery'
import { readMetaAds, metaAdsWords } from '@/components/labs/metaAdsRead'
import { SCOUT_META_CARDS_MIN_VERSION, scoutAtLeast } from '@/lib/scout-version'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const RED = '#DC2626'
const PINK = '#DB2777'
const SHOWN = 10

interface GalleryRead { at: string | null; brandsRead: number; ads: MetaAd[]; categories: Record<string, string[]> }

export default function TrybeAdsGallery({ isAdmin, scoutVersion, canRead, topBrands, category }: {
  isAdmin: boolean
  scoutVersion: string | null
  /** SCOUT allowed on TRYBE (it asks for Facebook itself when it reads). */
  canRead: boolean
  /** The brands in TRYBE's Top 100 now, for the admin's read. */
  topBrands: Array<{ brandId: string; name: string }>
  /** What's working's category filter. */
  category: string | null
}) {
  const [data, setData] = useState<GalleryRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<AdSort>('opening')
  const [limit, setLimit] = useState(SHOWN)
  const [run, setRun] = useState<{ done: number; total: number } | null>(null)
  const [note, setNote] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'meta_gallery' }), signal: AbortSignal.timeout(30_000) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
      setData({ at: d.at ?? null, brandsRead: Number(d.brandsRead) || 0, ads: Array.isArray(d.ads) ? d.ads : [], categories: d.categories || {} }); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'MVP could not read the ads gallery.') }
  }, [])
  useEffect(() => { void load() }, [load])

  const now = Date.now()
  const inCat = useMemo(() => (data?.ads || []).filter((a) => !category || (data?.categories[a.brandId] || []).some((c) => c.toLowerCase() === category.toLowerCase())), [data, category])
  const stats = useMemo(() => galleryStats(inCat, category ? new Set(inCat.map((a) => a.brandId)).size : data?.brandsRead ?? 0, now), [inCat, data, category]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => sortAds(inCat, sort, now), [inCat, sort]) // eslint-disable-line react-hooks/exhaustive-deps
  const canCards = scoutAtLeast(scoutVersion, SCOUT_META_CARDS_MIN_VERSION)

  async function readTop() {
    const todo = topBrands.slice(0, 25)
    if (!todo.length) { setNote({ tone: 'warn', text: 'No brands in the Top 100 read yet. Read the Top 100 above first.' }); return }
    setRun({ done: 0, total: todo.length }); setNote(null)
    try {
      const r = await readMetaAds(todo, { cards: true, onProgress: (done, total) => setRun({ done, total }) })
      setNote(metaAdsWords(r, scoutVersion))
      await load()
    } catch (e) { setNote({ tone: 'bad', text: e instanceof Error ? e.message : 'The ads could not be saved.' }) }
    finally { setRun(null) }
  }

  const soft = { color: 'var(--text-soft)' }
  const chip = (on: boolean) => ({ className: 'rounded-full px-3 py-1 text-[12.5px] font-semibold border', style: on ? { background: 'rgba(124,58,237,0.10)', color: PURPLE, borderColor: 'transparent' } : { borderColor: 'var(--border)', color: 'var(--text)' } })
  const pct = (x: number | null) => (x == null ? 'None yet' : `${Math.round(x * 100)}%`)

  return (
    <section id="ww-ads" className="space-y-3 scroll-mt-24" aria-label="Ads TRYBE brands run on Meta">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-[22px] font-bold tracking-tight">Ads TRYBE brands run on Meta</h2>
        {data && data.ads.length > 0 && <span className="text-[12px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'rgba(219,39,119,0.10)', color: PINK }}>{inCat.length} ads</span>}
        {data?.at && <span className="text-[12px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>Read {new Date(data.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
      </div>
      <p className="text-[13px]" style={soft}>The ads with each brand&rsquo;s name running on Facebook and Instagram now, copied from Meta&rsquo;s public Ad Library by the MVP team&rsquo;s SCOUT, with how long each has run. Each card links to the ad on Meta. A preview Meta has since taken down shows the ad&rsquo;s words instead.</p>

      {isAdmin && (
        <div className="rounded-xl border border-dashed px-3 py-2.5 text-[12.5px] flex flex-wrap items-center gap-2" style={{ borderColor: 'var(--border)' }}>
          <span className="font-semibold">Admin</span>
          {!canRead ? <span style={{ color: AMBER }}>Allow SCOUT on TRYBE first (top of this page).</span>
            : !canCards ? <span style={{ color: AMBER }}>Copying the ads needs SCOUT {SCOUT_META_CARDS_MIN_VERSION}. Yours is {scoutVersion || 'unknown'}; the counts still work.</span>
            : <button onClick={() => void readTop()} disabled={run != null} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50" style={{ background: PURPLE, color: '#fff' }}>
                {run ? <><Loader2 size={12} className="animate-spin" /> Reading Meta&rsquo;s Ad Library: {run.done} of {run.total}</> : <><RotateCcw size={12} /> Read the ads of {Math.min(25, topBrands.length)} Top 100 brands</>}
              </button>}
          <span style={soft}>Find brands&rsquo; &ldquo;Check for Meta ads&rdquo; adds to this too.</span>
          {note && <span className="basis-full" style={{ color: note.tone === 'ok' ? GREEN : note.tone === 'warn' ? AMBER : RED }}>{note.text}</span>}
        </div>
      )}

      {error && <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}</p>}
      {!error && !data && <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading the ads gallery...</p>}
      {data && data.ads.length === 0 && (
        <div className="rounded-2xl border p-5 text-[13px]" style={{ borderColor: 'var(--border)', background: 'var(--surface)', ...soft }}>
          {data.brandsRead ? `MVP read ${data.brandsRead} brand${data.brandsRead === 1 ? '' : 's'} on Meta and none had ads running it could copy.` : 'No ads copied yet. The MVP team reads them from Meta’s Ad Library; they show here for every member once read.'}
        </div>
      )}
      {data && data.ads.length > 0 && (<>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat color={PURPLE} big={stats.brands.toLocaleString()} label={category ? `Brands in ${category}` : 'TRYBE brands read on Meta'} />
          <Stat color={PINK} big={stats.ads.toLocaleString()} label="Ads they are running" />
          <Stat color="#0891B2" big={stats.medianDays != null ? `${stats.medianDays} days` : 'Not read'} label={`Middle ad's time running${stats.dated && stats.dated < stats.ads ? ` (${stats.dated} with a date)` : ''}`} />
          <Stat color={GREEN} big={pct(stats.paidShare)} label={`Paid partnerships · ${pct(stats.videoShare)} videos`} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sort ads">
          <button onClick={() => setSort('opening')} aria-pressed={sort === 'opening'} {...chip(sort === 'opening')}>Opening line first</button>
          <button onClick={() => setSort('longest')} aria-pressed={sort === 'longest'} {...chip(sort === 'longest')}>Running longest</button>
          <button onClick={() => setSort('newest')} aria-pressed={sort === 'newest'} {...chip(sort === 'newest')}>Newest</button>
          <span className="ml-auto text-[12px]" style={soft}>Showing {Math.min(limit, shown.length)} of {shown.length}</span>
        </div>
        {inCat.length === 0 ? <p className="text-[13px]" style={soft}>No ads kept for brands in {category}. Pick All categories above.</p> : (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {shown.slice(0, limit).map((a) => <AdCard key={a.id} ad={a} now={now} />)}
          </div>
        )}
        {shown.length > limit && <button onClick={() => setLimit((n) => n + 20)} className="text-[13px] font-semibold" style={{ color: PURPLE }}>Show more ({shown.length - limit} left)</button>}
      </>)}
    </section>
  )
}

function Stat({ color, big, label }: { color: string; big: string; label: string }) {
  return (
    <div className="rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <p className="text-[24px] font-bold leading-tight tabular-nums" style={{ color }}>{big}</p>
      <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-soft)' }}>{label}</p>
    </div>
  )
}

function AdCard({ ad, now }: { ad: MetaAd; now: number }) {
  const [bad, setBad] = useState(false)
  const days = adDays(ad.started, now)
  const pic = ad.preview && !bad
  return (
    <a href={adUrl(ad.id)} target="_blank" rel="noopener noreferrer" className="group rounded-2xl border overflow-hidden flex flex-col hover:shadow-sm transition-shadow" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      {/* A picture keeps the ad's shape; words alone take only the room they need. */}
      <div className="relative" style={pic ? { aspectRatio: '4 / 5', background: 'var(--surface-2)' } : { background: 'var(--surface-2)' }}>
        {pic
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={ad.preview!} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} className="absolute inset-0 w-full h-full object-cover" />
          : (
            <div className="p-4 min-h-[11rem] flex flex-col justify-center">
              <span className="w-10 h-10 rounded-xl inline-flex items-center justify-center text-[17px] font-bold mb-3" style={{ background: 'rgba(124,58,237,0.12)', color: PURPLE }}>{(ad.brand.trim()[0] || '?').toUpperCase()}</span>
              <p className="text-[12px] font-semibold" style={{ color: PURPLE }}>Opening line</p>
              <p className="text-[15px] font-semibold leading-snug line-clamp-6" style={{ color: 'var(--text)' }}>{ad.opening ? `“${ad.opening}”` : 'Meta showed no words for this ad.'}</p>
            </div>
          )}
        {ad.video && <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}><Play size={10} /> Video</span>}
      </div>
      <div className="p-3 flex-1 flex flex-col gap-1">
        {pic && ad.opening && <p className="text-[13px] font-semibold leading-snug line-clamp-3">&ldquo;{ad.opening}&rdquo;</p>}
        <p className="text-[12.5px] font-bold">{ad.brand}</p>
        {ad.page && ad.page.toLowerCase() !== ad.brand.toLowerCase() && <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>Run by {ad.page}</p>}
        <p className="text-[12px] flex flex-wrap items-center gap-1.5" style={{ color: 'var(--text-soft)' }}>
          {days != null ? `Running ${days} day${days === 1 ? '' : 's'}` : ad.startedText ? `Started ${ad.startedText}` : 'Start date not shown'}
          {ad.paid && <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-bold" style={{ background: 'rgba(22,163,74,0.12)', color: GREEN }}><Handshake size={10} /> Paid partnership</span>}
        </p>
        <span className="mt-auto pt-1 inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: PURPLE }}>See it on Meta <ExternalLink size={11} /></span>
      </div>
    </a>
  )
}
