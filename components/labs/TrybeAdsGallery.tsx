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
import { galleryStats, sortAds, ranDays, closingLine, adUrl, nextToRead, LONG_RUN_DAYS, type MetaAd, type AdSort } from '@/lib/trybe-adsgallery'
import { readMetaAds, metaAdsWords } from '@/components/labs/metaAdsRead'
import { SCOUT_META_CARDS_MIN_VERSION, SCOUT_META_LONGEST_MIN_VERSION, SCOUT_META_VIDEO_MIN_VERSION, scoutAtLeast } from '@/lib/scout-version'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const RED = '#DC2626'
const PINK = '#DB2777'
const SHOWN = 10

interface GalleryRead {
  at: string | null
  brandsRead: number
  /** Brands whose last read found ads running. */
  withAds: number
  /** The most ad cards MVP keeps (the newest read). */
  keepMax: number
  /** Ads by other advertisers that mention a brand's name, left out. */
  notOwn: number
  ads: MetaAd[]
  categories: Record<string, string[]>
  /** When each Top 100 brand's ads were last read, for reading the oldest first. */
  readAt: Record<string, { at: string }>
  /** The Top 100 as MVP saved it (admin only). */
  top: { at: string | null; brands: Array<{ brandId: string; name: string; readAt: string | null }> } | null
}
/** Brands read per press. */
const PER_PRESS = 25

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
  // LONGEST RUNNING FIRST, VIDEOS (Seb, 2026-10-24: "brands running the
  // longest ad on meta means the video is working and the hook and cta is
  // selling.. that is what i want this section to show").
  const [sort, setSort] = useState<AdSort>('longest')
  const [videosOnly, setVideosOnly] = useState(true)
  const [limit, setLimit] = useState(SHOWN)
  const [run, setRun] = useState<{ done: number; total: number } | null>(null)
  const [note, setNote] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null)
  const [listening, setListening] = useState(false)
  const [heardNote, setHeardNote] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'meta_gallery' }), signal: AbortSignal.timeout(30_000) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
      const ads: MetaAd[] = Array.isArray(d.ads) ? d.ads : []
      const readAt: Record<string, { at: string }> = {}
      for (const b of (d.top?.brands || []) as Array<{ brandId: string; readAt: string | null }>) if (b.readAt) readAt[b.brandId] = { at: b.readAt }
      setData({
        at: d.at ?? null, brandsRead: Number(d.brandsRead) || 0, withAds: Number(d.brandsWithAds) || 0, keepMax: Number(d.keepMax) || 0, notOwn: Number(d.notOwn) || 0,
        ads, categories: d.categories || {}, readAt, top: d.top && Array.isArray(d.top.brands) ? d.top : null,
      }); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'MVP could not read the ads gallery.') }
  }, [])
  useEffect(() => { void load() }, [load])

  const now = Date.now()
  const inCat = useMemo(() => (data?.ads || []).filter((a) => !category || (data?.categories[a.brandId] || []).some((c) => c.toLowerCase() === category.toLowerCase())), [data, category])
  const videoCount = useMemo(() => inCat.filter((a) => a.video).length, [inCat])
  const inView = useMemo(() => (videosOnly ? inCat.filter((a) => a.video) : inCat), [inCat, videosOnly])
  const stats = useMemo(() => galleryStats(inView, category ? new Set(inView.map((a) => a.brandId)).size : data?.brandsRead ?? 0, now), [inView, data, category]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => sortAds(inView, sort, now), [inView, sort]) // eslint-disable-line react-hooks/exhaustive-deps
  const canCards = scoutAtLeast(scoutVersion, SCOUT_META_CARDS_MIN_VERSION)

  // The Top 100 read on this visit, else the one MVP saved (the Daily refresh
  // or an earlier visit): the button said "0 Top 100 brands" without it.
  const pool = topBrands.length ? topBrands : data?.top?.brands || []
  const fromSaved = !topBrands.length && pool.length > 0
  const todo = useMemo(() => nextToRead(pool, { brands: data?.readAt || {} }, PER_PRESS), [pool, data])

  async function readTop() {
    if (!todo.length) { setNote({ tone: 'warn', text: 'MVP has no Top 100 saved yet. Press Daily refresh at the top of TRYBE, then come back.' }); return }
    setRun({ done: 0, total: todo.length }); setNote(null)
    try {
      const r = await readMetaAds(todo, { cards: true, onProgress: (done, total) => setRun({ done, total }) })
      setNote(metaAdsWords(r, scoutVersion))
      await load()
      // The new videos' first words, right away rather than at the next run.
      if (canHear) void listenNow()
    } catch (e) { setNote({ tone: 'bad', text: e instanceof Error ? e.message : 'The ads could not be saved.' }) }
    finally { setRun(null) }
  }

  /** LISTEN NOW (the team): what the next video ads say first. The job does
   *  the same every 20 minutes; this is for not waiting. */
  async function listenNow() {
    setListening(true); setHeardNote(null)
    try {
      const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'meta_hear' }), signal: AbortSignal.timeout(170_000) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
      const parts = [`Listened to ${d.tried} video${d.tried === 1 ? '' : 's'}: ${d.heard} with words${d.none ? `, ${d.none} with none spoken` : ''}${d.failed ? `, ${d.failed} that did not play` : ''}.`]
      if (d.why) parts.push(d.why)
      else if (d.left) parts.push(`${d.left} more wait${d.left === 1 ? 's' : ''}; MVP listens to them every 20 minutes.`)
      setHeardNote({ tone: d.failed && !d.heard ? 'warn' : 'ok', text: parts.join(' ') })
      await load()
    } catch (e) { setHeardNote({ tone: 'bad', text: e instanceof Error ? e.message : 'The listen stopped.' }) }
    finally { setListening(false) }
  }
  const canHear = scoutAtLeast(scoutVersion, SCOUT_META_VIDEO_MIN_VERSION)
  const heard = useMemo(() => {
    const n = { ready: 0, none: 0, waiting: 0, gone: 0, nofile: 0 }
    for (const a of data?.ads || []) if (a.video && a.heard) n[a.heard]++
    return n
  }, [data])

  const soft = { color: 'var(--text-soft)' }
  const chip = (on: boolean) => ({ className: 'rounded-full px-3 py-1 text-[12.5px] font-semibold border', style: on ? { background: 'rgba(124,58,237,0.10)', color: PURPLE, borderColor: 'transparent' } : { borderColor: 'var(--border)', color: 'var(--text)' } })

  return (
    <section id="ww-ads" className="space-y-3 scroll-mt-24" aria-label="TRYBE brands' longest running Meta ads">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-[22px] font-bold tracking-tight">TRYBE brands&rsquo; longest running Meta ads</h2>
        {data && data.ads.length > 0 && <span className="text-[12px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'rgba(219,39,119,0.10)', color: PINK }}>{inCat.length} ad cards</span>}
        {data?.at && <span className="text-[12px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>Read {new Date(data.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
      </div>
      <p className="text-[13px]" style={soft}>A brand keeps paying for an ad that sells, so the longer an ad runs, the better its video, its hook and its call to action are working. These are the ads TRYBE brands run on Facebook and Instagram, longest running first, copied from Meta&rsquo;s public Ad Library by the MVP team&rsquo;s SCOUT. Only ads the brand runs itself, or a creator runs in paid partnership with it, are shown. Days are counted to when MVP read each ad. Each card links to the ad on Meta.</p>

      {isAdmin && (
        <div className="rounded-xl border border-dashed px-3 py-2.5 text-[12.5px] flex flex-wrap items-center gap-2" style={{ borderColor: 'var(--border)' }}>
          <span className="font-semibold">Admin</span>
          {!canRead ? <span style={{ color: AMBER }}>Allow SCOUT on TRYBE first (top of this page).</span>
            : !canCards ? <span style={{ color: AMBER }}>Copying the ads needs SCOUT {SCOUT_META_CARDS_MIN_VERSION}. Yours is {scoutVersion || 'unknown'}; the counts still work.</span>
            : <button onClick={() => void readTop()} disabled={run != null} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50" style={{ background: PURPLE, color: '#fff' }}>
                {run ? <><Loader2 size={12} className="animate-spin" /> Reading Meta&rsquo;s Ad Library: {run.done} of {run.total}</> : <><RotateCcw size={12} /> {todo.length ? `Read the ads of ${todo.length} Top 100 brands` : 'Read the ads of Top 100 brands'}</>}
              </button>}
          <span style={soft}>
            {pool.length
              ? `Of ${pool.length} in the Top 100${fromSaved && data?.top?.at ? ` (as saved ${new Date(data.top.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})` : ''}, the ones read longest ago first. Daily refresh and Find brands’ “Check for Meta ads” add to this too.`
              : 'Daily refresh and Find brands’ “Check for Meta ads” add to this too.'}
          </span>
          {data && data.ads.some((a) => a.video) && (
            <span className="basis-full inline-flex flex-wrap items-center gap-2">
              <span style={soft}>What the videos say first: {heard.ready} heard{heard.none ? `, ${heard.none} say no words` : ''}{heard.waiting ? `, ${heard.waiting} waiting` : ''}{heard.gone ? `, ${heard.gone} whose link on Meta ran out first (the next read brings them back)` : ''}{heard.nofile ? `, ${heard.nofile} read without the video file (SCOUT older than ${SCOUT_META_VIDEO_MIN_VERSION})` : ''}.</span>
              {heard.waiting > 0 && <button onClick={() => void listenNow()} disabled={listening} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold border disabled:opacity-50" style={{ borderColor: 'var(--border)' }}>{listening ? <><Loader2 size={12} className="animate-spin" /> Listening</> : 'Listen now'}</button>}
            </span>
          )}
          {heardNote && <span className="basis-full" style={{ color: heardNote.tone === 'ok' ? GREEN : heardNote.tone === 'warn' ? AMBER : RED }}>{heardNote.text}</span>}
          {canCards && !canHear && <span className="basis-full" style={{ color: AMBER }}>Hearing what each video says needs SCOUT {SCOUT_META_VIDEO_MIN_VERSION}, which hands MVP the video file. Yours is {scoutVersion || 'unknown'}.</span>}
          {canCards && !scoutAtLeast(scoutVersion, SCOUT_META_LONGEST_MIN_VERSION) && <span className="basis-full" style={{ color: AMBER }}>Your SCOUT ({scoutVersion || 'unknown'}) copies the first 8 ads Meta shows for each brand. SCOUT {SCOUT_META_LONGEST_MIN_VERSION} looks at up to 30 and copies the 8 running longest; Chrome brings it once the Web Store has it.</span>}
          {data && data.notOwn > 0 && <span className="basis-full" style={soft}>{data.notOwn.toLocaleString()} ad{data.notOwn === 1 ? '' : 's'} kept from earlier reads {data.notOwn === 1 ? 'was' : 'were'} run by other advertisers that only mention a brand&rsquo;s name, so {data.notOwn === 1 ? 'it is' : 'they are'} left out. The next read of those brands replaces them.</span>}
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
          {/* WHAT EACH NUMBER IS (Seb, 2026-10-23, "??" at 6,119 brands beside
              400 ads): the brands are every one read on Meta; the cards are
              only the newest MVP keeps, so they are never "the ads running". */}
          <Stat color={PURPLE} big={stats.brands.toLocaleString()} label={category ? `Brands in ${category} with ad cards kept` : `TRYBE brands read on Meta${data.withAds ? `, ${data.withAds.toLocaleString()} running ads` : ''}`} />
          <Stat color={PINK} big={stats.longRun.toLocaleString()} label={`of ${stats.ads.toLocaleString()} ${videosOnly ? 'video ads' : 'ads'} kept had run ${LONG_RUN_DAYS} days or more when read`} />
          <Stat color="#0891B2" big={stats.longest ? `${stats.longest.days} days` : 'Not read'} label={stats.longest ? `The longest running, by ${stats.longest.brand}` : 'No start dates read yet'} />
          <Stat color={GREEN} big={stats.medianDays != null ? `${stats.medianDays} days` : 'Not read'} label={`Middle ad's time running${stats.dated && stats.dated < stats.ads ? ` (${stats.dated} with a date)` : ''}`} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sort ads">
          <button onClick={() => setSort('longest')} aria-pressed={sort === 'longest'} {...chip(sort === 'longest')}>Running longest</button>
          <button onClick={() => setSort('newest')} aria-pressed={sort === 'newest'} {...chip(sort === 'newest')}>Newest</button>
          <button onClick={() => setSort('opening')} aria-pressed={sort === 'opening'} {...chip(sort === 'opening')}>With words first</button>
          <span className="mx-1 h-4 w-px" style={{ background: 'var(--border)' }} aria-hidden />
          <button onClick={() => { setVideosOnly((v) => !v); setLimit(SHOWN) }} aria-pressed={videosOnly} {...chip(videosOnly)}><Play size={11} className="inline -mt-0.5" /> Videos only ({videoCount.toLocaleString()})</button>
          <span className="ml-auto text-[12px]" style={soft}>Showing {Math.min(limit, shown.length)} of {shown.length}</span>
        </div>
        {inCat.length === 0 ? <p className="text-[13px]" style={soft}>No ads kept for brands in {category}. Pick All categories above.</p>
          : inView.length === 0 ? <p className="text-[13px]" style={soft}>None of the ads kept here is a video. Turn off Videos only to see the rest.</p> : (
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
  const days = ranDays(ad, now)
  // Days are counted to the read: an ad read a while ago is said as of then.
  const readT = Date.parse(ad.readAt)
  const asOf = Number.isFinite(readT) && now - readT > 3 * 86_400_000 ? ` when read ${new Date(readT).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''
  const closing = closingLine(ad.body)
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
              <p className="text-[12px] font-semibold" style={{ color: PINK }}>Caption</p>
              <p className="text-[15px] font-semibold leading-snug line-clamp-6" style={{ color: 'var(--text)' }}>{ad.opening ? `“${ad.opening}”` : 'Meta showed no words for this ad.'}</p>
            </div>
          )}
        {ad.video && <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}><Play size={10} /> Video</span>}
      </div>
      <div className="p-3 flex-1 flex flex-col gap-1">
        <p className="text-[12.5px] font-bold" style={{ color: days != null && days >= LONG_RUN_DAYS ? GREEN : 'var(--text)' }}>
          {days != null ? `Running ${days} day${days === 1 ? '' : 's'}${asOf}` : ad.startedText ? `Started ${ad.startedText}` : 'Start date not shown'}
        </p>
        {/* THE HOOK IS WHAT IS SAID (Seb, 2026-10-24): the video's first
            spoken sentence, heard by MVP; the caption is said apart. */}
        {ad.spoken && <p className="text-[13.5px] font-semibold leading-snug line-clamp-3"><span style={{ color: PURPLE }}>Says </span>&ldquo;{ad.spoken}&rdquo;</p>}
        {ad.heard === 'none' && <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>Says no words: music or text on screen.</p>}
        {ad.heard === 'waiting' && <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>What it says: MVP listens to it soon.</p>}
        {pic && ad.opening && <p className="text-[12.5px] leading-snug line-clamp-2"><span className="font-semibold" style={{ color: PINK }}>Caption </span>&ldquo;{ad.opening}&rdquo;</p>}
        {closing && <p className="text-[12.5px] leading-snug line-clamp-2"><span className="font-semibold" style={{ color: PINK }}>Caption ends </span>&ldquo;{closing}&rdquo;</p>}
        {(ad.cta || ad.link) && <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}><span className="font-semibold" style={{ color: 'var(--text)' }}>Button:</span> {[ad.cta, ad.link ? `to ${ad.link}` : null].filter(Boolean).join(' ')}</p>}
        <p className="text-[12.5px] font-bold">{ad.brand}</p>
        {ad.page && ad.page.toLowerCase() !== ad.brand.toLowerCase() && <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>Run by {ad.page}</p>}
        {ad.paid && <p className="text-[12px]"><span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-bold" style={{ background: 'rgba(22,163,74,0.12)', color: GREEN }}><Handshake size={10} /> Paid partnership</span></p>}
        <span className="mt-auto pt-1 inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: PURPLE }}>See it on Meta <ExternalLink size={11} /></span>
      </div>
    </a>
  )
}
