'use client'

/**
 * SEO & Indexing hub. Shows every published post's SEO/AEO score and — when
 * Google Search Console is connected — whether Google has indexed it, plus its
 * clicks / impressions / position. Sorted worst-score-first by default so the
 * creator fixes the highest-impact posts. Expand a row to see exactly what's
 * missing (and, soon, one-click fixes).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { Gauge, Loader2, RefreshCw, ExternalLink, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'

interface Check { id: string; label: string; pass: boolean; weight: number; hint?: string }
interface PostRow {
  postId: string; title: string; slug: string; url: string | null
  score: number; checks: Check[]
  indexed: boolean | null; coverageState: string | null
  clicks: number; impressions: number; position: number | null; ctr: number | null
}
interface Overview {
  connected: boolean; property: string | null
  summary: { total: number; avgScore: number; indexed: number; notIndexed: number; unknown: number; totalClicks: number; totalImpressions: number }
  posts: PostRow[]
}

const scoreColor = (s: number) => (s >= 80 ? '#34c759' : s >= 60 ? '#ff9500' : '#ff3b30')

export default function SeoPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sort, setSort] = useState<'score' | 'clicks' | 'impressions'>('score')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/seo/overview')
      const d = await res.json()
      if (d.error) setError(d.error)
      else setData(d as Overview)
    } catch { setError('Couldn’t load SEO data.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const posts = useMemo(() => {
    const p = data?.posts ? [...data.posts] : []
    if (sort === 'score') p.sort((a, b) => a.score - b.score)        // worst first → fix these
    else if (sort === 'clicks') p.sort((a, b) => b.clicks - a.clicks)
    else p.sort((a, b) => b.impressions - a.impressions)
    return p
  }, [data, sort])

  return (
    <>
      <Header
        title="SEO & Indexing"
        subtitle={
          loading ? 'Loading…'
          : data
            ? `${data.summary.total} posts · avg score ${data.summary.avgScore}/100${data.connected ? ` · tracking ${data.property}` : ''}`
            : 'Make sure your posts are indexed and optimized'
        }
        actions={
          <button onClick={load} disabled={loading} className="btn-secondary text-sm">
            {loading ? <><Loader2 size={14} className="animate-spin" /> Refreshing…</> : <><RefreshCw size={14} /> Refresh</>}
          </button>
        }
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#86868b] dark:text-[#8e8e93] py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Scoring your posts…
        </div>
      ) : error ? (
        <div className="card p-5 border border-[#ff3b30]/30 bg-[#ff3b30]/5 text-sm text-[#ff3b30]">{error}</div>
      ) : !data ? null : (
        <div className="flex flex-col gap-4">
          {/* Connect-GSC prompt when not connected — scores still work without it */}
          {!data.connected && (
            <div className="card p-5 border border-[#4285F4]/25 bg-[#4285F4]/5 flex items-start gap-4">
              <Gauge size={18} className="text-[#4285F4] mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Connect Google Search Console for indexing + traffic data</p>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3 leading-relaxed">
                  Your SEO scores below are live. Connect Search Console (read-only) to also see whether Google has indexed each post, its ranking, and the searches people use to find it.
                </p>
                <Link href="/setup?tab=integrations" className="inline-flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-[#4285F4] hover:opacity-90 transition-opacity">
                  Connect Search Console
                </Link>
              </div>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard label="Avg SEO score" value={`${data.summary.avgScore}/100`} accent={scoreColor(data.summary.avgScore)} />
            {data.connected ? (
              <>
                <SummaryCard label="Indexed" value={`${data.summary.indexed}/${data.summary.total}`} accent="#34c759" sub={data.summary.notIndexed ? `${data.summary.notIndexed} not indexed` : undefined} />
                <SummaryCard label="Clicks (28d)" value={data.summary.totalClicks.toLocaleString()} accent="#0071e3" />
                <SummaryCard label="Impressions (28d)" value={data.summary.totalImpressions.toLocaleString()} accent="#5856d6" />
              </>
            ) : (
              <SummaryCard label="Posts" value={String(data.summary.total)} accent="#0071e3" />
            )}
          </div>

          {/* Sort controls */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#86868b]">Sort by:</span>
            {([['score', 'Lowest score'], ['clicks', 'Most clicks'], ['impressions', 'Most impressions']] as const).map(([k, lbl]) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                disabled={(k !== 'score') && !data.connected}
                className={`px-2.5 py-1 rounded-full border transition-colors ${sort === k ? 'border-[#0071e3] text-[#0071e3] bg-[#0071e3]/5' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:text-[#1d1d1f] disabled:opacity-40'}`}
              >
                {lbl}
              </button>
            ))}
          </div>

          {/* Posts table */}
          <div className="card divide-y divide-gray-100 dark:divide-white/10">
            {posts.length === 0 ? (
              <div className="p-6 text-sm text-[#86868b] text-center">No published posts yet.</div>
            ) : posts.map((p) => {
              const open = expanded === p.postId
              const failing = p.checks.filter(c => !c.pass && c.weight > 0)
              return (
                <div key={p.postId}>
                  <button
                    onClick={() => setExpanded(open ? null : p.postId)}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                  >
                    {open ? <ChevronDown size={14} className="text-[#86868b] flex-shrink-0" /> : <ChevronRight size={14} className="text-[#86868b] flex-shrink-0" />}
                    {/* score donut */}
                    <span className="flex items-center justify-center w-9 h-9 rounded-full text-[11px] font-bold flex-shrink-0" style={{ color: scoreColor(p.score), background: `${scoreColor(p.score)}1a` }}>
                      {p.score}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{p.title}</span>
                      <span className="block text-[11px] text-[#86868b] truncate">{failing.length === 0 ? 'All checks pass' : `${failing.length} fix${failing.length !== 1 ? 'es' : ''} suggested`}</span>
                    </span>
                    {data.connected && <IndexBadge indexed={p.indexed} coverage={p.coverageState} />}
                    {data.connected && (
                      <span className="hidden sm:flex flex-col items-end w-20 flex-shrink-0">
                        <span className="text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{p.clicks} clicks</span>
                        <span className="text-[11px] text-[#86868b]">{p.position ? `pos ${p.position.toFixed(1)}` : `${p.impressions} impr`}</span>
                      </span>
                    )}
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[#86868b] hover:text-[#0071e3] flex-shrink-0" title="Open post">
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </button>
                  {open && (
                    <div className="px-4 pb-4 pl-12">
                      <ul className="flex flex-col gap-1.5">
                        {p.checks.filter(c => c.weight > 0).map(c => (
                          <li key={c.id} className="flex items-start gap-2 text-xs">
                            {c.pass
                              ? <CheckCircle2 size={13} className="text-[#34c759] mt-0.5 flex-shrink-0" />
                              : <XCircle size={13} className="text-[#ff3b30] mt-0.5 flex-shrink-0" />}
                            <span className={c.pass ? 'text-[#6e6e73] dark:text-[#8e8e93]' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'}>
                              {c.label}
                              {!c.pass && c.hint && <span className="block text-[11px] text-[#86868b] mt-0.5">{c.hint}</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {data.connected && p.coverageState && (
                        <p className="text-[11px] text-[#86868b] mt-3">Google: {p.coverageState}</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

function SummaryCard({ label, value, accent, sub }: { label: string; value: string; accent: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mb-1">{label}</p>
      <p className="text-2xl font-bold" style={{ color: accent }}>{value}</p>
      {sub && <p className="text-[11px] text-[#ff9500] mt-0.5">{sub}</p>}
    </div>
  )
}

function IndexBadge({ indexed, coverage }: { indexed: boolean | null; coverage: string | null }) {
  if (indexed === true) return <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-[#34c759] flex-shrink-0"><CheckCircle2 size={12} /> Indexed</span>
  if (indexed === false) return <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-[#ff3b30] flex-shrink-0" title={coverage || undefined}><XCircle size={12} /> Not indexed</span>
  return <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-[#86868b] flex-shrink-0"><AlertCircle size={12} /> Unknown</span>
}
