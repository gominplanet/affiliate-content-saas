// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Revenue-opportunity worklist (Phase 2 — close the revenue loop). Renders the
// ranked output of GET /api/seo/opportunities: each published post classified
// into ONE action (rebuild, fix title, submit to Google, strengthen CTA…) by
// joining Search Console rank/impressions/CTR with Geniuslink click-out.
//
// Self-contained on purpose — fetches its own data so the host page only needs
// `<OpportunitiesPanel />`. Lives at the top of /seo, above the per-post list.

'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { RefreshCw, ArrowUpRight, ExternalLink } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'

type Kind =
  | 'not_indexed' | 'striking_distance' | 'low_ctr'
  | 'ranks_but_no_clickout' | 'winner' | 'low_volume' | 'no_data'

interface Opportunity {
  kind: Kind
  priority: number
  action: string
  reason: string
  cta: 'index' | 'rebuild' | 'improve_title' | 'strengthen_cta' | 'scale' | 'none'
}
interface Row {
  postId: string
  title: string
  url: string
  metrics: {
    position: number | null
    impressions: number
    searchClicks: number
    ctr: number
    affiliateClicks: number | null
  }
  opportunity: Opportunity
}
interface ApiResponse {
  connected: boolean
  geniuslink?: boolean
  reason?: string
  message?: string
  window?: { startDate: string; endDate: string }
  summary: { total: number; byKind: Partial<Record<Kind, number>> }
  posts: Row[]
}

const KIND_META: Record<Kind, { label: string; cls: string }> = {
  not_indexed:           { label: 'Not indexed',       cls: 'text-[#ff3b30] bg-[#ff3b30]/10' },
  striking_distance:     { label: 'Striking distance', cls: 'text-[#b8860b] bg-[#FFC200]/20' },
  low_ctr:               { label: 'Low CTR',           cls: 'text-[#4285F4] bg-[#4285F4]/10' },
  ranks_but_no_clickout: { label: 'Not converting',    cls: 'text-[#7C3AED] bg-[#7C3AED]/10' },
  winner:                { label: 'Winner',            cls: 'text-[#1a7a3c] bg-[#34c759]/12' },
  low_volume:            { label: 'Low demand',        cls: 'text-[var(--text-2)] bg-[var(--surface-2)]' },
  no_data:               { label: '—',                 cls: 'text-[var(--text-2)] bg-[var(--surface-2)]' },
}

function priorityBand(p: number): string {
  if (p >= 80) return 'bg-[#ff3b30]'
  if (p >= 60) return 'bg-[#FFC200]'
  if (p >= 40) return 'bg-[#4285F4]'
  return 'bg-[var(--border-2)]'
}

function metricLine(m: Row['metrics']): string {
  const bits: string[] = []
  if (m.position) bits.push(`pos ${m.position.toFixed(1)}`)
  if (m.impressions) bits.push(`${m.impressions.toLocaleString()} impr`)
  if (m.searchClicks) bits.push(`${m.searchClicks} clicks`)
  if (m.ctr) bits.push(`${(m.ctr * 100).toFixed(1)}% CTR`)
  if (m.affiliateClicks !== null) bits.push(`${m.affiliateClicks} click-out`)
  return bits.join(' · ')
}

export default function OpportunitiesPanel() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [indexing, setIndexing] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/seo/opportunities')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load opportunities')
      setData(json as ApiResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load opportunities')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const submitIndex = useCallback(async (row: Row) => {
    setIndexing(prev => new Set(prev).add(row.postId))
    try {
      const res = await fetch('/api/seo/request-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [row.url] }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Submit failed')
      const outcome = json.results?.[0]?.outcome
      if (outcome === 'quota') toast.error('Google’s daily indexing quota is used up — try again in 24h.')
      else if (outcome === 'forbidden') toast.error('Reconnect Search Console so we can submit this URL.')
      else toast.success('Submitted to Google for re-crawl.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setIndexing(prev => { const n = new Set(prev); n.delete(row.postId); return n })
    }
  }, [])

  // ── Shell (always rendered so the section has a stable home on /seo) ────────
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h2 className="text-base font-semibold text-[var(--text)]">Revenue opportunities</h2>
          <p className="text-xs text-[var(--text-2)] mt-0.5">
            Your posts, ranked by the single highest-leverage fix — from Search Console rankings + affiliate click-out.
            {data?.window && (
              <span className="opacity-70"> Last 28 days.</span>
            )}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={load}
          loading={loading}
          leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
        >
          Refresh
        </Button>
      </div>

      {/* States */}
      {loading && !data ? (
        <div className="py-8 text-center text-sm text-[var(--text-2)]">Analyzing your posts…</div>
      ) : error ? (
        <div className="py-4 text-sm text-[#ff3b30]">{error}</div>
      ) : data && !data.connected ? (
        <div className="py-6 px-4 rounded-lg bg-[#4285F4]/5 border border-[#4285F4]/20 text-sm text-[var(--text-2)]">
          {data.message || 'Connect Google Search Console to unlock the opportunity worklist.'}
        </div>
      ) : data && data.posts.length === 0 ? (
        <div className="py-6 text-center text-sm text-[var(--text-2)]">
          ✓ Nothing needs attention right now. Posts will surface here as they gather Search Console data.
        </div>
      ) : data ? (
        <>
          {/* Summary chips */}
          <div className="flex flex-wrap gap-1.5 mt-3 mb-4">
            {(Object.entries(data.summary.byKind) as Array<[Kind, number]>)
              .filter(([k]) => k !== 'no_data' && k !== 'low_volume')
              .sort((a, b) => b[1] - a[1])
              .map(([kind, count]) => (
                <span key={kind} className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${KIND_META[kind].cls}`}>
                  {count} {KIND_META[kind].label.toLowerCase()}
                </span>
              ))}
          </div>

          {/* Worklist */}
          <div className="flex flex-col divide-y divide-[var(--border)]">
            {data.posts.map(row => {
              const meta = KIND_META[row.opportunity.kind]
              return (
                <div key={row.postId} className="flex items-start gap-3 py-3 first:pt-0">
                  {/* priority rail */}
                  <div className="flex flex-col items-center pt-1 w-7 shrink-0" title={`Priority ${row.opportunity.priority}/100`}>
                    <div className={`h-8 w-1.5 rounded-full ${priorityBand(row.opportunity.priority)}`} />
                  </div>

                  {/* body */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-[var(--text)] hover:underline truncate max-w-[42ch] inline-flex items-center gap-1"
                      >
                        {row.title || 'Untitled post'}
                        <ExternalLink className="h-3 w-3 opacity-50 shrink-0" />
                      </a>
                    </div>
                    <p className="text-[13px] font-medium text-[var(--text)] mt-1">{row.opportunity.action}</p>
                    <p className="text-xs text-[var(--text-2)] mt-0.5">{row.opportunity.reason}</p>
                    <p className="text-[11px] text-[var(--text-2)] opacity-70 mt-1 font-mono">{metricLine(row.metrics)}</p>
                  </div>

                  {/* CTA */}
                  <div className="shrink-0 pt-0.5">
                    {row.opportunity.cta === 'index' ? (
                      <Button
                        variant="primary"
                        size="sm"
                        loading={indexing.has(row.postId)}
                        onClick={() => submitIndex(row)}
                      >
                        Submit to Google
                      </Button>
                    ) : row.opportunity.cta === 'improve_title' ? (
                      <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href="/tools/title-audit">
                        Fix title <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    ) : row.opportunity.cta === 'none' ? null : (
                      <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href="/content">
                        Open in Library <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}
