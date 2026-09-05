// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Which video sells what.
//
// The question this whole feature was built to answer, and the one the video
// library alone could never touch: a video with no ASIN on it can say how many
// people watched and nothing about what that was worth.
//
// The hard rule here is what this panel refuses to say. Amazon records earnings
// per PRODUCT, and a product can appear in a dozen videos, so "this video earned
// $500" is a claim the data cannot carry. The wording throughout is "the
// products in this video earned", which is weaker and true. The one exception is
// a product featured in exactly one video: there the money has one place it can
// have come from, and that gets its own section and its own stronger wording.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Link2, Target, Repeat, Clapperboard } from 'lucide-react'

const label = { color: 'var(--text)' } as const
const muted = { color: 'var(--text-2)' } as const

interface Payload {
  ok?: boolean
  error?: string
  coverage?: {
    videos: number; videosRead: number; videosWithProduct: number; distinctProducts: number
    earningProducts: number; earningProductsWithVideo: number; readEnough: boolean
  }
  soleVideo?: { aci: string; description: string | null; asin: string; title: string | null; earningsCents: number; views: number | null }[]
  earningNoVideo?: { asin: string; title: string | null; earningsCents: number }[]
  mostFilmed?: { asin: string; title: string | null; videos: number; earningsCents: number | null }[]
  topVideosByProductEarnings?: { aci: string; description: string | null; views: number | null; products: number; productEarningsCents: number; sole: boolean }[]
  shelfNoVideo?: { asin: string; title: string | null }[]
  shelfKnown?: boolean
}

const money = (c: number | null | undefined) =>
  c == null ? 'not reported' : (c / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const num = (n: number | null | undefined) => (n == null ? 'not reported' : Math.round(n).toLocaleString())
const short = (d: string | null, fallback: string) => {
  const t = (d || '').trim()
  if (!t) return fallback
  return t.length > 58 ? `${t.slice(0, 58).trimEnd()}…` : t
}
const amazon = (asin: string) => `https://www.amazon.com/dp/${asin}`

export default function VideoProducts({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try { setData(await fetch('/api/amazon-videos/product-insights').then(r => r.json())) }
    catch { setData({ error: 'Could not load the products on your videos.' }) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load, refreshKey])

  if (loading) {
    return (
      <div className="card p-8 flex items-center justify-center gap-2 text-sm" style={muted}>
        <Loader2 size={16} className="animate-spin" /> Matching your videos to your products…
      </div>
    )
  }
  const cov = data?.coverage
  if (!data || data.error || !cov || !cov.videos) return null

  // Nothing read yet. Say what this would answer and how to get it, rather than
  // rendering four empty panels.
  if (!cov.videosRead) {
    return (
      <div className="card p-5">
        <h2 className="text-sm font-semibold mb-1 inline-flex items-center gap-1.5" style={label}>
          <Link2 size={15} style={{ color: '#7C3AED' }} /> Which video sells what
        </h2>
        <p className="text-[13px]" style={muted}>
          Your {cov.videos.toLocaleString()} videos carry no product yet, so they cannot be matched to what you earned.
          Use &ldquo;Read products for each video&rdquo; above. It is one call per video so it takes a while, it picks up where it
          left off, and when it has run this shows which of your videos are behind which sales, which products you are
          filming repeatedly for nothing, and which earners you have never filmed at all.
        </p>
      </div>
    )
  }

  const sole = data.soleVideo ?? []
  const gap = data.earningNoVideo ?? []
  const filmed = data.mostFilmed ?? []
  const topVideos = data.topVideosByProductEarnings ?? []
  const shelfGap = data.shelfNoVideo ?? []
  const partial = cov.videosRead < cov.videos

  return (
    <div className="space-y-3">
      <div className="card p-5">
        <h2 className="text-sm font-semibold mb-1 inline-flex items-center gap-1.5" style={label}>
          <Link2 size={15} style={{ color: '#7C3AED' }} /> Which video sells what
        </h2>
        <p className="text-[12px]" style={muted}>
          {cov.videosRead.toLocaleString()} of {cov.videos.toLocaleString()} videos read for products.{' '}
          {cov.videosWithProduct.toLocaleString()} of those have a product on them, covering{' '}
          {cov.distinctProducts.toLocaleString()} distinct products.{' '}
          {cov.earningProducts > 0
            ? `${cov.earningProductsWithVideo.toLocaleString()} of the ${cov.earningProducts.toLocaleString()} products that earned have a video.`
            : ''}
          {partial ? ' Read the rest and everything below gets sharper.' : ''}
        </p>
      </div>

      {sole.length > 0 && (
        <div className="card p-5">
          <p className="text-[12px] font-semibold mb-1 inline-flex items-center gap-1.5" style={label}>
            <Target size={14} style={{ color: '#10B981' }} /> These videos are doing the selling
          </p>
          <p className="text-[11px] mb-3" style={muted}>
            Each of these products appears in exactly one of your videos, so the money has one place it can have come from.
            This is the only part of this page where a video can honestly be credited with earnings.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={muted}>
                  <th className="text-left font-medium py-2 pr-3">Product</th>
                  <th className="text-left font-medium py-2 pr-3">Its only video</th>
                  <th className="text-right font-medium py-2 pr-3">Views</th>
                  <th className="text-right font-medium py-2">Earned</th>
                </tr>
              </thead>
              <tbody>
                {sole.map(s => (
                  <tr key={`${s.aci}-${s.asin}`} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="py-2 pr-3" style={label}>
                      {short(s.title, s.asin)}
                      <a href={amazon(s.asin)} target="_blank" rel="noreferrer" className="block text-[11px] underline" style={muted}>{s.asin}</a>
                    </td>
                    <td className="py-2 pr-3" style={muted}>{short(s.description, s.aci)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums" style={muted}>{num(s.views)}</td>
                    <td className="py-2 text-right tabular-nums font-semibold" style={{ color: '#10B981' }}>{money(s.earningsCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] mt-3" style={muted}>
            These are the videos to remake for similar products, and the ones with the clearest case for posting to YouTube
            and socials: they have already proven they can sell the thing.
          </p>
        </div>
      )}

      {gap.length > 0 && (
        <div className="card p-5">
          <p className="text-[12px] font-semibold mb-1 inline-flex items-center gap-1.5" style={label}>
            <Clapperboard size={14} style={{ color: '#d97706' }} /> Earning with no video of yours on it
          </p>
          <p className="text-[11px] mb-3" style={muted}>
            These products made you money and none of your videos features them. The demand is already proven, so this is the
            shortest list of things to shoot next on the whole page.
          </p>
          <div className="space-y-1.5">
            {gap.map(p => (
              <div key={p.asin} className="flex items-baseline justify-between gap-3">
                <span className="text-[13px]" style={label}>
                  {short(p.title, p.asin)}
                  <a href={amazon(p.asin)} target="_blank" rel="noreferrer" className="ml-2 text-[11px] underline" style={muted}>{p.asin}</a>
                </span>
                <span className="text-[13px] tabular-nums font-medium shrink-0" style={{ color: '#d97706' }}>{money(p.earningsCents)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {filmed.length > 0 && (
        <div className="card p-5">
          <p className="text-[12px] font-semibold mb-1 inline-flex items-center gap-1.5" style={label}>
            <Repeat size={14} style={{ color: '#0EA5A4' }} /> Filmed again and again
          </p>
          <p className="text-[11px] mb-3" style={muted}>
            Products you have made several videos for, against what they earned. Neither table can show this on its own, and
            it is where repeated effort that never paid becomes visible.
          </p>
          <div className="space-y-1.5">
            {filmed.map(p => (
              <div key={p.asin} className="flex items-baseline justify-between gap-3">
                <span className="text-[13px]" style={label}>
                  {short(p.title, p.asin)}
                  <span className="ml-2 text-[11px]" style={muted}>{p.videos} videos</span>
                </span>
                <span className="text-[13px] tabular-nums shrink-0"
                      style={{ color: p.earningsCents == null ? 'var(--text-2)' : p.earningsCents > 0 ? '#10B981' : '#e0554b' }}>
                  {p.earningsCents == null ? 'not in the earnings report' : money(p.earningsCents)}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[11px] mt-3" style={muted}>
            &ldquo;Not in the earnings report&rdquo; means Amazon did not report on that product, which is not the same as it
            earning nothing. Only the figures shown are claims.
          </p>
        </div>
      )}

      {topVideos.length > 0 && (
        <div className="card p-5">
          <p className="text-[12px] font-semibold mb-1 inline-flex items-center gap-1.5" style={label}>
            <Target size={14} style={{ color: '#7C3AED' }} /> Your videos, by what their products earned
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={muted}>
                  <th className="text-left font-medium py-2 pr-3">Video</th>
                  <th className="text-right font-medium py-2 pr-3">Products</th>
                  <th className="text-right font-medium py-2 pr-3">Views</th>
                  <th className="text-right font-medium py-2">Its products earned</th>
                </tr>
              </thead>
              <tbody>
                {topVideos.map(v => (
                  <tr key={v.aci} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="py-2 pr-3" style={label}>
                      {short(v.description, v.aci)}
                      {v.sole ? <span className="block text-[11px]" style={{ color: '#10B981' }}>the only video for everything in it</span> : null}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums" style={muted}>{v.products}</td>
                    <td className="py-2 pr-3 text-right tabular-nums" style={muted}>{num(v.views)}</td>
                    <td className="py-2 text-right tabular-nums font-medium" style={label}>{money(v.productEarningsCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] mt-3" style={muted}>
            This is what the products in each video earned across everything you do, NOT what the video earned. A product can
            appear in several of your videos and Amazon records the money against the product, so crediting one video with it
            would be inventing a number. The rows marked as the only video for everything in them are the exception, and they
            are the ones to trust.
          </p>
        </div>
      )}

      {data.shelfKnown && shelfGap.length > 0 && (
        <div className="card p-5">
          <p className="text-[12px] font-semibold mb-1 inline-flex items-center gap-1.5" style={label}>
            <Clapperboard size={14} style={{ color: '#0EA5A4' }} /> On your storefront, never filmed
          </p>
          <p className="text-[11px] mb-3" style={muted}>
            Products you have put on your shelf without a video. A shelf listing with nothing to watch is the weakest thing on
            a storefront, and these already have your endorsement behind them.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {shelfGap.map(p => (
              <a key={p.asin} href={amazon(p.asin)} target="_blank" rel="noreferrer" className="text-[13px] underline" style={muted}>
                {short(p.title, p.asin)}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
