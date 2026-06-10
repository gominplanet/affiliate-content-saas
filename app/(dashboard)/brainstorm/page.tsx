/**
 * /brainstorm — Phase 1 of the Brainstorm feature.
 *
 * Reads a 90-day performance snapshot from /api/brainstorm/performance
 * and renders three sections:
 *   1. What's working — top YouTube videos + top blog posts side-by-side
 *   2. Niche performance — covered niches ranked by clicks, plus
 *      uncovered niches the user claims on their brand profile but
 *      hasn't published for in 90 days
 *   3. Brainstorm with the Help Desk — single-shot prompt that ingests
 *      the snapshot as context and streams 5-10 video/post ideas back
 *      inline, using the same MessageMarkdown renderer the assistant
 *      page uses (so paths in the suggestions are clickable Next links)
 *
 * Auth-gated by the dashboard layout. Empty-state friendly — every
 * section degrades to a "connect this" or "no data yet" card when its
 * source is missing.
 */

'use client'

import { useEffect, useState } from 'react'
import { Lightbulb, Youtube, FileText, Loader2, Sparkles, ExternalLink, AlertCircle } from 'lucide-react'
import PageHero from '@/components/layout/PageHero'
import { MessageMarkdown } from '@/components/assistant/MessageMarkdown'

interface YouTubeVideo {
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  published_at: string | null
  view_count: number | null
  duration_seconds: number | null
  is_vertical: boolean | null
}

interface BlogPost {
  id: string
  title: string
  asin: string | null
  niches: string[] | null
  post_type: string | null
  permalink: string | null
  published_at: string | null
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface NichePerf {
  niche: string
  postCount: number
  totalClicks: number
  totalImpressions: number
  avgCtr: number
}

interface PerformanceReport {
  window: '90d'
  generatedAt: string
  youtube: { total: number; avgViews: number; top: YouTubeVideo[]; bottom: YouTubeVideo[] }
  blog: { total: number; gscConnected: boolean; top: BlogPost[]; bottom: BlogPost[] }
  niches: { covered: NichePerf[]; uncovered: string[] }
}

/** Pretty-print a number with thousands separators (no decimals). */
function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US')
}

/** Format CTR as a percent string with one decimal. */
function fmtCtr(ctr: number): string {
  return `${(ctr * 100).toFixed(1)}%`
}

/** Distill the performance report into a compact text block that fits
 *  in an assistant chat message. Top 5 only per section, keys + numbers
 *  only — the assistant doesn't need URLs or IDs to brainstorm. */
function buildBrainstormPrompt(report: PerformanceReport): string {
  const lines: string[] = []
  lines.push('Here\'s a snapshot of how my content has performed over the last 90 days:')
  lines.push('')
  if (report.youtube.top.length > 0) {
    lines.push(`YOUTUBE — ${report.youtube.total} videos in window, avg ${fmt(report.youtube.avgViews)} views.`)
    lines.push('Top videos by views:')
    for (const v of report.youtube.top) {
      lines.push(`  • "${v.title}" — ${fmt(v.view_count)} views${v.is_vertical ? ' [Short]' : ''}`)
    }
    if (report.youtube.bottom.length > 0) {
      lines.push('Underperformers (matured, lowest views):')
      for (const v of report.youtube.bottom) {
        lines.push(`  • "${v.title}" — ${fmt(v.view_count)} views`)
      }
    }
    lines.push('')
  }
  if (report.blog.top.length > 0) {
    lines.push(`BLOG — ${report.blog.total} posts in window${report.blog.gscConnected ? ' (Search Console connected)' : ' (Search Console NOT connected — clicks/impressions all 0)'}.`)
    lines.push('Top posts by clicks:')
    for (const p of report.blog.top) {
      lines.push(`  • "${p.title}" — ${fmt(p.clicks)} clicks / ${fmt(p.impressions)} impressions / ${fmtCtr(p.ctr)} CTR / pos ${p.position.toFixed(1)}${p.niches && p.niches.length > 0 ? ` [${p.niches.join(', ')}]` : ''}`)
    }
    if (report.blog.bottom.length > 0) {
      lines.push('Lowest-CTR posts (had impressions but weren\'t clicked):')
      for (const p of report.blog.bottom) {
        lines.push(`  • "${p.title}" — ${fmt(p.impressions)} impressions / ${fmtCtr(p.ctr)} CTR / pos ${p.position.toFixed(1)}`)
      }
    }
    lines.push('')
  }
  if (report.niches.covered.length > 0) {
    lines.push('Niches I\'ve covered (ranked by clicks):')
    for (const n of report.niches.covered) {
      lines.push(`  • ${n.niche} — ${n.postCount} posts, ${fmt(n.totalClicks)} clicks, ${fmtCtr(n.avgCtr)} CTR`)
    }
  }
  if (report.niches.uncovered.length > 0) {
    lines.push('')
    lines.push(`Niches my brand profile says I cover but I haven't published for in 90 days: ${report.niches.uncovered.join(', ')}`)
  }
  lines.push('')
  lines.push('Based on this, suggest 5-7 specific next videos or blog posts I should make. For each: title, format (review / comparison / buying guide / deal), why it fits my audience based on the data above, and an estimate of how many words / minutes. Prioritize ideas that build on what\'s ALREADY working rather than untested new directions.')
  return lines.join('\n')
}

export default function BrainstormPage() {
  const [report, setReport] = useState<PerformanceReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Inline brainstorm chat state — feeds the curated prompt to the
  // assistant chat API and streams the reply right into the page.
  // Stays scoped to this single conversation per page mount; reloads
  // wipe it (the page is meant for one focused brainstorm at a time).
  const [brainstorming, setBrainstorming] = useState(false)
  const [brainstormText, setBrainstormText] = useState('')
  const [brainstormError, setBrainstormError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/brainstorm/performance')
        const d = await r.json()
        if (cancelled) return
        if (!r.ok) {
          setError(d.error || 'Failed to load performance data.')
        } else {
          setReport(d)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load performance data.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function runBrainstorm() {
    if (!report) return
    setBrainstorming(true)
    setBrainstormError(null)
    setBrainstormText('')
    try {
      const prompt = buildBrainstormPrompt(report)
      // Stream the assistant reply token-by-token. Same /api/assistant/chat
      // endpoint the Help Desk uses — the brainstorm message goes into the
      // user's regular chat history so they can follow up there.
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt }),
      })
      if (!res.ok || !res.body) {
        // 429 = assistant cap hit. Surface a useful message rather than
        // generic "failed".
        if (res.status === 429) {
          const j = await res.json().catch(() => ({}))
          setBrainstormError(j.error || 'You\'ve used up your assistant messages for this period.')
        } else {
          const j = await res.json().catch(() => ({}))
          setBrainstormError(j.error || 'Brainstorm failed.')
        }
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setBrainstormText(prev => prev + decoder.decode(value))
      }
    } catch (e) {
      setBrainstormError(e instanceof Error ? e.message : 'Brainstorm failed.')
    } finally {
      setBrainstorming(false)
    }
  }

  return (
    <>
      <PageHero
        title="Brainstorm"
        subtitle="What's actually working over the last 90 days — and what to make next based on the data."
      />

      {loading && (
        <div className="flex items-center gap-2 text-sm text-[#86868b] dark:text-[#8e8e93]">
          <Loader2 size={14} className="animate-spin" /> Crunching your last 90 days…
        </div>
      )}

      {error && (
        <div className="card p-4 mb-4 border border-[#ff3b30]/20 bg-[#ff3b30]/5">
          <p className="text-sm text-[#ff3b30]"><AlertCircle size={14} className="inline mr-1" />{error}</p>
        </div>
      )}

      {report && (
        <div className="flex flex-col gap-5 max-w-5xl">
          {/* ── Brainstorm CTA at the top — the action, not the data ───── */}
          <div className="card p-5 border border-[#7C3AED]/20 bg-gradient-to-br from-[#7C3AED]/[0.08] to-[#7C3AED]/[0.02]">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-[#7C3AED]/15 flex items-center justify-center flex-shrink-0">
                <Lightbulb size={20} className="text-[#7C3AED]" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Brainstorm what to make next</p>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
                  The MVP Help Desk will look at every section below — your top + bottom YouTube videos, top + low-CTR posts, niche performance, brand profile coverage gaps — and suggest 5-7 specific next videos or posts grounded in what&apos;s working.
                </p>
              </div>
            </div>
            <button
              onClick={() => void runBrainstorm()}
              disabled={brainstorming}
              className="btn-primary text-sm self-start"
            >
              {brainstorming
                ? <><Loader2 size={14} className="animate-spin" /> Brainstorming…</>
                : <><Sparkles size={14} /> Generate ideas based on my data</>
              }
            </button>
            {brainstormError && (
              <p className="mt-3 text-xs text-[#ff3b30]"><AlertCircle size={11} className="inline mr-1" />{brainstormError}</p>
            )}
            {brainstormText && (
              <div className="mt-4 p-4 rounded-xl bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-sm leading-relaxed">
                <MessageMarkdown content={brainstormText} />
              </div>
            )}
          </div>

          {/* ── YouTube — top + bottom ─────────────────────────────────── */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Youtube size={16} className="text-[#FF0000]" />
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">YouTube — last 90 days</p>
              <span className="ml-auto text-xs text-[#86868b] dark:text-[#8e8e93]">{report.youtube.total} videos · avg {fmt(report.youtube.avgViews)} views</span>
            </div>
            {report.youtube.top.length === 0 ? (
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">
                No videos synced yet for this window. <a href="/co-pilot" className="text-[#7C3AED] hover:underline">Sync your channel</a> first.
              </p>
            ) : (
              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] mb-2">Top performers</p>
                  <ul className="flex flex-col gap-2">
                    {report.youtube.top.map(v => (
                      <li key={v.youtube_video_id} className="flex items-center gap-3 text-xs">
                        {v.thumbnail_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={v.thumbnail_url} alt="" className="w-14 h-8 rounded object-cover flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{v.title}</p>
                          <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">{fmt(v.view_count)} views{v.is_vertical ? ' · Short' : ''}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                {report.youtube.bottom.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] mb-2">Underperformers (matured)</p>
                    <ul className="flex flex-col gap-2">
                      {report.youtube.bottom.map(v => (
                        <li key={v.youtube_video_id} className="flex items-center gap-3 text-xs">
                          {v.thumbnail_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={v.thumbnail_url} alt="" className="w-14 h-8 rounded object-cover flex-shrink-0 opacity-60" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{v.title}</p>
                            <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">{fmt(v.view_count)} views</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Blog posts — top + low-CTR ──────────────────────────────── */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <FileText size={16} className="text-[#7C3AED]" />
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Blog posts — last 90 days</p>
              <span className="ml-auto text-xs text-[#86868b] dark:text-[#8e8e93]">{report.blog.total} posts</span>
            </div>
            {!report.blog.gscConnected && report.blog.top.length > 0 && (
              <div className="rounded-lg border border-[#ff9500]/30 bg-[#ff9500]/[0.06] px-3 py-2 mb-3 text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                Google Search Console isn&apos;t connected — clicks + impressions show as 0. <a href="/seo" className="text-[#7C3AED] hover:underline font-medium">Connect GSC</a> to see what&apos;s actually pulling traffic.
              </div>
            )}
            {report.blog.top.length === 0 ? (
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">
                No published blog posts in this window yet. Run a generation in <a href="/co-pilot" className="text-[#7C3AED] hover:underline">YouTube Co-Pilot</a> or paste a deal in <a href="/deals" className="text-[#7C3AED] hover:underline">Deals Hub</a>.
              </p>
            ) : (
              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] mb-2">Top by clicks</p>
                  <ul className="flex flex-col gap-2">
                    {report.blog.top.map(p => (
                      <li key={p.id} className="text-xs">
                        <div className="flex items-baseline gap-2">
                          <p className="text-[#1d1d1f] dark:text-[#f5f5f7] flex-1 truncate">{p.title}</p>
                          {p.permalink && <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline flex-shrink-0"><ExternalLink size={10} /></a>}
                        </div>
                        <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">
                          {fmt(p.clicks)} clicks · {fmt(p.impressions)} impressions · {fmtCtr(p.ctr)} CTR · pos {p.position.toFixed(1)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
                {report.blog.bottom.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] mb-2">Low CTR (had impressions, no clicks)</p>
                    <ul className="flex flex-col gap-2">
                      {report.blog.bottom.map(p => (
                        <li key={p.id} className="text-xs">
                          <div className="flex items-baseline gap-2">
                            <p className="text-[#1d1d1f] dark:text-[#f5f5f7] flex-1 truncate">{p.title}</p>
                            {p.permalink && <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline flex-shrink-0"><ExternalLink size={10} /></a>}
                          </div>
                          <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">
                            {fmt(p.impressions)} impressions · {fmtCtr(p.ctr)} CTR · pos {p.position.toFixed(1)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Niche performance ──────────────────────────────────────── */}
          {(report.niches.covered.length > 0 || report.niches.uncovered.length > 0) && (
            <div className="card p-5">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Niche performance</p>
              {report.niches.covered.length > 0 && (
                <div className="mb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] mb-2">Covered niches (sorted by clicks)</p>
                  <div className="flex flex-col gap-2">
                    {report.niches.covered.map(n => {
                      const maxClicks = report.niches.covered[0]?.totalClicks || 1
                      const widthPct = Math.max(2, (n.totalClicks / maxClicks) * 100)
                      return (
                        <div key={n.niche} className="text-xs">
                          <div className="flex items-baseline justify-between mb-1">
                            <span className="text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">{n.niche}</span>
                            <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">{n.postCount} posts · {fmt(n.totalClicks)} clicks · {fmtCtr(n.avgCtr)} CTR</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/5">
                            <div className="h-full rounded-full bg-[#7C3AED]" style={{ width: `${widthPct}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {report.niches.uncovered.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] mb-2">Coverage gaps (claimed on Brand Profile but no posts in window)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {report.niches.uncovered.map(n => (
                      <span key={n} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ff9500]/10 text-[#ff9500] border border-[#ff9500]/20">
                        {n}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-2">
                    You list these on your <a href="/brand" className="text-[#7C3AED] hover:underline">Brand Profile</a> but haven&apos;t published anything tagged with them in 90 days. The brainstorm above will weigh these as untested-direction options.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
