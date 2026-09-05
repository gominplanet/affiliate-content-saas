// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What the creator's Amazon video library says about their business.
//
// Amazon records views, hearts, average percent viewed and watch duration on
// every video a creator publishes, and then shows almost none of it back in a
// form anyone can act on. This is that data arranged around four decisions:
// how long to make the next video, which uploads are dead weight, whether
// publishing more actually paid, and which work to repeat.
//
// The rules from the earnings page hold here too. A metric Amazon did not report
// reads as "not reported", never as zero, and every average says how many videos
// it was taken over so a partial picture is never presented as the whole one.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Film, Clock, TrendingUp, AlertTriangle } from 'lucide-react'

const label = { color: 'var(--text)' } as const
const muted = { color: 'var(--text-2)' } as const

interface TopVideo {
  aci: string
  description: string | null
  views: number | null
  hearts: number | null
  avgPctViewed: number | null
  durationSec: number | null
  productCount: number | null
  publishedAt: string | null
}
interface Payload {
  ok?: boolean
  error?: string
  videos?: number
  totals?: {
    views: number | null; hearts: number | null; medianViews: number | null
    avgPctViewed: number | null; reportedViews: number; reportedRetention: number
  }
  deadWeight?: { noViews: number; noProducts: number; notLive: number; productCountKnown: number; durationKnown: number }
  byLength?: { label: string; videos: number; avgPctViewed: number | null; medianViews: number | null; totalViews: number | null }[]
  months?: { month: string; videos: number; views: number | null; earningsCents: number | null }[]
  topByViews?: TopVideo[]
  topByHearts?: TopVideo[]
}

const num = (n: number | null | undefined) => (n == null ? 'not reported' : Math.round(n).toLocaleString())
const pct = (n: number | null | undefined) => (n == null ? 'not reported' : `${Math.round(n)}%`)
const money = (c: number | null | undefined) =>
  c == null ? 'not reported' : (c / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const secs = (s: number | null | undefined) =>
  (s == null || s <= 0 ? '' : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`)
const shortDesc = (d: string | null, aci: string) => {
  const t = (d || '').trim()
  if (!t) return aci
  return t.length > 64 ? `${t.slice(0, 64).trimEnd()}…` : t
}

export default function VideoInsights({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try { setData(await fetch('/api/amazon-videos/insights').then(r => r.json())) }
    catch { setData({ error: 'Could not load your video library.' }) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load, refreshKey])

  if (loading) {
    return (
      <div className="card p-8 flex items-center justify-center gap-2 text-sm" style={muted}>
        <Loader2 size={16} className="animate-spin" /> Reading your video library…
      </div>
    )
  }
  if (!data || data.error || !data.videos) {
    return (
      <div className="card p-5">
        <h2 className="text-sm font-semibold mb-1" style={label}>Your Amazon videos</h2>
        <p className="text-[13px]" style={muted}>
          {data?.error || 'No videos read yet. Use "Load my Amazon videos" above and MVP will read your library, with the views, hearts and watch time Amazon records on each one.'}
        </p>
      </div>
    )
  }

  const t = data.totals
  const dead = data.deadWeight
  const bands = data.byLength ?? []
  const months = data.months ?? []
  // The band that actually holds attention, which is the whole point of the
  // section. Only bands with enough videos to mean anything.
  const bestBand = bands.filter(b => b.videos >= 5 && b.avgPctViewed != null)
    .sort((a, b) => (b.avgPctViewed as number) - (a.avgPctViewed as number))[0]
  const durationKnown = dead?.durationKnown ?? 0
  const productCountKnown = dead?.productCountKnown ?? 0
  const maxVideos = Math.max(1, ...months.map(m => m.videos))
  const maxEarn = Math.max(1, ...months.map(m => m.earningsCents ?? 0))

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { k: 'Videos on Amazon', v: data.videos.toLocaleString(), accent: '#7C3AED' },
          { k: 'Total views', v: num(t?.views), accent: '#0EA5A4' },
          { k: 'Median views a video', v: num(t?.medianViews), accent: '#10B981' },
          { k: 'Average watched', v: pct(t?.avgPctViewed), accent: '#d97706' },
        ].map(c => (
          <div key={c.k} className="card p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide" style={muted}>{c.k}</p>
            <p className="text-[22px] font-bold mt-1 tabular-nums" style={{ color: c.accent }}>{c.v}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] -mt-1" style={muted}>
        Median rather than average views, because a handful of hits would otherwise make every video look successful.
        {t ? ` Amazon reported views on ${t.reportedViews.toLocaleString()} of ${data.videos.toLocaleString()} videos and watch time on ${t.reportedRetention.toLocaleString()}.` : ''}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card p-5">
          <p className="text-[12px] font-semibold mb-3 inline-flex items-center gap-1.5" style={label}>
            <Clock size={14} style={{ color: '#0EA5A4' }} /> How long should the next one be
          </p>
          {/* Amazon does not always return a duration, and without one this
              section cannot say anything. Better an empty panel that explains
              itself than a confident winner drawn from nothing. */}
          {durationKnown < Math.max(20, data.videos * 0.1) ? (
            <p className="text-[13px]" style={muted}>
              Amazon has not reported a length for {durationKnown ? 'most of' : 'any of'} your videos yet, so there is nothing here to compare. Run the video load again and MVP will ask Amazon for the metrics it withholds by default.
            </p>
          ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={muted}>
                  <th className="text-left font-medium py-1.5 pr-3">Length</th>
                  <th className="text-right font-medium py-1.5 pr-3">Videos</th>
                  <th className="text-right font-medium py-1.5 pr-3">Watched</th>
                  <th className="text-right font-medium py-1.5">Median views</th>
                </tr>
              </thead>
              <tbody>
                {bands.map(b => (
                  <tr key={b.label} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="py-1.5 pr-3" style={label}>{b.label}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums" style={muted}>{b.videos.toLocaleString()}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums font-medium"
                        style={{ color: bestBand && b.label === bestBand.label ? '#10B981' : 'var(--text)' }}>
                      {pct(b.avgPctViewed)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums" style={muted}>{num(b.medianViews)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] mt-3" style={muted}>
            {bestBand
              ? `Your ${bestBand.label.toLowerCase()} videos hold attention best, at ${pct(bestBand.avgPctViewed)} watched across ${bestBand.videos.toLocaleString()} of them.`
              : 'Not enough videos with watch time reported to call a winner yet.'}
            {' '}Bands with fewer than five videos are shown but never used to pick a winner. Based on the {durationKnown.toLocaleString()} videos Amazon reported a length for.
          </p>
          </>
          )}
        </div>

        <div className="card p-5">
          <p className="text-[12px] font-semibold mb-3 inline-flex items-center gap-1.5" style={label}>
            <AlertTriangle size={14} style={{ color: '#d97706' }} /> Where the effort went nowhere
          </p>
          <ul className="space-y-2 text-[13px]">
            <li className="flex justify-between gap-3">
              <span style={muted}>Videos with no views at all</span>
              <span className="tabular-nums font-semibold" style={label}>{dead?.noViews.toLocaleString() ?? '0'}</span>
            </li>
            {productCountKnown > 0 ? (
              <li className="flex justify-between gap-3">
                <span style={muted}>Videos with no product attached</span>
                <span className="tabular-nums font-semibold" style={label}>{dead?.noProducts.toLocaleString() ?? '0'}</span>
              </li>
            ) : (
              <li style={muted}>
                Amazon has not reported product counts yet, so MVP will not guess at how many of your videos have no product on them.
              </li>
            )}
            <li className="flex justify-between gap-3">
              <span style={muted}>Videos not live on Amazon</span>
              <span className="tabular-nums font-semibold" style={label}>{dead?.notLive.toLocaleString() ?? '0'}</span>
            </li>
          </ul>
          <p className="text-[11px] mt-3" style={muted}>
            A video with no product attached cannot earn, whatever it does for views. One that never went live cost the same to make as one that did. Both are worth knowing the size of before shooting more.
            {productCountKnown > 0 && productCountKnown < data.videos
              ? ` The product figure covers the ${productCountKnown.toLocaleString()} videos Amazon reported a count for, not all ${data.videos.toLocaleString()}.`
              : ''}
          </p>
        </div>
      </div>

      {months.length > 1 && (
        <div className="card p-5">
          <p className="text-[12px] font-semibold mb-3 inline-flex items-center gap-1.5" style={label}>
            <TrendingUp size={14} style={{ color: '#10B981' }} /> Did publishing more actually pay
          </p>
          <div className="overflow-x-auto">
            <div className="flex items-end gap-2 min-w-[520px]" style={{ height: 130 }}>
              {months.map(m => (
                <div key={m.month} className="flex-1 flex flex-col justify-end items-center gap-1" title={`${m.month}: ${m.videos} videos, ${money(m.earningsCents)}`}>
                  <div className="w-full flex items-end justify-center gap-0.5" style={{ height: 100 }}>
                    <div style={{ width: '42%', height: `${(m.videos / maxVideos) * 100}%`, background: '#7C3AED', borderRadius: '3px 3px 0 0', minHeight: m.videos ? 2 : 0 }} />
                    <div style={{ width: '42%', height: `${((m.earningsCents ?? 0) / maxEarn) * 100}%`, background: '#10B981', borderRadius: '3px 3px 0 0', minHeight: m.earningsCents ? 2 : 0 }} />
                  </div>
                  <span className="text-[10px]" style={muted}>{m.month.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[11px] mt-3" style={muted}>
            Purple is videos published, green is what you earned that month. The two bars are on separate scales, so read the SHAPE rather than the heights against each other: months where purple climbs and green does not are effort that did not convert.
          </p>
        </div>
      )}

      <div className="card p-5">
        <p className="text-[12px] font-semibold mb-3 inline-flex items-center gap-1.5" style={label}>
          <Film size={14} style={{ color: '#7C3AED' }} /> Your best work
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr style={muted}>
                <th className="text-left font-medium py-2 pr-3">Video</th>
                <th className="text-right font-medium py-2 pr-3">Views</th>
                <th className="text-right font-medium py-2 pr-3">Hearts</th>
                <th className="text-right font-medium py-2 pr-3">Watched</th>
                <th className="text-right font-medium py-2">Length</th>
              </tr>
            </thead>
            <tbody>
              {(data.topByViews ?? []).map(v => (
                <tr key={v.aci} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="py-2 pr-3" style={label}>
                    {shortDesc(v.description, v.aci)}
                    {v.publishedAt ? <span className="block text-[11px]" style={muted}>{v.publishedAt.slice(0, 10)}</span> : null}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums font-medium" style={label}>{num(v.views)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums" style={muted}>{num(v.hearts)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums" style={muted}>{pct(v.avgPctViewed)}</td>
                  <td className="py-2 text-right tabular-nums" style={muted}>{secs(v.durationSec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] mt-3" style={muted}>
          Ranked by views. These are the videos worth remaking for another product, and the ones worth posting to YouTube and socials where they have never been seen. What is not here yet is which product each one sold, which needs a separate read of every video.
        </p>
      </div>
    </div>
  )
}
