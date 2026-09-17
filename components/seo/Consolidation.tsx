'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The posts that are doing nothing, and how fast you are adding to them.
//
// 279 posts on one site, 47 indexed, 394 sitting in Google's "Crawled, currently
// not indexed". That catalogue is not helped by a 280th post. It is helped by
// turning the weakest forty into the strongest ten, and until now nothing in MVP
// would tell anybody which forty.
//
// This panel is READ ONLY and deliberately so. Merging and redirecting are
// destructive to live content on somebody's own site, and the right shape for
// that is a list a person reads and decides on. There is no button here that
// changes anything.
//
// The two things it must not do are both enforced in lib/consolidation.ts and
// tested there: never call a new post weak, because Google takes months to
// decide and a creator would delete work that was about to earn; and never offer
// a post that RANKS as a merge candidate, because merging it away throws out a
// ranking to fix a title problem that takes ten minutes.

import { useEffect, useState } from 'react'
import { Loader2, Layers, ExternalLink, Gauge } from 'lucide-react'
import type { ConsolidationReport } from '@/lib/consolidation'
import type { VelocityRead } from '@/lib/publish-velocity'

interface Payload extends ConsolidationReport {
  connected: boolean
  totalPosts: number
  ageMonths: number | null
  velocity: VelocityRead
}

const weaknessLabel: Record<string, string> = {
  'never-shown': 'Never shown',
  'shown-never-clicked': 'Ranking, not clicked',
  thin: 'Thin',
}

/** Ranking posts must not read as merge candidates, so they are coloured as the
 *  different thing they are rather than sharing the "dead" treatment. */
const weaknessTone: Record<string, string> = {
  'never-shown': 'var(--text-faint)',
  'shown-never-clicked': '#1c7a35',
  thin: '#b26a00',
}

export default function ConsolidationCard() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    fetch('/api/seo/consolidation').then(r => r.json()).then(setData)
      .catch(() => setData(null)).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="rounded-2xl border p-4 mb-5 flex items-center gap-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <Loader2 size={15} className="animate-spin" style={{ color: 'var(--text-faint)' }} />
        <span className="text-[13px]" style={{ color: 'var(--text-soft)' }}>Checking which posts are earning their place…</span>
      </div>
    )
  }
  if (!data) return null

  const shown = expanded ? data.candidates : data.candidates.slice(0, 8)

  return (
    <div className="rounded-2xl border p-4 mb-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex items-start gap-2.5">
        <Layers size={16} style={{ color: 'var(--text-faint)', marginTop: 2 }} />
        <div className="flex-1 min-w-0">
          <h3 className="text-[13.5px] font-semibold" style={{ color: 'var(--text)' }}>Posts that are not earning their place</h3>
          {data.note && (
            <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: 'var(--text-soft)' }}>{data.note}</p>
          )}
        </div>
      </div>

      {/* Publishing rate. Only ever shown when it is actually worth raising:
          lib/publish-velocity.ts returns null for anyone doing fine, so a
          creator working hard on a site that IS indexing never sees a lecture. */}
      {data.velocity?.note && (
        <div className="mt-3 rounded-xl p-3 flex items-start gap-2" style={{ background: 'var(--surface-2)' }}>
          <Gauge size={14} style={{ color: 'var(--text-faint)', marginTop: 2, flexShrink: 0 }} />
          <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{data.velocity.note}</p>
        </div>
      )}

      {data.groups.length > 0 && (
        <div className="mt-3">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-faint)' }}>
            Same subject, more than once
          </p>
          <p className="text-[12px] mb-2 leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            These cover the same product and none of them is being shown. Keeping the best one, folding
            the others into it, and redirecting their URLs to it gives Google one page to rank instead
            of several it has already passed over.
          </p>
          <div className="flex flex-col gap-1.5">
            {data.groups.slice(0, 6).map(g => (
              <div key={g.key} className="rounded-lg px-2.5 py-2 text-[12px]" style={{ background: 'var(--surface-2)', color: 'var(--text-soft)' }}>
                {g.titles.map((t, i) => (
                  <div key={i} className="truncate">{t}</div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {shown.length > 0 && (
        <div className="mt-3">
          <div className="flex flex-col gap-1">
            {shown.map(c => (
              <div key={c.id} className="rounded-lg px-2.5 py-2" style={{ background: 'var(--surface-2)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide flex-shrink-0" style={{ color: weaknessTone[c.weakness] }}>
                    {weaknessLabel[c.weakness]}
                  </span>
                  <span className="text-[12.5px] truncate flex-1" style={{ color: 'var(--text)' }}>{c.title}</span>
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>
                <p className="text-[11.5px] mt-1 leading-relaxed" style={{ color: 'var(--text-soft)' }}>{c.reason}</p>
              </div>
            ))}
          </div>
          {data.candidates.length > shown.length && (
            <button onClick={() => setExpanded(true)} className="text-[12px] mt-2 underline" style={{ color: 'var(--text-soft)' }}>
              Show the other {data.candidates.length - shown.length}
            </button>
          )}
        </div>
      )}

      {/* Said out loud rather than implied by an empty list, because a panel that
          shows nothing looks identical to a panel that is broken. */}
      <p className="text-[11px] mt-3 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        MVP does not change any of these for you. Merging and redirecting are yours to do on your own
        site, and undoing them is not always simple.
        {data.tooYoung > 0 && ` ${data.tooYoung.toLocaleString()} newer ${data.tooYoung === 1 ? 'post was' : 'posts were'} left out entirely: too soon to tell.`}
        {data.working > 0 && ` ${data.working.toLocaleString()} ${data.working === 1 ? 'post is' : 'posts are'} getting clicks and were never considered.`}
      </p>
    </div>
  )
}
