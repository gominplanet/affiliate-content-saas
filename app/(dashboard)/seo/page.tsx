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
import { Gauge, Loader2, RefreshCw, ExternalLink, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight, Wand2, X, Zap } from 'lucide-react'

interface Check { id: string; label: string; pass: boolean; weight: number; hint?: string }
interface PostRow {
  postId: string; title: string; slug: string; url: string | null
  score: number; checks: Check[]
  indexed: boolean | null; coverageState: string | null
  inSitemap: boolean | null
  clicks: number; impressions: number; position: number | null; ctr: number | null
}
interface Overview {
  connected: boolean; property: string | null
  summary: { total: number; avgScore: number; indexed: number; notIndexed: number; unknown: number; notInSitemap: number; sitemapFound: boolean; totalClicks: number; totalImpressions: number }
  posts: PostRow[]
}

const scoreColor = (s: number) => (s >= 80 ? '#34c759' : s >= 60 ? '#ff9500' : '#ff3b30')

export default function SeoPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sort, setSort] = useState<'score' | 'clicks' | 'impressions'>('score')
  const [fixing, setFixing] = useState<string | null>(null)   // `${postId}:${fix}`
  const [fixMsg, setFixMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pinging, setPinging] = useState(false)

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

  const runFix = useCallback(async (postId: string, fix: 'internal_links' | 'faq') => {
    setFixing(`${postId}:${fix}`); setFixMsg(null)
    try {
      const res = await fetch('/api/seo/fix', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, fix }),
      })
      const d = await res.json()
      if (d.error) setFixMsg({ ok: false, text: d.error })
      else { setFixMsg({ ok: true, text: `Fixed — re-scored to ${d.score}/100 and republished.` }); await load() }
    } catch { setFixMsg({ ok: false, text: 'Something went wrong.' }) }
    finally { setFixing(null) }
  }, [load])

  const pingIndexNow = useCallback(async () => {
    setPinging(true); setFixMsg(null)
    try {
      const res = await fetch('/api/seo/indexnow', { method: 'POST' })
      const d = await res.json()
      if (d.error) setFixMsg({ ok: false, text: d.error })
      else setFixMsg({ ok: true, text: `Pushed ${d.submitted} URL${d.submitted !== 1 ? 's' : ''} to Bing/Copilot via IndexNow. Re-save any missing post in WordPress to refresh Google's sitemap.` })
    } catch { setFixMsg({ ok: false, text: 'Something went wrong.' }) }
    finally { setPinging(false) }
  }, [])

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
          {fixMsg && (
            <div className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg text-sm ${fixMsg.ok ? 'bg-[#34c759]/10 text-[#1d1d1f] dark:text-[#f5f5f7] border border-[#34c759]/30' : 'bg-[#ff3b30]/5 text-[#ff3b30] border border-[#ff3b30]/30'}`}>
              <span>{fixMsg.text}</span>
              <button onClick={() => setFixMsg(null)} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] flex-shrink-0"><X size={14} /></button>
            </div>
          )}
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

          {/* Missing-from-sitemap warning — Google can't discover what isn't there */}
          {data.summary.sitemapFound && data.summary.notInSitemap > 0 && (
            <div className="card p-4 border border-[#ff9500]/30 bg-[#ff9500]/5 flex items-start gap-3">
              <AlertCircle size={16} className="text-[#ff9500] mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">
                  {data.summary.notInSitemap} post{data.summary.notInSitemap !== 1 ? 's' : ''} missing from your sitemap
                </p>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-2 leading-relaxed">
                  Google discovers pages through your sitemap — posts not in it can sit unindexed (often a stale sitemap cache). Push them straight to Bing/Copilot now, and re-save the post in WordPress to refresh the sitemap for Google.
                </p>
                <button
                  onClick={pingIndexNow}
                  disabled={pinging}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-[#ff9500] hover:opacity-90 disabled:opacity-60 transition-opacity"
                >
                  {pinging ? <><Loader2 size={12} className="animate-spin" /> Pinging…</> : <><Zap size={12} /> Ping search engines (IndexNow)</>}
                </button>
              </div>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard label="Avg SEO score" value={`${data.summary.avgScore}/100`} accent={scoreColor(data.summary.avgScore)} />
            {data.connected ? (
              <>
                <SummaryCard
                  label="Indexed by Google"
                  value={String(data.summary.indexed)}
                  accent="#34c759"
                  sub={[
                    data.summary.notIndexed ? `${data.summary.notIndexed} not indexed` : null,
                    data.summary.unknown ? `${data.summary.unknown} still checking` : null,
                  ].filter(Boolean).join(' · ') || undefined}
                />
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
                    {p.inSitemap === false && (
                      <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-[#ff9500] flex-shrink-0" title="Not in your sitemap — Google may not discover it">
                        <AlertCircle size={12} /> No sitemap
                      </span>
                    )}
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
                        {p.checks.filter(c => c.weight > 0).map(c => {
                          const fixable = !c.pass && (c.id === 'internal_links' || c.id === 'faq')
                          const key = `${p.postId}:${c.id}`
                          return (
                            <li key={c.id} className="flex items-start gap-2 text-xs">
                              {c.pass
                                ? <CheckCircle2 size={13} className="text-[#34c759] mt-0.5 flex-shrink-0" />
                                : <XCircle size={13} className="text-[#ff3b30] mt-0.5 flex-shrink-0" />}
                              <span className={`flex-1 ${c.pass ? 'text-[#6e6e73] dark:text-[#8e8e93]' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'}`}>
                                {c.label}
                                {!c.pass && c.hint && <span className="block text-[11px] text-[#86868b] mt-0.5">{c.hint}</span>}
                              </span>
                              {fixable && (
                                <button
                                  onClick={() => runFix(p.postId, c.id as 'internal_links' | 'faq')}
                                  disabled={fixing === key}
                                  className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-60 transition-colors"
                                >
                                  {fixing === key ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />} Fix
                                </button>
                              )}
                            </li>
                          )
                        })}
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
