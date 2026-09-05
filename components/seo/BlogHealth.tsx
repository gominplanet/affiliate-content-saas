'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// How your blog is doing.
//
// The honest answer to "is this working", which nothing in MVP gave. The SEO
// page showed an average score of 99 out of 100 on a blog earning nothing, and
// a 28-day impression total that averaged away the fact that a site outage had
// taken traffic to zero four days earlier. The creator found that out from their
// host's bandwidth chart, which counts crawlers and bots probing wp-login and
// has nothing to do with whether a person read a post.
//
// So this shows the days, not the average, and states which link in the chain
// from search result to sale is broken. The judgement is in lib/blog-health.ts
// and tested there, including the two things this must never do: call a young
// blog a failing one, and credit the blog with money Amazon never attributed
// to it.

import { useEffect, useState } from 'react'
import { Loader2, Activity, AlertTriangle, TrendingUp } from 'lucide-react'
import type { BlogHealth } from '@/lib/blog-health'

const stageLabel: Record<string, string> = {
  'not-shown': 'Google is not showing your posts',
  'not-clicked': 'Shown, not clicked',
  'not-following-links': 'Read, no product clicks',
  'not-buying': 'Clicking through, not buying',
  working: 'The chain is working',
}

export default function BlogHealthCard() {
  const [data, setData] = useState<BlogHealth | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/seo/blog-health').then(r => r.json()).then(setData)
      .catch(() => setData(null)).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="rounded-2xl border p-4 mb-5 flex items-center gap-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <Loader2 size={15} className="animate-spin" style={{ color: 'var(--text-faint)' }} />
        <span className="text-[13px]" style={{ color: 'var(--text-soft)' }}>Working out how your blog is doing…</span>
      </div>
    )
  }
  if (!data) return null

  const bad = !!data.collapse
  const accent = bad ? '#e11d48' : data.stage === 'working' ? '#059669' : '#7C3AED'
  const days = data.daily.slice(-60)
  const peak = Math.max(1, ...days.map(d => d.impressions))

  return (
    <div
      className="rounded-2xl border mb-5 overflow-hidden"
      style={{ borderColor: bad ? 'rgba(225,29,72,0.4)' : 'var(--border)', background: bad ? 'rgba(225,29,72,0.05)' : 'var(--surface)' }}
    >
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-lg grid place-items-center flex-shrink-0" style={{ background: `${accent}1a` }}>
            {bad ? <AlertTriangle size={17} style={{ color: accent }} />
              : data.stage === 'working' ? <TrendingUp size={17} style={{ color: accent }} />
              : <Activity size={17} style={{ color: accent }} />}
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-bold" style={{ color: 'var(--text)' }}>How your blog is doing</p>
            <p className="text-[13px] mt-0.5 leading-relaxed" style={{ color: 'var(--text)' }}>{data.verdict}</p>
            <p className="text-[12.5px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-soft)' }}>{data.doThis}</p>
          </div>
        </div>

        {days.length > 7 && (
          <>
            {/* The days, not the average. A collapse is a shape, and no single
                number can carry a shape. */}
            <div className="flex items-end gap-[2px] mt-4" style={{ height: 70 }}>
              {days.map(d => {
                const dead = data.collapse && d.date >= data.collapse.date
                return (
                  <div
                    key={d.date}
                    className="flex-1 rounded-t-[2px]"
                    style={{
                      height: `${Math.max(d.impressions > 0 ? 3 : 1, (d.impressions / peak) * 100)}%`,
                      background: dead ? 'rgba(225,29,72,0.45)' : accent,
                      opacity: dead ? 1 : 0.75,
                    }}
                    title={`${d.date}: shown ${d.impressions.toLocaleString()} times, ${d.clicks.toLocaleString()} read it`}
                  />
                )
              })}
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10.5px]" style={{ color: 'var(--text-faint)' }}>{days[0].date}</span>
              <span className="text-[10.5px]" style={{ color: 'var(--text-faint)' }}>
                How often Google showed your posts, day by day
              </span>
              <span className="text-[10.5px]" style={{ color: 'var(--text-faint)' }}>{days[days.length - 1].date}</span>
            </div>
          </>
        )}

        {data.connected && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 pt-3.5" style={{ borderTop: '1px solid var(--border)' }}>
            <div>
              <p className="text-[10.5px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>Shown (28 days)</p>
              <p className="text-[16px] font-bold tabular-nums" style={{ color: 'var(--text)' }}>{data.recent.impressions.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10.5px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>Read it</p>
              <p className="text-[16px] font-bold tabular-nums" style={{ color: 'var(--text)' }}>{data.recent.clicks.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10.5px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>Where the chain stops</p>
              <p className="text-[13px] font-semibold" style={{ color: accent }}>{stageLabel[data.stage] ?? data.stage}</p>
            </div>
          </div>
        )}

        <p className="text-[11px] mt-3 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
          People who found you through Google, from Search Console. Your host&rsquo;s visitor chart counts something else
          entirely: crawlers, bots probing your login page, uptime monitors. On a blog with little search traffic almost
          all of that is machines, which is why the two never match and why this is the one to trust.
          {data.ageMonths != null ? ` Your blog has been publishing for ${data.ageMonths === 0 ? 'under a month' : `${data.ageMonths} month${data.ageMonths === 1 ? '' : 's'}`}.` : ''}
        </p>
      </div>
    </div>
  )
}
