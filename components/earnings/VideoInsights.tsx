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
import { Loader2, Film, Clock, TrendingUp, AlertTriangle, Heart, Radio, Globe } from 'lucide-react'

const label = { color: 'var(--text)' } as const
const muted = { color: 'var(--text-2)' } as const

interface TopVideo {
  aci: string
  description: string | null
  views: number | null
  hearts: number | null
  avgPctViewed: number | null
  durationSec: number | null
  durationDerived?: boolean | null
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
  deadWeight?: { noViews: number; noProducts: number; notLive: number; productCountKnown: number; durationKnown: number; durationDerived: number }
  byLength?: { label: string; videos: number; avgPctViewed: number | null; medianViews: number | null; totalViews: number | null }[]
  months?: { month: string; videos: number; views: number | null; earningsCents: number | null }[]
  topByViews?: TopVideo[]
  topByHearts?: TopVideo[]
  viewsByMonth?: { month: string; videos: number; medianViews: number | null; topDecileViews: number | null }[]
  retentionVsReach?: { label: string; videos: number; medianViews: number | null; medianHearts: number | null }[]
  resonance?: {
    floor: number; scored: number; median: number | null
    loved: ResonantVideo[]; ignored: ResonantVideo[]
  }
  zeroViewsByMonth?: { month: string; zero: number; videos: number }[]
  states?: { state: string; videos: number }[]
  concentration?: { onsiteCents: number | null; offsiteCents: number | null; totalViews: number | null }
}
interface ResonantVideo {
  aci: string
  description: string | null
  views: number
  hearts: number
  avgPctViewed: number | null
  publishedAt: string | null
  heartsPerThousand: number
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
  // How many of those lengths are worked out from watch time rather than
  // reported. It changes what the panel is allowed to claim, so it is never
  // hidden behind a rounded figure.
  const derivedCount = dead?.durationDerived ?? 0
  const productCountKnown = dead?.productCountKnown ?? 0
  const maxVideos = Math.max(1, ...months.map(m => m.videos))
  const maxEarn = Math.max(1, ...months.map(m => m.earningsCents ?? 0))

  const byPublish = data.viewsByMonth ?? []
  const maxMedian = Math.max(1, ...byPublish.map(m => m.medianViews ?? 0))
  const reach = data.retentionVsReach ?? []
  const maxReach = Math.max(1, ...reach.map(b => b.medianViews ?? 0))
  const res = data.resonance
  const conc = data.concentration
  // The offsite share, only when both halves were actually reported. A creator
  // who has never synced earnings gets no claim about where their money comes
  // from rather than a confident "0% offsite".
  const splitKnown = conc && conc.onsiteCents != null && conc.offsiteCents != null
  const totalCents = splitKnown ? (conc.onsiteCents as number) + (conc.offsiteCents as number) : null
  const offsiteShare = totalCents && totalCents > 0 ? ((conc?.offsiteCents as number) / totalCents) * 100 : null
  // The first and last months with enough videos to chart, for the plain reading
  // of the trend underneath it.
  const firstPub = byPublish[0]
  const lastPub = byPublish[byPublish.length - 1]
  // The month that carries most of the dead uploads, when one does. A cluster is
  // a cause worth finding; an even spread is just the tail of a big library, and
  // saying "look at March" about an even spread would send someone hunting for
  // nothing.
  const worstZeroMonth = (data.zeroViewsByMonth ?? [])
    .filter(m => m.videos >= 5)
    .sort((a, b) => (b.zero / b.videos) - (a.zero / a.videos))[0]
  // Every state other than the live ones, so "43 not live" becomes something a
  // person can act on: drafts can be finished, rejections cannot.
  const otherStates = (data.states ?? []).filter(s => !/live|publish/i.test(s.state) && s.state !== 'not reported')

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
              Amazon reports no length for your videos, and there is not enough watch time recorded on them to work one out either.
              A length can be derived wherever Amazon reports both the average seconds watched and the average percentage watched,
              and that is missing here.
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
            {' '}Bands with fewer than five videos are shown but never used to pick a winner.
            {derivedCount >= durationKnown && durationKnown > 0
              ? ` Amazon sends no duration with your videos, so these lengths are worked out from what it does send: a video watched for 19 seconds on average, at 40% of its length, is about 48 seconds long. They are close rather than exact, which is enough to compare bands and not enough to quote a single video's length.`
              : derivedCount > 0
                ? ` Based on ${durationKnown.toLocaleString()} videos, ${derivedCount.toLocaleString()} of them worked out from average watch time rather than reported by Amazon.`
                : ` Based on the ${durationKnown.toLocaleString()} videos Amazon reported a length for.`}
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
                Amazon does not report a product count on the video list, so MVP will not guess at how many of your videos have no product on them. The engagement figures above came from the same call, so this is a gap in what Amazon sends rather than something another run would fill.
              </li>
            )}
            <li className="flex justify-between gap-3">
              <span style={muted}>Videos not live on Amazon</span>
              <span className="tabular-nums font-semibold" style={label}>{dead?.notLive.toLocaleString() ?? '0'}</span>
            </li>
          </ul>
          <p className="text-[11px] mt-3" style={muted}>
            A video with no product attached cannot earn, whatever it does for views. One that never went live cost the same to make as one that did. Both are worth knowing the size of before shooting more.
            {worstZeroMonth && worstZeroMonth.zero >= 5
              ? ` The videos with no views are not spread evenly: ${worstZeroMonth.month} accounts for ${worstZeroMonth.zero.toLocaleString()} of them, ${Math.round((worstZeroMonth.zero / worstZeroMonth.videos) * 100)}% of everything published that month, which points at something that happened rather than at that many weak videos.`
              : ''}
            {otherStates.length
              ? ` The ones not live are: ${otherStates.map(s => `${s.videos.toLocaleString()} ${s.state.toLowerCase()}`).join(', ')}.`
              : ''}
            {productCountKnown > 0 && productCountKnown < data.videos
              ? ` The product figure covers the ${productCountKnown.toLocaleString()} videos Amazon reported a count for, not all ${data.videos.toLocaleString()}.`
              : ''}
          </p>
        </div>
      </div>

      {/* Where the money comes from, against where the audience is. On a library
          this size the gap between the two is usually the largest single fact on
          the page, and it has never had anywhere to appear. */}
      {splitKnown && offsiteShare != null && (
        <div className="card p-5">
          <p className="text-[12px] font-semibold mb-3 inline-flex items-center gap-1.5" style={label}>
            <Globe size={14} style={{ color: '#0EA5A4' }} /> Your audience is on Amazon and your income is too
          </p>
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <div>
              <p className="text-[11px] uppercase tracking-wide" style={muted}>Earned off Amazon</p>
              <p className="text-[22px] font-bold tabular-nums" style={{ color: '#d97706' }}>
                {offsiteShare < 1 ? 'under 1%' : `${Math.round(offsiteShare)}%`}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide" style={muted}>Views sitting on Amazon</p>
              <p className="text-[22px] font-bold tabular-nums" style={{ color: '#7C3AED' }}>{num(conc?.totalViews)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide" style={muted}>Onsite / offsite</p>
              <p className="text-[22px] font-bold tabular-nums" style={label}>
                {money(conc?.onsiteCents)} <span style={muted}>/</span> {money(conc?.offsiteCents)}
              </p>
            </div>
          </div>
          <p className="text-[11px] mt-3" style={muted}>
            Onsite money comes from your videos playing on your Amazon storefront. Offsite comes from links you placed
            anywhere else. A library with {num(conc?.totalViews)} views on Amazon and almost nothing earned off it is not a
            content problem, it is a distribution one: the videos already exist and have already proven they hold an audience.
          </p>
        </div>
      )}

      {/* Median views per video by publish month. Different question from output,
          and on a library of thousands the more important one. */}
      {byPublish.length > 2 && (
        <div className="card p-5">
          <p className="text-[12px] font-semibold mb-3 inline-flex items-center gap-1.5" style={label}>
            <Radio size={14} style={{ color: '#7C3AED' }} /> Is Amazon still showing your videos to people
          </p>
          <div className="overflow-x-auto">
            <div className="flex items-end gap-2 min-w-[520px]" style={{ height: 130 }}>
              {byPublish.map(m => (
                <div key={m.month} className="flex-1 flex flex-col justify-end items-center gap-1"
                     title={`${m.month}: ${m.videos} videos, median ${num(m.medianViews)} views, top tenth ${num(m.topDecileViews)}`}>
                  <div className="w-full flex items-end justify-center" style={{ height: 100 }}>
                    <div style={{ width: '60%', height: `${((m.medianViews ?? 0) / maxMedian) * 100}%`, background: '#7C3AED', borderRadius: '3px 3px 0 0', minHeight: m.medianViews ? 2 : 0 }} />
                  </div>
                  <span className="text-[10px]" style={muted}>{m.month.slice(2).replace('-', '/')}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[11px] mt-3" style={muted}>
            The typical video published that month, not the total. {firstPub && lastPub && firstPub.medianViews != null && lastPub.medianViews != null
              ? `A video published in ${firstPub.month} typically got ${num(firstPub.medianViews)} views; one published in ${lastPub.month} typically got ${num(lastPub.medianViews)}.`
              : ''}{' '}
            Read it knowing older videos have had longer to accumulate, which flatters the left of the chart. Amazon reports
            one lifetime view count per video and no curve, so that bias is stated rather than corrected away with a guess.
            Months with fewer than five videos are left out.
          </p>
        </div>
      )}

      {/* Does holding attention buy reach? Both figures are per video and both
          are lifetime, so unlike views against monthly earnings this one is a
          fair comparison. */}
      {reach.length > 2 && (
        <div className="card p-5">
          <p className="text-[12px] font-semibold mb-3 inline-flex items-center gap-1.5" style={label}>
            <TrendingUp size={14} style={{ color: '#10B981' }} /> Does holding attention get you seen
          </p>
          <div className="space-y-2">
            {reach.map(b => (
              <div key={b.label} className="flex items-center gap-3">
                <span className="text-[12px] w-32 shrink-0" style={muted}>{b.label}</span>
                <div className="flex-1 h-4 rounded" style={{ background: 'var(--border)' }}>
                  <div className="h-4 rounded" style={{ width: `${((b.medianViews ?? 0) / maxReach) * 100}%`, background: '#10B981', minWidth: b.medianViews ? 3 : 0 }} />
                </div>
                <span className="text-[12px] tabular-nums w-28 text-right" style={label}>{num(b.medianViews)} views</span>
                <span className="text-[11px] tabular-nums w-24 text-right" style={muted}>{b.videos.toLocaleString()} videos</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] mt-3" style={muted}>
            Median views for the videos in each band of percent watched. If the bars climb, retention is buying you reach and
            the next video should be tighter. If they are flat, Amazon is deciding who sees your work on something other than
            how much of it people watch, and length and pacing are not the lever.
          </p>
        </div>
      )}

      {/* Hearts per thousand views. A ranking by views cannot separate the work
          people loved from the work Amazon simply pushed. */}
      {res && res.scored > 0 && res.loved.length > 0 && (
        <div className="card p-5">
          <p className="text-[12px] font-semibold mb-3 inline-flex items-center gap-1.5" style={label}>
            <Heart size={14} style={{ color: '#e0554b' }} /> What people actually loved
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={muted}>
                  <th className="text-left font-medium py-2 pr-3">Video</th>
                  <th className="text-right font-medium py-2 pr-3">Views</th>
                  <th className="text-right font-medium py-2 pr-3">Hearts</th>
                  <th className="text-right font-medium py-2">Hearts per 1,000</th>
                </tr>
              </thead>
              <tbody>
                {res.loved.map(v => (
                  <tr key={v.aci} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="py-2 pr-3" style={label}>
                      {shortDesc(v.description, v.aci)}
                      {v.publishedAt ? <span className="block text-[11px]" style={muted}>{v.publishedAt.slice(0, 10)}</span> : null}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums" style={muted}>{num(v.views)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums" style={muted}>{num(v.hearts)}</td>
                    <td className="py-2 text-right tabular-nums font-medium" style={{ color: '#e0554b' }}>{v.heartsPerThousand.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] mt-3" style={muted}>
            Ranked by hearts for every thousand views, across the {res.scored.toLocaleString()} videos with at least{' '}
            {res.floor.toLocaleString()} views, because without a floor one video with three views and a heart tops the list forever.
            {res.median != null ? ` The typical video here draws ${res.median.toFixed(1)} hearts a thousand views.` : ''}{' '}
            These are the ones an audience reacted to rather than the ones Amazon happened to push, and they are a better guide
            to what to make again than the view count is.
          </p>
          {res.ignored.length > 0 && (
            <p className="text-[11px] mt-2" style={muted}>
              At the other end, {shortDesc(res.ignored[0].description, res.ignored[0].aci)} drew {num(res.ignored[0].views)} views and{' '}
              {num(res.ignored[0].hearts)} hearts. Reach without a reaction is usually a product Amazon wanted to sell rather
              than a video anyone wanted to watch.
            </p>
          )}
        </div>
      )}

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
          Ranked by views. These are the videos worth remaking for another product, and the ones worth posting to YouTube and socials where they have never been seen.
          {(data.topByViews ?? []).some(v => v.durationDerived)
            ? ' Lengths are worked out from average watch time, since Amazon sends none, so read them as approximate.'
            : ''}
        </p>
      </div>
    </div>
  )
}
