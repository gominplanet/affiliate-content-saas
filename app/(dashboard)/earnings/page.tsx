// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon Earnings — every stream in one place.
//
// Amazon never shows a creator what they actually earned. Creator Connections
// reporting covers CC and EPC but only for the store you have selected, the
// Associates page covers commissions and bounties but only for your offsite
// tracking id, and the same CC figure appears in both at very different values.
// Exports are worse: a month's file held 0.4% of the earnings its own dashboard
// showed for that month.
//
// So SCOUT replays what the pages themselves call, and this shows the result
// with the split intact. Two rules the UI holds to: nothing is a total unless it
// came from Amazon, and a metric Amazon did not report renders as "not reported"
// rather than as a zero.
'use client'

import { useCallback, useEffect, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, RefreshCw, TrendingUp, Store, Globe, Video, Package } from 'lucide-react'
import { toast } from 'sonner'
import { requestEarningsSync, requestEarningsStatus, startCreatorHubVideosScan, getVideoScanStatus, startVideoProductsScan, getVideoProductsStatus, type EarningsSyncStatus, type VideoScanStatus, type VideoProductsStatus } from '@/lib/extension-frame'
import ProductBreakdown from '@/components/earnings/ProductBreakdown'
import VideoInsights from '@/components/earnings/VideoInsights'
import VideoProducts from '@/components/earnings/VideoProducts'

const label = { color: 'var(--text)' } as const
const muted = { color: 'var(--text-2)' } as const

interface Row {
  period_start: string; stream: string; store_id: string; store_scope: string | null
  clicks: number | null; orders: number | null; quantity: number | null
  earnings_cents: number | null; revenue_cents: number | null; synced_at: string
}
interface Totals {
  earningsCents: number | null; revenueCents: number | null
  clicks: number | null; orders: number | null
  onsiteCents: number | null; offsiteCents: number | null
  byStream: Record<string, number | null>
}

/** Cents to money. `null` is NOT zero: it means Amazon didn't report the metric,
 *  and showing $0.00 for that is the single easiest way to make honest data lie. */
function money(cents: number | null | undefined): string {
  if (cents == null) return 'not reported'
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}
const num = (n: number | null | undefined) => (n == null ? 'not reported' : n.toLocaleString())

const STREAM_LABEL: Record<string, string> = {
  cc: 'Creator Connections',
  epc: 'Sponsored Products (EPC)',
  commissions: 'Associates commissions',
  bounties: 'Bounties',
}
/** Postgres hands rows back in whatever order it likes, which made one month read
 *  CC, EPC, CC, EPC and the next read EPC, EPC, CC, CC. Same figures, but the eye
 *  can't compare months down a column when the rows move. Fixed order: stream
 *  first, then onsite above offsite. */
const STREAM_RANK: Record<string, number> = { cc: 0, epc: 1, commissions: 2, bounties: 3 }
const rowRank = (r: Row) =>
  (STREAM_RANK[r.stream] ?? 9) * 10 + (r.store_scope === 'onsite' ? 0 : 1)

/** Add up a month's rows the same way the page totals do: a null is skipped, and
 *  if every value for a metric was null the sum stays null rather than becoming a
 *  zero that Amazon never reported. */
function sumRows(rs: Row[]) {
  const add = (pick: (r: Row) => number | null) => {
    let total = 0, seen = false
    for (const r of rs) { const v = pick(r); if (v == null) continue; total += v; seen = true }
    return seen ? total : null
  }
  return { clicks: add(r => r.clicks), orders: add(r => r.orders), earningsCents: add(r => r.earnings_cents) }
}

/** True when Amazon answered for this row but every figure in it was zero. That's
 *  a real answer ("nothing happened here"), not a missing one, so it's hidden by
 *  default and counted rather than dropped. */
const isQuiet = (r: Row) =>
  !r.clicks && !r.orders && !r.earnings_cents && !r.revenue_cents

export default function EarningsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sync, setSync] = useState<EarningsSyncStatus | null>(null)
  const [starting, setStarting] = useState(false)
  // Amazon's own header prints this as "StoreID: …". Auto-discovery reads it off
  // the reporting page when it can, but that page is a SPA and does not always
  // expose it, so the creator can just tell us rather than being stuck.
  const [storeId, setStoreId] = useState('')
  const [showQuiet, setShowQuiet] = useState(false)
  // Bumped whenever the totals reload, so the product breakdown refetches in step
  // with them rather than showing last sync's products beside this sync's totals.
  const [dataVersion, setDataVersion] = useState(0)
  const [scanningVideos, setScanningVideos] = useState(false)
  const [videoScan, setVideoScan] = useState<string | null>(null)
  // The shape of one real row from Amazon's video list. Shown rather than acted
  // on: length and product count are missing from the rows even though metrics
  // are returned, and this says whether Amazon omits them or names them
  // differently, instead of another round of guessing at a field name.
  const [videoSample, setVideoSample] = useState<string | null>(null)
  const [scanningProducts, setScanningProducts] = useState(false)
  const [productScan, setProductScan] = useState<string | null>(null)
  const [videoCount, setVideoCount] = useState(0)
  // Years of history to read, counted back from this one. Nought is this year.
  const [yearsBack, setYearsBack] = useState(0)
  const [hubUrl, setHubUrl] = useState('')
  // How many videos are stored, which decides whether the product read is worth
  // offering at all. Re-read whenever the data version moves so the button
  // appears as soon as the library lands.
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const d = await fetch('/api/amazon-videos').then(x => x.json())
        if (live) setVideoCount(d?.count || 0)
      } catch { /* leave it hidden rather than guess */ }
    })()
    return () => { live = false }
  }, [dataVersion])
  useEffect(() => {
    try {
      setStoreId(localStorage.getItem('mvp_amazon_store_id') || '')
      setYearsBack(Math.min(4, Math.max(0, Number(localStorage.getItem('mvp_amazon_years_back')) || 0)))
      setHubUrl(localStorage.getItem('mvp_creatorhub_url') || '')
    } catch { /* ignore */ }
  }, [])

  const load = useCallback(async () => {
    try {
      const d = await fetch('/api/amazon-earnings').then(r => r.json())
      if (d?.error) setLoadError(d.error)
      setRows(Array.isArray(d?.rows) ? d.rows : [])
      setTotals(d?.totals ?? null)
      setLastSyncedAt(d?.lastSyncedAt ?? null)
      setDataVersion(v => v + 1)
    } catch { setLoadError('Could not load your earnings.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  // Poll only while a sync is running, and reload the table each tick so a long
  // backfill fills in month by month instead of landing all at once at the end.
  useEffect(() => {
    if (!sync?.running) return
    const iv = setInterval(async () => {
      const s = await requestEarningsStatus()
      if (s) setSync(s)
      void load()
      if (s && !s.running) {
        clearInterval(iv)
        if (s.error) toast.error(s.error)
        else toast.success(`Synced ${s.savedPeriods ?? 0} monthly totals from Amazon.`)
      }
    }, 3000)
    return () => clearInterval(iv)
  }, [sync?.running, load])

  async function startSync() {
    setStarting(true)
    try {
      const year = new Date().getUTCFullYear()
      const clean = storeId.trim().toLowerCase()
      const stores = /^(?:onamz)?[a-z0-9]{3,}-\d{2}$/.test(clean) ? [clean] : undefined
      try { if (stores) localStorage.setItem('mvp_amazon_store_id', clean) } catch { /* ignore */ }
      try { localStorage.setItem('mvp_amazon_years_back', String(yearsBack)) } catch { /* ignore */ }
      // How far back to read. It matters more than it looks: the video library
      // goes back years, so with only this year's earnings the output chart
      // shows videos published against nothing at all for most of its width,
      // and the product breakdown can only rank what happened since January.
      const res = await requestEarningsSync(`${year - yearsBack}-01-01`, undefined, stores)
      if (!res.ok) {
        toast.error(res.error === 'not-installed'
          ? 'Install SCOUT and sign in to Amazon to read your earnings.'
          : (res.error || 'Could not start the sync.'))
        return
      }
      toast(yearsBack
        ? `Reading ${yearsBack + 1} years of Amazon earnings in a background tab. Roughly a minute per few months, so give it a while.`
        : 'Reading your Amazon earnings. This opens a background tab and takes a minute per few months.')
      setSync({ running: true })
    } finally { setStarting(false) }
  }

  // Reads the creator's whole Amazon video library into amazon_videos, which is
  // what lets the product cards distinguish "no video anywhere" from "the video
  // is on Amazon and nowhere else".
  //
  // This starts a job in SCOUT and watches it. It does not wait for an answer:
  // a library of thousands takes minutes, an MV3 service worker gets reclaimed
  // while it waits between Amazon's replies, and the dead reply channel made
  // every working run look like a timeout. The crawl saves each batch as it
  // reads it, so what the poll reports is what is already on disk.
  async function loadAmazonVideos() {
    setScanningVideos(true)
    try {
      let have = 0
      try { have = (await fetch('/api/amazon-videos').then(x => x.json()))?.count || 0 } catch { /* start from zero */ }
      // A library stored without Amazon's metrics has no lengths and no product
      // counts, and resuming from its count would read nothing and change
      // nothing. When that is the case, start again from the top so the rows are
      // rewritten with the figures Amazon only sends when asked.
      try {
        const ins = await fetch('/api/amazon-videos/insights').then(x => x.json())
        const known = ins?.deadWeight?.durationKnown ?? 0
        if (have > 0 && known === 0) {
          have = 0
          setVideoScan('Re-reading your library from the start, so Amazon sends the video lengths and product counts it withholds unless asked.')
        }
      } catch { /* resume as normal */ }

      // Start it, watch it, and restart it from its own checkpoint if Chrome
      // reclaims the extension's worker mid-crawl. Every reply is a short call
      // that cannot outlive the worker, so an interruption shows up as a job
      // with its position intact rather than as silence, and the creator gets
      // one click rather than an instruction to keep clicking.
      let status: VideoScanStatus | null = null
      let from = have
      for (let attempt = 0; attempt < 6; attempt++) {
        const started = await startCreatorHubVideosScan(hubUrl.trim() || undefined, from)
        if (!started.ok) {
          const human =
            started.error === 'not-installed' ? 'Install SCOUT and sign in to Amazon to read your videos.'
            : started.error === 'needs-update' ? 'Your SCOUT is too old to run this. Reinstall it from the link above, then try again.'
            : 'Could not start reading your Amazon videos.'
          setVideoScan(human)
          toast.error(human)
          return
        }
        setVideoScan(from ? `Resuming from ${from.toLocaleString()} videos.` : 'Opening your Amazon video list.')
        status = null
        for (let tick = 0; tick < 900; tick++) {
          await new Promise(r => setTimeout(r, 2000))
          status = await getVideoScanStatus()
          if (!status) continue
          if (status.done || status.interrupted) break
          const read = status.offset || from
          setVideoScan(
            `Reading your Amazon video library: ${read.toLocaleString()}` +
            `${status.total ? ` of ${status.total.toLocaleString()}` : ''} so far` +
            `${status.variant ? ` (${status.variant})` : ''}.`
          )
        }
        if (!status?.interrupted) break
        // Only worth restarting if it actually moved. A run interrupted at the
        // same place it started would loop forever on whatever is blocking it.
        if (status.offset <= from) break
        from = status.offset
        setVideoScan(`Chrome paused SCOUT at ${from.toLocaleString()} videos. Picking up from there.`)
      }

      const stored = await (async () => {
        try {
          const d = await fetch('/api/amazon-videos').then(x => x.json())
          return { count: d?.count || 0, pending: d?.pendingProducts || 0 }
        } catch { return { count: 0, pending: 0 } }
      })()
      setDataVersion(v => v + 1)
      void load()
      if (status?.sample) setVideoSample(status.sample)

      if (!status) {
        setVideoScan('SCOUT stopped answering, so there is nothing to report. Reload the page and try again.')
        toast.error('SCOUT stopped answering.')
        return
      }

      // Still going when the watch ran out. Saying nothing here would let a
      // half-read library fall through to the success message below and be
      // reported as complete, which is the one mistake this page must not make.
      if (!status.done && !status.interrupted) {
        setVideoScan(`Still reading, at ${status.offset.toLocaleString()} videos, and it has taken longer than expected. ${stored.count.toLocaleString()} are stored so far and are kept. Leave this page open, or run it again later to carry on.`)
        toast(`${stored.count.toLocaleString()} videos stored so far, still reading.`)
        return
      }

      // A reclaimed worker is not a failed read. Everything it had reached is
      // saved, and the only thing needed is another run from that point.
      if (status.interrupted) {
        setVideoScan(`Chrome stopped SCOUT part way through, at ${status.offset.toLocaleString()} videos. ${stored.count.toLocaleString()} are stored and kept. Run it again to carry on from there.`)
        toast(`${stored.count.toLocaleString()} videos stored. Run it again to continue.`)
        return
      }

      if (status.error) {
        if (status.error === 'wrong-page') {
          // Better to read nothing than to read the wrong page. An earlier
          // version harvested a shopping cart and filed it as the video library.
          setVideoScan(`SCOUT opened ${status.landedOn || 'that page'} and it is not your video list${status.pageTitle ? ` (it says "${status.pageTitle}")` : ''}, so nothing was saved. Open your video list in Chrome, copy the URL from the address bar, paste it in the box and run this again.${status.probe ? ` What was on the page: ${status.probe}` : ''}`)
          toast.error('That page is not your video list, so nothing was saved.')
          return
        }
        // Never put a raw error code on screen. "no-videos" told you nothing
        // about whether the library was empty or the page was unreadable.
        const human =
          status.error === 'signed-out' ? 'Amazon signed SCOUT out. Sign in to Amazon in this browser and try again.'
          : status.error === 'no-videos' ? 'That page loaded but SCOUT could not find any videos on it, so nothing was saved.'
          : status.error === 'list-api-empty' ? 'Amazon served your video list but SCOUT could not read it, so nothing was saved rather than saving something wrong.'
          : status.error === 'no-result' ? 'That page did not respond in a way SCOUT could read, so nothing was saved.'
          : 'Could not finish reading your Amazon videos.'
        setVideoScan(status.probe ? `${human} What was on the page: ${status.probe}` : human)
        toast.error(human)
        return
      }

      // Say what is STORED, not only what this run added. A run that adds
      // nothing because the library is already complete otherwise looks
      // identical to a run that failed.
      if (status.partial) {
        setVideoScan(`Read ${status.saved.toLocaleString()} videos across ${status.pages.toLocaleString()} pages, then stopped: ${status.stopped || 'no reason given'}. ${stored.count.toLocaleString()} are stored. Run it again to carry on.${status.scoutVersion ? ` SCOUT ${status.scoutVersion}.` : ''}`)
        toast(`${stored.count.toLocaleString()} videos stored. The crawl stopped early.`)
      } else {
        setVideoScan(
          `${stored.count.toLocaleString()} videos stored${status.saved ? `, ${status.saved.toLocaleString()} read this run` : ' (nothing new to add)'}` +
          `${stored.pending ? `. ${stored.pending.toLocaleString()} still need their products read.` : '.'}` +
          `${status.variant ? ` Amazon answered with ${status.variant}.` : ''}` +
          `${status.scoutVersion ? ` SCOUT ${status.scoutVersion}.` : ''}`
        )
        toast.success(`${stored.count.toLocaleString()} Amazon videos stored.`)
      }
    } finally { setScanningVideos(false) }
  }

  // Reads which products each video features. This is the join that turns the
  // library from a description of the content into an explanation of the income:
  // a video with no ASIN on it cannot be matched to earnings, to the storefront,
  // or to anything published off Amazon.
  //
  // Same shape as the library read, and for the same reason: one call per video
  // over thousands of videos cannot be held open across a message, so SCOUT runs
  // it as a job and this watches it.
  async function loadVideoProducts() {
    setScanningProducts(true)
    try {
      let status: VideoProductsStatus | null = null
      for (let attempt = 0; attempt < 6; attempt++) {
        const started = await startVideoProductsScan(hubUrl.trim() || undefined)
        if (!started.ok) {
          const human =
            started.error === 'not-installed' ? 'Install SCOUT and sign in to Amazon to read your videos.'
            : started.error === 'needs-update' ? 'Your SCOUT is too old to run this. Reinstall it from the link above, then try again.'
            : 'Could not start reading the products on your videos.'
          setProductScan(human)
          toast.error(human)
          return
        }
        setProductScan('Opening your video list and watching what Amazon asks for, so the right request can be replayed.')
        status = null
        for (let tick = 0; tick < 1200; tick++) {
          await new Promise(r => setTimeout(r, 2500))
          status = await getVideoProductsStatus()
          if (!status) continue
          if (status.done || status.interrupted) break
          setProductScan(
            status.endpoint
              ? `Reading products: ${status.read.toLocaleString()} videos done${status.remaining != null ? `, ${status.remaining.toLocaleString()} to go` : ''}. ${status.withProducts.toLocaleString()} had a product on them.`
              : 'Opening your video list and watching what Amazon asks for, so the right request can be replayed.'
          )
        }
        if (!status?.interrupted) break
        // Nothing gained means whatever stopped it will stop it again.
        if (!status.read) break
        setProductScan(`Chrome paused SCOUT after ${status.read.toLocaleString()} videos. Picking up from there.`)
      }

      setDataVersion(v => v + 1)
      void load()
      if (status?.sample) setVideoSample(status.sample)

      if (!status) {
        setProductScan('SCOUT stopped answering, so there is nothing to report. Reload the page and try again.')
        toast.error('SCOUT stopped answering.')
        return
      }
      if (!status.done && !status.interrupted) {
        setProductScan(`Still reading, ${status.read.toLocaleString()} videos done and ${status.remaining?.toLocaleString() ?? 'more'} to go. What has been read is saved. Run it again to carry on.`)
        return
      }
      if (status.interrupted) {
        setProductScan(`Chrome stopped SCOUT after ${status.read.toLocaleString()} videos. What was read is saved. Run it again to carry on.`)
        toast(`${status.read.toLocaleString()} videos read. Run it again to continue.`)
        return
      }
      if (status.error === 'no-detail-call') {
        // The honest outcome when Amazon offers no per-video call: say exactly
        // what was seen rather than storing something invented from the wrong
        // response.
        setProductScan(`Amazon never asked for a single video on its own, so there was no request to replay and nothing was stored. ${status.probe || ''}`)
        toast.error('No per-video request to replay, so nothing was stored.')
        return
      }
      if (status.error) {
        setProductScan(`Stopped after ${status.read.toLocaleString()} videos: ${status.error}. What was read is saved.${status.endpoint ? ` Replaying ${status.endpoint}.` : ''}`)
        toast.error('The product read stopped early.')
        return
      }
      setProductScan(
        `${status.read.toLocaleString()} videos read, ${status.withProducts.toLocaleString()} of them with a product attached, ${status.savedProducts.toLocaleString()} product rows saved.` +
        `${status.remaining ? ` ${status.remaining.toLocaleString()} still to go, run it again to carry on.` : ''}` +
        `${status.durationsFound ? ` Amazon also gave a length for ${status.durationsFound.toLocaleString()} of them.` : ' Amazon gave no length on this call either.'}` +
        `${status.endpoint ? ` Read from ${status.endpoint}.` : ''}`
      )
      toast.success(`${status.withProducts.toLocaleString()} videos now have their products.`)
    } finally { setScanningProducts(false) }
  }

  // The newest month is almost always partial, and an unlabelled partial month
  // reads as a crash: four days of September under a full August looks like a 94%
  // drop rather than a month that hasn't happened yet. So it gets labelled, and it
  // is left out of any month-to-month comparison.
  const now = new Date()
  const currentMonthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  const daysSoFar = now.getUTCDate()

  const shown = showQuiet ? rows : rows.filter(r => !isQuiet(r))
  const quietCount = rows.length - shown.length
  const byMonth = Array.from(new Set(shown.map(r => r.period_start))).sort().reverse()

  return (
    <>
      <PageHero
        title="Amazon Earnings"
        subtitle="Every Amazon income stream in one place: Creator Connections, Sponsored Products, commissions and bounties, split by onsite and offsite. Read straight from Amazon's own reporting, not from an export."
      />

      <div className="max-w-5xl pb-24 space-y-5">
        <div className="card p-5 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={label}>
              {lastSyncedAt ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}` : 'Not synced yet'}
            </p>
            <p className="text-[12px] mt-0.5" style={muted}>
              SCOUT reads these figures in your own Amazon session, the same calls the reporting pages make. Amazon&apos;s CSV exports are not used, because every one we tested returned a fraction of the real numbers.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={storeId}
              onChange={e => setStoreId(e.target.value)}
              placeholder="Store ID (e.g. yourname-20)"
              className="px-3 py-2 rounded-lg border text-sm bg-transparent w-56"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              title='Optional. Amazon shows this in its own header as "StoreID: …". Only needed if the sync cannot find it on its own.'
            />
          <button type="button" onClick={() => void startSync()} disabled={starting || !!sync?.running}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#7C3AED,#2563eb)' }}>
            {(starting || sync?.running)
              ? <><Loader2 size={15} className="animate-spin" /> {sync?.months ? `Month ${sync.monthsDone ?? 0} of ${sync.months}` : 'Starting…'}</>
              : <><RefreshCw size={15} /> {rows.length ? 'Re-sync' : 'Sync from Amazon'}</>}
          </button>
          <select
            value={yearsBack}
            onChange={e => setYearsBack(Number(e.target.value))}
            disabled={starting || !!sync?.running}
            className="px-3 py-2 rounded-lg border text-sm bg-transparent"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            title="How far back to read. Your videos go back years, so a longer history is what lets the output chart and the product ranking cover the same span as your library.">
            <option value={0}>This year</option>
            <option value={1}>Last 2 years</option>
            <option value={2}>Last 3 years</option>
            <option value={4}>Last 5 years</option>
          </select>
          {/* Reads the Creator Hub video table so MVP knows which products you
              already have a video for ON Amazon. Without it the product cards can
              only say a product has no video off Amazon, which is the weaker half
              of the sentence: the point is that the one on Amazon is already
              selling and has never left. */}
          <input
            value={hubUrl}
            onChange={e => { setHubUrl(e.target.value); try { localStorage.setItem('mvp_creatorhub_url', e.target.value.trim()) } catch { /* ignore */ } }}
            placeholder="https://www.amazon.com/manage-content"
            className="px-3 py-2 rounded-lg border text-sm bg-transparent w-64"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            title="Creator Studio, Manage content. Leave blank to use that page, or paste the exact URL of your video list if yours differs."
          />
          <button type="button" onClick={() => void loadAmazonVideos()} disabled={scanningVideos}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border disabled:opacity-60"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            title="Reads your Creator Hub video list so MVP knows which products already have a video on Amazon. Takes a few minutes for a big catalogue.">
            {scanningVideos
              ? <><Loader2 size={15} className="animate-spin" /> Reading your Amazon videos…</>
              : <><Video size={15} /> Load my Amazon videos</>}
          </button>
          {/* The second half, and the one that matters: a video with no ASIN on
              it cannot be joined to earnings, to the storefront, or to anything
              published off Amazon. Only offered once there are videos to read
              products for. */}
          {videoCount > 0 && (
            <button type="button" onClick={() => void loadVideoProducts()} disabled={scanningProducts}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border disabled:opacity-60"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              title="Reads which products each of your videos features, so MVP can tell you which video is selling what. One call per video, so it takes a while and picks up where it left off.">
              {scanningProducts
                ? <><Loader2 size={15} className="animate-spin" /> Reading products…</>
                : <><Package size={15} /> Read products for each video</>}
            </button>
          )}
          </div>
        </div>

        {productScan && (
          <div className="card p-4">
            <p className="text-[12px]" style={muted}>{productScan}</p>
          </div>
        )}

        {videoScan && (
          <div className="card p-4">
            <p className="text-[12px]" style={muted}>{videoScan}</p>
            {videoSample && (
              // Collapsed, because it is for working out where a missing figure
              // lives, not for reading. Amazon returns the engagement metrics
              // but no length and no product count, and the answer to why is in
              // here rather than in another guess at a field name.
              <details className="mt-2">
                <summary className="text-[12px] cursor-pointer" style={muted}>What Amazon sent for one video</summary>
                <pre className="mt-2 text-[11px] whitespace-pre-wrap break-all" style={muted}>{videoSample}</pre>
              </details>
            )}
          </div>
        )}

        {loadError && (
          <div className="card p-4" style={{ borderColor: '#e0554b55' }}>
            <p className="text-[13px]" style={{ color: '#e0554b' }}>{loadError}</p>
          </div>
        )}

        {/* Sync diagnostics render REGARDLESS of whether any rows landed. Putting
            them behind "we have data" hid them at the only moment they matter. */}
        {sync && (sync.diag?.stores?.length || sync.diag?.errors?.length || sync.error) && (
          <div className="card p-4 space-y-2">
            <p className="text-[12px] font-semibold" style={label}>Sync detail</p>
            {/* What the run actually filed. Whether the product rows landed was
                previously only discoverable by opening a panel, or by scrolling
                past three cards to see if a table had filled in. */}
            <p className="text-[11px]" style={muted}>
              {(sync.savedPeriods ?? 0).toLocaleString()} monthly total{sync.savedPeriods === 1 ? '' : 's'} and{' '}
              <span style={{ color: (sync.savedProducts ?? 0) > 0 ? '#10B981' : '#e0554b' }}>
                {(sync.savedProducts ?? 0).toLocaleString()} product row{sync.savedProducts === 1 ? '' : 's'}
              </span>
              {' '}saved{sync.months ? ` across ${sync.monthsDone ?? 0} of ${sync.months} months` : ''}.
            </p>
            {sync.diag?.stores?.length ? (
              <p className="text-[11px]" style={muted}>
                Amazon stores found: {sync.diag.stores.join(', ')}
              </p>
            ) : sync.done ? (
              <p className="text-[11px]" style={{ color: '#e0554b' }}>
                No Amazon store ids could be read from the reporting page, so there was nothing to ask for.
              </p>
            ) : null}
            {sync.error && <p className="text-[11px]" style={{ color: '#e0554b' }}>{sync.error}</p>}
            {sync.diag?.errors?.length ? (
              <ul className="text-[11px] space-y-0.5" style={muted}>
                {sync.diag.errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            ) : null}
            {(sync.diag?.reportCalls?.length || sync.diag?.recipe) && (
              <p className="text-[11px]" style={muted}>
                Reporting endpoints the page called: {sync.diag.reportCalls?.length ? sync.diag.reportCalls.join(', ') : 'none seen'}
                {sync.diag.recipe ? `. Replaying for products: ${sync.diag.recipe}` : ''}
              </p>
            )}
            {sync.diag?.productCounts && (
              <p className="text-[11px]" style={muted}>
                Products read per month: {Object.entries(sync.diag.productCounts).sort().map(([m, n]) => `${m.slice(0, 7)} ${n.toLocaleString()}`).join(', ')}
                {sync.diag.productPaging ? `. Paging by ${sync.diag.productPaging}.` : ''}
              </p>
            )}
            {sync.diag?.recipeBody && (
              <details className="text-[11px]" style={muted}>
                <summary className="cursor-pointer">The request the page made (replayed with the dates and store swapped)</summary>
                <pre className="mt-1 p-2 rounded text-[10px] whitespace-pre-wrap break-all max-h-64 overflow-y-auto" style={{ background: 'var(--surface-2)' }}>{sync.diag.recipeBody}</pre>
              </details>
            )}
            {!!sync.diag?.skipped && (
              <p className="text-[11px]" style={muted}>
                {sync.diag.skipped.toLocaleString()} product row{sync.diag.skipped === 1 ? '' : 's'} could not be filed
                {sync.diag.skippedReasons?.length ? `: ${sync.diag.skippedReasons.join(', ')}` : ''}. From 9 September Amazon groups low-activity products under &ldquo;Others&rdquo;, which carries no ASIN, so expect this number to grow and the coverage figure to fall.
              </p>
            )}
            {sync.diag?.sample && (
              <details className="text-[11px]" style={muted}>
                <summary className="cursor-pointer">Per-product mapping (what SCOUT read, and from which of Amazon&apos;s fields)</summary>
                {sync.diag.mapping && (
                  <p className="mt-1">
                    {Object.entries(sync.diag.mapping).map(([k, v]) => `${k}: ${v || 'not found'}`).join(', ')}
                  </p>
                )}
                <pre className="mt-1 p-2 rounded text-[10px] whitespace-pre-wrap break-all max-h-64 overflow-y-auto" style={{ background: 'var(--surface-2)' }}>{sync.diag.sample}</pre>
              </details>
            )}
            {sync.diag?.assoc && (
              <details className="text-[11px]" style={muted}>
                <summary className="cursor-pointer">Associates response ({sync.diag.assoc.status})</summary>
                <pre className="mt-1 p-2 rounded overflow-x-auto text-[10px]" style={{ background: 'var(--surface-2)' }}>{sync.diag.assoc.body?.slice(0, 1500)}</pre>
              </details>
            )}
          </div>
        )}

        {loading ? (
          <div className="card p-8 flex items-center justify-center gap-2 text-sm" style={muted}>
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="card p-8 text-center">
            <TrendingUp size={26} style={{ color: '#7C3AED' }} className="mx-auto mb-3" />
            <p className="text-[15px] font-semibold mb-1" style={label}>No earnings synced yet</p>
            <p className="text-[13px] max-w-lg mx-auto" style={muted}>
              Hit Sync from Amazon above. SCOUT opens a background tab on your Amazon reporting page and reads each month. Nothing is uploaded to Amazon and nothing is changed there.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { k: 'Total earnings', v: money(totals?.earningsCents), accent: '#10B981' },
                { k: 'Revenue driven', v: money(totals?.revenueCents), accent: '#7C3AED' },
                { k: 'Clicks', v: num(totals?.clicks), accent: '#0EA5A4' },
                { k: 'Orders', v: num(totals?.orders), accent: '#d97706' },
              ].map(c => (
                <div key={c.k} className="card p-4">
                  <p className="text-[11px] font-medium uppercase tracking-wide" style={muted}>{c.k}</p>
                  <p className="text-[22px] font-bold mt-1 tabular-nums" style={{ color: c.accent }}>{c.v}</p>
                </div>
              ))}
            </div>

            {/* Say what the total is before someone assumes it's everything. Right
                now it's Creator Connections plus Sponsored Products. Associates
                commissions and bounties come from a separate endpoint that still
                answers 401, so they are absent, and absent has to be visible. */}
            <p className="text-[11px] -mt-1" style={muted}>
              Counts Creator Connections and Sponsored Products, onsite and offsite. Associates commissions and bounties are not in this figure yet: Amazon serves those from a different report that SCOUT cannot read in your session, so leaving them out is more honest than guessing at them.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="card p-4">
                <p className="text-[12px] font-semibold mb-2 inline-flex items-center gap-1.5" style={label}><Store size={14} /> Onsite</p>
                <p className="text-[20px] font-bold tabular-nums" style={label}>{money(totals?.onsiteCents)}</p>
                {/* The distinction is about WHERE the sale started, not which
                    programme paid for it. Onsite is always a video of yours
                    playing on Amazon itself, whether the commission came through
                    Creator Connections or not. */}
                <p className="text-[11px] mt-1" style={muted}>
                  Earned on Amazon itself, from your videos on your storefront. Creator Connections or ordinary commission, it is the same shelf.
                </p>
              </div>
              <div className="card p-4">
                <p className="text-[12px] font-semibold mb-2 inline-flex items-center gap-1.5" style={label}><Globe size={14} /> Offsite</p>
                <p className="text-[20px] font-bold tabular-nums" style={label}>{money(totals?.offsiteCents)}</p>
                {/* Offsite is everything that started somewhere else and walked
                    in through a link. Amazon does not say which of those places
                    it was, so neither do we. */}
                <p className="text-[11px] mt-1" style={muted}>
                  Earned from links you placed elsewhere: YouTube, your blog, socials, a newsletter. Amazon does not say which of them sent the buyer.
                </p>
              </div>
            </div>

            {/* Which products made the money, above the month by month audit
                trail. The totals tell you how the year went; this is the part you
                can do something about on Monday. */}
            <ProductBreakdown refreshKey={dataVersion} />

            {/* What the video library says. Amazon records views, hearts and
                watch time on every video and shows almost none of it back in a
                form anyone can act on, so this is the largest piece of value on
                the page that costs the creator nothing to unlock. */}
            <VideoInsights refreshKey={dataVersion} />
            {/* The join between the library and the money. Renders nothing until
                there are videos, and says what it would answer until their
                products have been read. */}
            <VideoProducts refreshKey={dataVersion} />

            <div className="card p-5">
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <h2 className="text-sm font-semibold" style={label}>By month</h2>
                {quietCount > 0 || showQuiet ? (
                  <button
                    type="button"
                    onClick={() => setShowQuiet(v => !v)}
                    className="text-[12px] underline underline-offset-2"
                    style={muted}
                  >
                    {showQuiet
                      ? 'Hide the rows where Amazon reported all zeros'
                      : `Show ${quietCount} row${quietCount === 1 ? '' : 's'} where Amazon reported all zeros`}
                  </button>
                ) : null}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={muted}>
                      <th className="text-left font-medium py-2 pr-3">Month</th>
                      <th className="text-left font-medium py-2 pr-3">Stream</th>
                      <th className="text-left font-medium py-2 pr-3">Store</th>
                      <th className="text-right font-medium py-2 pr-3">Clicks</th>
                      <th className="text-right font-medium py-2 pr-3">Orders</th>
                      <th className="text-right font-medium py-2">Earnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byMonth.map(m => {
                      // Every row for the month, sorted, INCLUDING the all-zero ones
                      // even when they're folded away. The subtotal has to be the
                      // month's real total, not the total of what's on screen.
                      const monthRows = rows.filter(r => r.period_start === m)
                      const visible = shown.filter(r => r.period_start === m).sort((a, b) => rowRank(a) - rowRank(b))
                      const sub = sumRows(monthRows)
                      return [
                        ...visible.map((r, i) => (
                          <tr key={`${m}-${r.stream}-${r.store_id}`} className="border-t" style={{ borderColor: 'var(--border)' }}>
                            <td className="py-2 pr-3 align-top" style={label}>
                              {i === 0 ? (
                                <>
                                  {new Date(`${m}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}
                                  {m === currentMonthStart && (
                                    <span className="block text-[11px] font-normal mt-0.5" style={muted}>
                                      in progress, {daysSoFar} day{daysSoFar === 1 ? '' : 's'} so far
                                    </span>
                                  )}
                                </>
                              ) : ''}
                            </td>
                            <td className="py-2 pr-3" style={muted}>{STREAM_LABEL[r.stream] || r.stream}</td>
                            <td className="py-2 pr-3" style={muted}>
                              {r.store_scope || 'unknown'} <span className="font-mono text-[11px]">{r.store_id}</span>
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums" style={muted}>{num(r.clicks)}</td>
                            <td className="py-2 pr-3 text-right tabular-nums" style={muted}>{num(r.orders)}</td>
                            <td className="py-2 text-right tabular-nums font-medium" style={label}>{money(r.earnings_cents)}</td>
                          </tr>
                        )),
                        // Amazon's own page shows onsite and offsite added together
                        // whenever Store is set to All. This row is that same sum, so
                        // the two screens can be compared without doing the addition
                        // in your head.
                        <tr key={`${m}-total`} className="border-t" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
                          <td className="py-2 pr-3" />
                          <td className="py-2 pr-3 font-semibold" style={label} colSpan={2}>
                            {m === currentMonthStart ? 'Month so far, onsite plus offsite' : 'Month total, onsite plus offsite'}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums font-semibold" style={label}>{num(sub.clicks)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums font-semibold" style={label}>{num(sub.orders)}</td>
                          <td className="py-2 text-right tabular-nums font-bold" style={label}>{money(sub.earningsCents)}</td>
                        </tr>,
                      ]
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] mt-3" style={muted}>
                Figures come from Amazon&apos;s own reporting calls, so they should match what you see on Amazon for the same month and store. Where a cell reads &ldquo;not reported&rdquo;, Amazon returned nothing for that metric, which is not the same as zero. Rows where Amazon answered with all zeros are folded away by the link above rather than deleted. The newest month is still running, so read it as a partial month and not as a drop.
              </p>
            </div>

          </>
        )}
      </div>
    </>
  )
}
