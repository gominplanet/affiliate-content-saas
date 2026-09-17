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
  /** How many exist in each pile, before the API trimmed what it sends. */
  totalCandidates?: number
  totalQuickWins?: number
  totalMergeCandidates?: number
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
  const [expandWins, setExpandWins] = useState(false)
  const [expandMerge, setExpandMerge] = useState(false)

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

  const wins = expandWins ? (data.quickWins ?? []) : (data.quickWins ?? []).slice(0, 8)
  const merges = expandMerge ? (data.mergeCandidates ?? []) : (data.mergeCandidates ?? []).slice(0, 8)

  // One row, used by both piles. The weakness tone is what keeps a ranking post
  // from reading like a dead one.
  const row = (c: Payload['candidates'][number]) => (
    <div key={c.id} className="rounded-lg px-2.5 py-2" style={{ background: 'var(--surface-2)' }}>
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide flex-shrink-0" style={{ color: weaknessTone[c.weakness] }}>
          {weaknessLabel[c.weakness]}
        </span>
        <span className="text-[12.5px] truncate flex-1" style={{ color: 'var(--text)' }}>{c.title}</span>
        {c.impressions > 0 && (
          <span className="text-[11px] flex-shrink-0 tabular-nums" style={{ color: 'var(--text-faint)' }}>
            {c.impressions.toLocaleString()} shown
          </span>
        )}
        {c.url && (
          <a href={c.url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
            <ExternalLink size={11} />
          </a>
        )}
      </div>
      <p className="text-[11.5px] mt-1 leading-relaxed" style={{ color: 'var(--text-soft)' }}>{c.reason}</p>
    </div>
  )

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

      {/* The quick wins come FIRST, and most-shown first within them. Google is
          already putting these in front of people. Nothing here needs merging,
          redirecting or undoing, which is what makes it the place to start. */}
      {wins.length > 0 && (
        <div className="mt-4">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#1c7a35' }}>
            Start here: rewrite the title
          </p>
          <p className="text-[12px] mb-2 leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            Google is already showing {(data.totalQuickWins ?? wins.length).toLocaleString()} of your posts and
            nobody is clicking them. That is the title and the description people read in the results, not a
            ranking problem, so it is the fastest thing on this page to fix and there is nothing to undo.
            Most-shown first, because that is where a rewrite is worth the most.
          </p>
          <div className="flex flex-col gap-1">{wins.map(row)}</div>
          {(data.quickWins ?? []).length > wins.length && (
            <button onClick={() => setExpandWins(true)} className="text-[12px] mt-2 underline" style={{ color: 'var(--text-soft)' }}>
              Show the other {(data.quickWins ?? []).length - wins.length}
            </button>
          )}
          {data.totalQuickWins != null && data.totalQuickWins > (data.quickWins ?? []).length && (
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
              Showing the {(data.quickWins ?? []).length} most-shown of {data.totalQuickWins.toLocaleString()}.
            </p>
          )}
        </div>
      )}

      {data.groups.length > 0 && (
        <div className="mt-4">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-faint)' }}>
            Same subject, more than once
          </p>
          <p className="text-[12px] mb-2 leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            These look like they cover the same product, and none of them is being shown. Read each pair
            before you act: the grouping is done on how rare the shared words are in your own titles, which
            is a good signal and not a certainty. Where they really are the same thing, keeping the best one,
            folding the others into it, and redirecting their URLs gives Google one page to rank instead of
            several it has already passed over.
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

      {merges.length > 0 && (
        <div className="mt-4">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-faint)' }}>
            Then: merge or drop
          </p>
          <p className="text-[12px] mb-2 leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            Google has never shown these to anyone. Slower and riskier than a title rewrite, and the payoff
            is concentrating authority rather than winning clicks, so do the list above first.
          </p>
          <div className="flex flex-col gap-1">{merges.map(row)}</div>
          {(data.mergeCandidates ?? []).length > merges.length && (
            <button onClick={() => setExpandMerge(true)} className="text-[12px] mt-2 underline" style={{ color: 'var(--text-soft)' }}>
              Show the other {(data.mergeCandidates ?? []).length - merges.length}
            </button>
          )}
          {data.totalMergeCandidates != null && data.totalMergeCandidates > (data.mergeCandidates ?? []).length && (
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
              Showing the {(data.mergeCandidates ?? []).length} weakest of {data.totalMergeCandidates.toLocaleString()}. Work
              through these and the rest will be a shorter list next time.
            </p>
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
