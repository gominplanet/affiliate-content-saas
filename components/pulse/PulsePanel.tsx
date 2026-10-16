'use client'

import { useEffect, useState } from 'react'
import { Activity, TrendingUp, TrendingDown, Users, Loader2, Clock } from 'lucide-react'

/**
 * Pulse panel — a read-only view of which hashtags are actually earning reach,
 * for this creator and (per niche) across all MVP creators. "Lift" is how far a
 * post beat the poster's OWN average, so a small account and a big one are
 * compared fairly. Self-hides until there's something to show.
 */

interface TagStat { tag: string; samples: number; avgLift: number }
interface TimeBucket { key: number; avgLift: number; samples: number }
interface BestTimes {
  samples: number
  bestWeekday: TimeBucket | null
  bestHour: TimeBucket | null
  topWindows: Array<{ weekday: number; hour: number; avgLift: number; samples: number }>
  byWeekday: TimeBucket[]
}
interface PlatformRow {
  platform: string; label: string
  posted: number; measured: number; waiting: number; noResults: number; failed: number
  sharesResults: boolean; measuredBy: string | null; noResultsWhy: string | null
  top: TagStat[]
  /** Of the tags MVP posted here since it began reading live data: how many
   *  the platform's own numbers vouch for, and dead ends (null: no reading here). */
  research?: { used: number; read: number; dead: number; vouched: Array<{ tag: string; label: string | null }> } | null
}
interface Summary {
  byPlatform?: PlatformRow[]
  collecting: boolean
  sampleCount: number
  minForPersonal: number
  personalTop: TagStat[]
  personalBottom: TagStat[]
  pooled: Array<{ niche: string; tags: TagStat[] }>
  bestTimes: BestTimes | null
}

const pct = (lift: number) => `${lift >= 1 ? '+' : ''}${Math.round((lift - 1) * 100)}%`
const nicheLabel = (k: string) => k.replace(/-/g, ' ')
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const fmtHour = (h: number) => { const am = h < 12; const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12}${am ? 'am' : 'pm'}` }
const fmtWindow = (w: { weekday: number; hour: number }) => `${DOW_SHORT[w.weekday]} ${fmtHour(w.hour)}`

function TagRow({ t, tone }: { t: TagStat; tone: 'up' | 'down' | 'neutral' }) {
  const color = tone === 'up' ? '#34c759' : tone === 'down' ? '#ff9500' : '#7C3AED'
  return (
    <div className="flex items-center justify-between py-1.5 border-b last:border-0" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
      <span className="text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{t.tag}</span>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">{t.samples} post{t.samples === 1 ? '' : 's'}</span>
        <span className="text-[12px] font-semibold tabular-nums" style={{ color }}>{pct(t.avgLift)}</span>
      </div>
    </div>
  )
}

export default function PulsePanel({ alwaysShow = false }: { alwaysShow?: boolean } = {}) {
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    // Pass the viewer's tz offset so best-times read in their own clock.
    const tz = new Date().getTimezoneOffset()
    fetch(`/api/pulse/summary?tz=${tz}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: Summary | null) => { if (alive && d) setData(d) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  if (loading) return null
  if (!data) return null

  const bt = data.bestTimes
  const hasBestTimes = !!bt && (bt.topWindows.length > 0 || !!bt.bestWeekday || !!bt.bestHour)
  const platforms = (data.byPlatform || []).filter(p => p.posted > 0)
  const notYet = (data.byPlatform || []).filter(p => p.posted === 0).map(p => p.label)
  const hasAnything = platforms.length > 0 || data.personalTop.length > 0 || data.personalBottom.length > 0 || data.pooled.length > 0 || hasBestTimes
  // On embedded surfaces, stay out of the way until there's something to show.
  // The dedicated /pulse page passes alwaysShow so the "collecting" state is
  // still visible at zero data.
  if (!alwaysShow && data.collecting && !hasAnything && data.sampleCount === 0) return null

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'rgba(124,58,237,0.25)', background: 'rgba(124,58,237,0.04)' }}>
      <div className="flex items-center gap-2 px-5 py-3.5 border-b" style={{ borderColor: 'rgba(124,58,237,0.15)' }}>
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#7C3AED]/12 text-[#7C3AED]"><Activity size={15} /></span>
        <div>
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Pulse</p>
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">What actually earns reach: your best hashtags and posting times. Lift = how far a post beat your own average.</p>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {data.collecting && (
          <div className="flex items-center gap-2 text-[12px] text-[#6e6e73] dark:text-[#a1a1a6]">
            <Loader2 size={13} className="animate-spin text-[#7C3AED]" />
            Learning from your posts: {data.sampleCount}/{data.minForPersonal} measured so far. Your personal ranking unlocks once a few more posts have their numbers in.
          </div>
        )}

        {hasBestTimes && bt && (
          <div>
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[#0a84ff] mb-1.5"><Clock size={13} /> Best times to post</p>
            {bt.topWindows.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {bt.topWindows.map((w, i) => (
                  <span key={i} className="text-[12px] font-medium px-2 py-1 rounded-lg" style={{ background: 'rgba(10,132,255,0.1)', color: '#0a63cc' }}>
                    {fmtWindow(w)} <span className="font-semibold">{pct(w.avgLift)}</span>
                  </span>
                ))}
              </div>
            )}
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
              {bt.bestWeekday ? `${DOW[bt.bestWeekday.key]}s are your strongest day (${pct(bt.bestWeekday.avgLift)} vs your average).` : ''}
              {bt.bestHour ? ` Around ${fmtHour(bt.bestHour.key)} tends to land best.` : ''}
              {' '}Based on {bt.samples} measured post{bt.samples === 1 ? '' : 's'}, in your timezone.
            </p>
          </div>
        )}

        {platforms.length > 0 && (
          <div>
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5"><Activity size={13} /> Every platform, last 90 days</p>
            <div className="space-y-2">
              {platforms.map(p => (
                <div key={p.platform} className="rounded-xl border px-3 py-2.5" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{p.label}</span>
                    <span className="text-[11px] tabular-nums text-[#86868b] dark:text-[#8e8e93]">
                      {p.posted} post{p.posted === 1 ? '' : 's'} with hashtags
                      {p.sharesResults ? ` · ${p.measured} measured${p.waiting ? ` · ${p.waiting} waiting` : ''}${p.failed ? ` · ${p.failed} could not be read` : ''}` : ''}
                    </span>
                  </div>
                  {p.sharesResults ? (
                    <p className="text-[11px] text-[#6e6e73] dark:text-[#a1a1a6] mt-0.5">
                      Measured by {p.measuredBy}, against your own {p.label} average.
                      {p.noResults ? ` ${p.noResults} post${p.noResults === 1 ? '' : 's'} came back without an id, so cannot be measured.` : ''}
                    </p>
                  ) : (
                    <p className="text-[11px] text-[#6e6e73] dark:text-[#a1a1a6] mt-0.5">Tags recorded, results not available: {p.noResultsWhy || 'this platform does not share post results with MVP.'}</p>
                  )}
                  {p.research && p.research.used > 0 && (
                    <p className="text-[11px] mt-1" style={{ color: p.research.dead ? '#c93400' : '#248a3d' }}>
                      Research: {p.research.read} of the {p.research.used} tags MVP posted here had a live reading from {p.label}
                      {p.research.dead ? `, and ${p.research.dead} ${p.research.dead === 1 ? 'was a dead end' : 'were dead ends'} (almost nobody uses ${p.research.dead === 1 ? 'it' : 'them'}).` : ', and none was a dead end.'}
                      {p.research.vouched.length > 0 && <span style={{ color: 'var(--text-3)' }}> {p.research.vouched.map(v => v.tag).join(' ')}</span>}
                    </p>
                  )}
                  {p.research && p.research.used === 0 && p.posted > 0 && (
                    <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>Research: no posts here yet since MVP began picking tags from live {p.label} data.</p>
                  )}
                  {p.top.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {p.top.map(t => (
                        <span key={t.tag} className="text-[12px] px-2 py-0.5 rounded-lg tabular-nums" style={{ background: 'rgba(52,199,89,0.1)', color: '#248a3d' }}>{t.tag} {pct(t.avgLift)}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {notYet.length > 0 && <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1.5">No posts with hashtags yet on {notYet.join(', ')}.</p>}
          </div>
        )}

        {data.personalTop.length > 0 && (
          <div>
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[#34c759] mb-1"><TrendingUp size={13} /> Your best hashtags</p>
            <div>{data.personalTop.map(t => <TagRow key={t.tag} t={t} tone="up" />)}</div>
          </div>
        )}

        {data.personalBottom.length > 0 && (
          <div>
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[#ff9500] mb-1"><TrendingDown size={13} /> Underperforming for you</p>
            <div>{data.personalBottom.map(t => <TagRow key={t.tag} t={t} tone="down" />)}</div>
          </div>
        )}

        {data.pooled.map(p => (
          <div key={p.niche}>
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[#7C3AED] mb-1 capitalize"><Users size={13} /> Across MVP · {nicheLabel(p.niche)}</p>
            <div>{p.tags.map(t => <TagRow key={t.tag} t={t} tone="neutral" />)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
