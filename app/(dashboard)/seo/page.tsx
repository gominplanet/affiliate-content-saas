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
  /** Set when the nightly cron saw this post flip indexed → not_indexed; cleared
   *  when it comes back. Used for the "Recently dropped" alert on the SEO page. */
  droppedAt: string | null
  clicks: number; impressions: number; position: number | null; ctr: number | null
}
interface Overview {
  connected: boolean; property: string | null
  summary: { total: number; avgScore: number; indexed: number; notIndexed: number; unknown: number; notInSitemap: number; recentlyDropped: number; sitemapFound: boolean; totalClicks: number; totalImpressions: number }
  posts: PostRow[]
}

const scoreColor = (s: number) => (s >= 80 ? '#34c759' : s >= 60 ? '#ff9500' : '#ff3b30')

// Google Search Console deep links expect LITERAL ':' and '/' in resource_id
// and id. encodeURIComponent turns them into %3A / %2F, which makes GSC return
// a 404. Encode everything else (spaces, &, #, ?) but keep those two literal.
const gscParam = (s: string) => encodeURIComponent(s).replace(/%3A/gi, ':').replace(/%2F/gi, '/')

export default function SeoPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sort, setSort] = useState<'score' | 'clicks' | 'impressions'>('score')
  const [filterNotIndexed, setFilterNotIndexed] = useState(false)  // "Request indexing" worklist
  const [fixing, setFixing] = useState<string | null>(null)   // `${postId}:${fix}`
  const [fixMsg, setFixMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pinging, setPinging] = useState(false)
  const [bulkPreview, setBulkPreview] = useState<{ total: number; toFix: number; totalFixes: number; preview: { postId: string; title: string; fixes: number }[] } | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkApplying, setBulkApplying] = useState(false)
  // Per-row "Check" button — set of postIds currently being rechecked, so we
  // can show a spinner on the right row(s) while the GSC call is in flight.
  const [rechecking, setRechecking] = useState<Set<string>>(new Set())

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

  const runFix = useCallback(async (postId: string, fix: 'internal_links' | 'faq' | 'title_length' | 'image_alt' | 'all') => {
    setFixing(`${postId}:${fix}`); setFixMsg(null)
    try {
      const res = await fetch('/api/seo/fix', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, fix }),
      })
      const d = await res.json()
      if (d.error) { setFixMsg({ ok: false, text: d.error }); return }
      const n = Array.isArray(d.applied) ? d.applied.length : 1
      setFixMsg(n === 0
        ? { ok: true, text: 'Nothing left to auto-fix on this post.' }
        : { ok: true, text: `Applied ${n} fix${n !== 1 ? 'es' : ''} — re-scored to ${d.score}/100 and republished.` })
      await load()
    } catch { setFixMsg({ ok: false, text: 'Something went wrong.' }) }
    finally { setFixing(null) }
  }, [load])

  // "Request indexing" helper. Two paths:
  //
  // 1. GSC connected → deep-link into URL Inspection for the user's specific
  //    GSC property. `?resource_id=…&inspectionUrl=…` opens the property's
  //    inspect tool with the post URL pre-filled. No "Welcome to Search
  //    Console" landing page anymore — that was bouncing users who had
  //    multiple Google accounts OR no property on the active account.
  // 2. GSC NOT connected → fall back to the old behavior (open GSC home,
  //    URL in clipboard), but the toast text now tells them to connect
  //    Search Console on /seo first for one-click deep linking.
  //
  // Google's `?id=<url>` syntax does NOT work — that param expects an
  // internal inspection hash and 404s on real URLs. resource_id +
  // inspectionUrl is the documented combo that does.
  const requestIndexing = useCallback(async (url: string) => {
    try { await navigator.clipboard.writeText(url) } catch { /* clipboard may be blocked */ }
    const property = data?.property || null
    if (property) {
      // resource_id is the GSC property (either "sc-domain:host" or a
      // "https://host/" URL-prefix). encodeURIComponent handles both.
      const deepLink = `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(property)}&inspectionUrl=${encodeURIComponent(url)}`
      window.open(deepLink, '_blank', 'noopener,noreferrer')
      setFixMsg({ ok: true, text: `Opening Search Console URL Inspection for ${url}. (If Google asks you to pick an account, choose the one that owns ${property}, then hit "Request Indexing".)` })
      return
    }
    window.open('https://search.google.com/search-console', '_blank', 'noopener,noreferrer')
    setFixMsg({ ok: true, text: 'Post URL copied. Connect Search Console on this page for one-click deep links — otherwise, paste the URL into the Inspect bar at the top of GSC and click "Request Indexing".' })
  }, [data?.property])

  // Per-row "Check now" — fresh Google URL Inspection on a single post, updates
  // the row in place so the user sees the new status without a full overview
  // reload. The daily cron keeps everything current overnight; this is the
  // "I just clicked Request Indexing — did it land?" lever.
  const recheckIndexing = useCallback(async (postId: string) => {
    setRechecking(prev => { const next = new Set(prev); next.add(postId); return next })
    try {
      const res = await fetch('/api/seo/recheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId }),
      })
      const r = await res.json().catch(() => ({})) as {
        ok?: boolean; indexed?: boolean; coverageState?: string | null; lastCrawl?: string | null; error?: string
      }
      if (!res.ok || !r.ok) {
        setFixMsg({ ok: false, text: r.error || `Recheck failed (${res.status}).` })
        return
      }
      // Patch the single row so the IndexBadge re-renders without a full reload.
      setData(prev => prev ? {
        ...prev,
        posts: prev.posts.map(p => p.postId === postId
          ? { ...p, indexed: r.indexed ?? null, coverageState: r.coverageState ?? null, lastCrawl: r.lastCrawl ?? null }
          : p),
      } : prev)
    } catch {
      setFixMsg({ ok: false, text: 'Recheck failed — try again.' })
    } finally {
      setRechecking(prev => { const next = new Set(prev); next.delete(postId); return next })
    }
  }, [])

  // One click: purge the host sitemap cache (so Google's sitemap is complete)
  // + push URLs to Bing/Copilot via IndexNow + re-check.
  const fixSitemap = useCallback(async () => {
    setPinging(true); setFixMsg(null)
    let purged = false, submitted = 0, err: string | null = null
    try {
      const pr = await fetch('/api/seo/purge-sitemap', { method: 'POST' })
      const pd = await pr.json().catch(() => ({}))
      if (pr.ok) purged = true; else err = pd.error || `Sitemap refresh failed (${pr.status}).`
    } catch { err = 'Sitemap refresh failed.' }
    try {
      const ir = await fetch('/api/seo/indexnow', { method: 'POST' })
      const id = await ir.json().catch(() => ({}))
      if (ir.ok) submitted = id.submitted || 0
    } catch { /* Bing ping is best-effort */ }
    // Give the host a moment to regenerate the just-purged sitemap, then re-check.
    await new Promise(r => setTimeout(r, 2000))
    await load()
    const parts: string[] = []
    if (purged) parts.push('refreshed Google’s sitemap cache')
    if (submitted) parts.push(`pushed ${submitted} URLs to Bing/Copilot`)
    setFixMsg(parts.length
      ? { ok: true, text: `Done — ${parts.join(' + ')}. If any still show missing, give Google a minute and hit Refresh.` }
      : { ok: false, text: err || 'Something went wrong.' })
    setPinging(false)
  }, [load])

  const previewFixAll = useCallback(async () => {
    setBulkLoading(true); setFixMsg(null)
    try {
      const res = await fetch('/api/seo/fix-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun: true }) })
      const d = await res.json()
      if (d.error) setFixMsg({ ok: false, text: d.error })
      else if (!d.toFix) setFixMsg({ ok: true, text: 'Every post is already as good as auto-fixes can make it. 🎉' })
      else setBulkPreview(d)
    } catch { setFixMsg({ ok: false, text: 'Something went wrong.' }) }
    finally { setBulkLoading(false) }
  }, [])

  // Apply across the catalog, auto-continuing through the server's batches.
  const applyFixAll = useCallback(async () => {
    setBulkApplying(true)
    let totalFixed = 0
    // Collected per-post diagnostics for the case where the apply finds nothing
    // to actually change (the confusing "0 fixed" path).
    type Skipped = { title: string; reasons: string[] }
    let lastSkipped: Skipped[] = []
    let lastErrors: string[] = []
    try {
      for (let guard = 0; guard < 20; guard++) {
        const res = await fetch('/api/seo/fix-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
        const d = await res.json() as { error?: string; fixed?: number; remaining?: number; errors?: string[]; skipped?: Skipped[] }
        if (d.error) { setFixMsg({ ok: false, text: d.error }); break }
        totalFixed += d.fixed || 0
        lastSkipped = d.skipped || []
        lastErrors = d.errors || []
        if (!d.remaining || d.fixed === 0) break // done (or no further progress)
        setFixMsg({ ok: true, text: `Fixing posts… ${totalFixed} done, ${d.remaining} to go.` })
      }
      if (totalFixed === 0 && lastErrors.length > 0) {
        // A real error happened on at least one post (not just "nothing to
        // fix, expected"). Red banner.
        const reasonLines = lastSkipped.slice(0, 5).map(s => `• "${s.title}": ${s.reasons.join(' · ')}`)
        const errorLines = lastErrors.slice(0, 3).map(e => `⚠ ${e}`)
        const body = [...errorLines, ...reasonLines].join('\n')
        setFixMsg({
          ok: false,
          text: `Some posts errored during the fix-all run${body ? `:\n${body}` : '.'}`,
        })
      } else if (totalFixed === 0 && lastSkipped.length > 0) {
        // No errors — every "skip" is just "this post is already done"
        // OR "the only remaining issue needs a manual edit (short title)".
        // Green-tinted "good news" banner, not red.
        const manualLines = lastSkipped
          .filter(s => s.reasons.some(r => /manual|edit it manually|edit it yourself/i.test(r)))
          .slice(0, 5)
          .map(s => `• "${s.title}": ${s.reasons.join(' · ')}`)
        const manualBody = manualLines.length
          ? `\n\nA few posts have suggestions that need your hand:\n${manualLines.join('\n')}`
          : ''
        setFixMsg({
          ok: true,
          text: `Every post is already as good as the auto-fixer can make it. 🎉${manualBody}`,
        })
      } else if (totalFixed === 0) {
        // Truly nothing to do — no skips, no errors. Should be rare (the
        // dry-run preview catches this first). Green banner.
        setFixMsg({ ok: true, text: 'Every post is already as good as the auto-fixer can make it. 🎉' })
      } else {
        setFixMsg({ ok: true, text: `Done — fixed ${totalFixed} post${totalFixed !== 1 ? 's' : ''} and republished.` })
      }
      await load()
    } catch { setFixMsg({ ok: false, text: 'Something went wrong.' }) }
    finally { setBulkApplying(false); setBulkPreview(null) }
  }, [load])

  const posts = useMemo(() => {
    let p = data?.posts ? [...data.posts] : []
    if (filterNotIndexed) p = p.filter(x => x.indexed === false)     // Google "not indexed" worklist
    if (sort === 'score') p.sort((a, b) => a.score - b.score)        // worst first → fix these
    else if (sort === 'clicks') p.sort((a, b) => b.clicks - a.clicks)
    else p.sort((a, b) => b.impressions - a.impressions)
    return p
  }, [data, sort, filterNotIndexed])

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
          <div className="flex items-center gap-2">
            <button onClick={previewFixAll} disabled={loading || bulkLoading || bulkApplying} className="btn-primary text-sm" title="Auto-fix every post's fixable SEO issues">
              {bulkLoading ? <><Loader2 size={14} className="animate-spin" /> Scanning…</> : <><Wand2 size={14} /> Fix all posts</>}
            </button>
            <button onClick={load} disabled={loading} className="btn-secondary text-sm">
              {loading ? <><Loader2 size={14} className="animate-spin" /> Refreshing…</> : <><RefreshCw size={14} /> Refresh</>}
            </button>
          </div>
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
          <IndexingGuide property={data.property} connected={data.connected} />
          {fixMsg && (
            <div className={`flex items-start justify-between gap-3 px-4 py-2.5 rounded-lg text-sm ${fixMsg.ok ? 'bg-[#34c759]/10 text-[#1d1d1f] dark:text-[#f5f5f7] border border-[#34c759]/30' : 'bg-[#ff3b30]/5 text-[#ff3b30] border border-[#ff3b30]/30'}`}>
              <span className="whitespace-pre-line">{fixMsg.text}</span>
              <button onClick={() => setFixMsg(null)} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] flex-shrink-0 mt-0.5"><X size={14} /></button>
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

          {/* Recently dropped — posts Google had indexed but de-indexed in the
              last 7 days. This is the rare-but-real alert that warrants action
              (canonical, broken link, quality drop, manual action). The nightly
              cron stamps droppedAt the moment a post flips indexed → not_indexed. */}
          {data.connected && data.summary.recentlyDropped > 0 && (
            <div className="card p-4 border border-[#ff3b30]/30 bg-[#ff3b30]/5 flex items-start gap-3">
              <AlertCircle size={16} className="text-[#ff3b30] mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">
                  {data.summary.recentlyDropped} post{data.summary.recentlyDropped !== 1 ? 's' : ''} dropped from Google’s index in the last 7 days
                </p>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-2 leading-relaxed">
                  Google removed {data.summary.recentlyDropped === 1 ? 'a previously-indexed post' : 'previously-indexed posts'} from its index. Common causes: a broken canonical, a 404, accidental noindex, or a manual quality flag. Filter the list to <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Not indexed</strong> below to see which ones — rows with a red “Dropped” pill are the affected posts.
                </p>
                <button
                  onClick={() => setFilterNotIndexed(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-[#ff3b30] hover:opacity-90 transition-opacity"
                >
                  <AlertCircle size={12} /> Show the affected posts
                </button>
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
                  onClick={fixSitemap}
                  disabled={pinging}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-[#ff9500] hover:opacity-90 disabled:opacity-60 transition-opacity"
                >
                  {pinging ? <><Loader2 size={12} className="animate-spin" /> Refreshing…</> : <><Zap size={12} /> Refresh sitemap &amp; ping engines</>}
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
            {data.connected && data.summary.notIndexed > 0 && (
              <button
                onClick={() => setFilterNotIndexed(v => !v)}
                className={`ml-1 px-2.5 py-1 rounded-full border transition-colors inline-flex items-center gap-1 ${filterNotIndexed ? 'border-[#ff3b30] text-[#ff3b30] bg-[#ff3b30]/5' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:text-[#1d1d1f]'}`}
                title="Show only posts Google hasn't indexed yet — your Request Indexing worklist"
              >
                {filterNotIndexed ? <X size={11} /> : <AlertCircle size={11} />} Not indexed ({data.summary.notIndexed})
              </button>
            )}
          </div>

          {/* Posts table */}
          <div className="card divide-y divide-gray-100 dark:divide-white/10">
            {posts.length === 0 ? (
              <div className="p-6 text-sm text-[#86868b] text-center">{filterNotIndexed ? 'No posts are marked “not indexed” right now. 🎉' : 'No published posts yet.'}</div>
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
                    {/* "Dropped" pill — this post was indexed and the cron caught
                        it falling out of the index in the last 7 days. Distinct
                        from a "Not indexed" badge (which is the steady state). */}
                    {p.droppedAt && p.indexed === false && (Date.now() - new Date(p.droppedAt).getTime()) < 7 * 24 * 60 * 60 * 1000 && (
                      <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-[#ff3b30] flex-shrink-0" title={`Google de-indexed this post on ${new Date(p.droppedAt).toLocaleDateString()}`}>
                        <AlertCircle size={12} /> Dropped
                      </span>
                    )}
                    {data.connected && <IndexBadge indexed={p.indexed} coverage={p.coverageState} />}
                    {data.connected && (
                      <span className="hidden sm:flex flex-col items-end w-20 flex-shrink-0">
                        <span className="text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{p.clicks} clicks</span>
                        <span className="text-[11px] text-[#86868b]">{p.position ? `pos ${p.position.toFixed(1)}` : `${p.impressions} impr`}</span>
                      </span>
                    )}
                    {data.connected && p.url && (
                      <button
                        onClick={(e) => { e.stopPropagation(); recheckIndexing(p.postId as string) }}
                        disabled={rechecking.has(p.postId as string)}
                        className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-[#86868b] hover:text-[#0071e3] disabled:opacity-60 flex-shrink-0"
                        title="Re-check the indexing status with Google Search Console (the daily sweep does this for you overnight)"
                      >
                        {rechecking.has(p.postId as string)
                          ? <Loader2 size={11} className="animate-spin" />
                          : <RefreshCw size={11} />}
                        <span className="hidden md:inline">Check</span>
                      </button>
                    )}
                    {data.connected && p.url && p.indexed !== true && (
                      <button
                        onClick={(e) => { e.stopPropagation(); requestIndexing(p.url!) }}
                        className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-[#0071e3] hover:underline flex-shrink-0"
                        title="Copy this post's URL and open Search Console to Request Indexing"
                      >
                        Index <ExternalLink size={11} />
                      </button>
                    )}
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[#86868b] hover:text-[#0071e3] flex-shrink-0" title="Open post">
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </button>
                  {open && (
                    <div className="px-4 pb-4 pl-12">
                      {(() => {
                        const fixableCount = p.checks.filter(c => !c.pass && ['internal_links', 'faq', 'title_length', 'image_alt'].includes(c.id)).length
                        if (fixableCount < 2) return null  // a single fix → just use its own button
                        const busy = fixing === `${p.postId}:all`
                        return (
                          <button
                            onClick={() => runFix(p.postId, 'all')}
                            disabled={!!fixing}
                            className="mb-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-60 transition-colors"
                          >
                            {busy ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} Fix all {fixableCount} automatically
                          </button>
                        )
                      })()}
                      <ul className="flex flex-col gap-1.5">
                        {p.checks.filter(c => c.weight > 0).map(c => {
                          const fixable = !c.pass && ['internal_links', 'faq', 'title_length', 'image_alt'].includes(c.id)
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
                                  onClick={() => runFix(p.postId, c.id as 'internal_links' | 'faq' | 'title_length' | 'image_alt')}
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

      {/* Fix-all-posts preview modal — dryRun first, apply (batched) on confirm */}
      {bulkPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => !bulkApplying && setBulkPreview(null)}>
          <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-white/10">
              <div>
                <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Fix all posts</h3>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
                  {bulkPreview.toFix} of {bulkPreview.total} posts have auto-fixable issues ({bulkPreview.totalFixes} fixes total). Each gets its title trimmed, internal links + alt text + FAQ added as needed, then republished. Nothing&apos;s saved yet.
                </p>
              </div>
              <button onClick={() => !bulkApplying && setBulkPreview(null)} disabled={bulkApplying} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] disabled:opacity-40">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5">
              <ul className="flex flex-col gap-2">
                {bulkPreview.preview.map((row) => (
                  <li key={row.postId} className="flex items-start justify-between gap-3 p-3 rounded-lg bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                    <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex-1 line-clamp-2">{row.title}</p>
                    <span className="text-xs font-semibold text-[#0071e3] whitespace-nowrap mt-0.5">{row.fixes} fix{row.fixes !== 1 ? 'es' : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100 dark:border-white/10">
              <button onClick={() => !bulkApplying && setBulkPreview(null)} disabled={bulkApplying} className="btn-secondary text-sm">Cancel</button>
              <button onClick={applyFixAll} disabled={bulkApplying} className="btn-primary text-sm">
                {bulkApplying ? <><Loader2 size={14} className="animate-spin" /> Fixing…</> : `Fix all ${bulkPreview.toFix} posts`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Collapsible "how indexing works" explainer that sits at the top of the page.
 * Sets expectations (optimization vs. indexing, realistic timing) and gives the
 * exact steps + live, property-aware Search Console links to speed Google up.
 */
function IndexingGuide({ property, connected }: { property: string | null; connected: boolean }) {
  const [open, setOpen] = useState(false)
  const rid = property ? gscParam(property) : null
  const sitemapsUrl = rid
    ? `https://search.google.com/search-console/sitemaps?resource_id=${rid}`
    : 'https://search.google.com/search-console'
  // URL Inspection has no reliable pre-fill deep link (Google's `id` param wants
  // an internal inspection hash, not a page URL), so just open Search Console
  // and paste into the Inspect bar.
  const inspectUrl = 'https://search.google.com/search-console'

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
      >
        <Gauge size={18} className="text-[#5856d6] flex-shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">How indexing works — and what to expect</span>
          <span className="block text-[12px] text-[#6e6e73] dark:text-[#8e8e93] mt-0.5 leading-relaxed">
            Your score measures how well a post is <em>optimized</em>. Indexing is separate — whether search engines have added it to their results. We submit to Bing, Yandex &amp; Copilot instantly; Google indexes on its own schedule (days to weeks).
          </span>
        </span>
        {open ? <ChevronDown size={16} className="text-[#86868b] flex-shrink-0" /> : <ChevronRight size={16} className="text-[#86868b] flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-5 pt-3 sm:pl-12 flex flex-col gap-4 border-t border-gray-100 dark:border-white/10 text-[13px] leading-relaxed text-[#3a3a3c] dark:text-[#ebebf0]">
          <div>
            <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">What “indexed” means</p>
            <p>Indexing is when a search engine adds your post to its results so people can actually find it. A post can score 100 and still be waiting to get indexed — that’s normal, especially on a newer site. Optimization (your score) and indexing (the engine’s decision) are two different steps.</p>
          </div>

          <div>
            <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">What MVP does for you, automatically</p>
            <ul className="list-disc pl-5 flex flex-col gap-1">
              <li>Optimizes every post for search &amp; AI Overviews (answer-first intros, FAQ, internal links, alt text, structured data) so it’s ready to rank.</li>
              <li>Keeps your sitemap fresh and pings it the moment you publish, so engines can find new posts fast.</li>
              <li>Instantly notifies Bing, Yandex &amp; Copilot on publish (IndexNow) — these often index within hours.</li>
              <li>Refreshes every post’s Google indexing status overnight, so the worklist below is already current when you open this page. Hit <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Check</strong> on any row for an instant re-check.</li>
              <li>Pulls each post’s real status from Google Search Console so you can see what’s live.</li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">What to expect</p>
            <ul className="list-disc pl-5 flex flex-col gap-1">
              <li><strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Bing, Yandex, Copilot:</strong> usually a few hours to a day or two.</li>
              <li><strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Google:</strong> slower, on Google’s own schedule. Days to a few weeks is normal, sometimes longer for a new site. There’s no “index now” button for Google (for anyone), so early statuses like “Not indexed”, “Still checking” or “URL unknown to Google” are expected — not a problem with your post.</li>
              <li>Impressions show up before clicks, so 0 clicks at the start is normal.</li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">How to get indexed by Google faster</p>
            <ol className="list-decimal pl-5 flex flex-col gap-2">
              <li>
                <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Submit your sitemap (one-time).</span> Open{' '}
                <a href={sitemapsUrl} target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline inline-flex items-center gap-0.5">Search Console → Sitemaps <ExternalLink size={11} /></a>, type <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-white/10 text-[12px]">wp-sitemap.xml</code> under “Add a new sitemap”, and click Submit. The status should read “Success” within a day. You only do this once.
              </li>
              <li>
                <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Request indexing for important posts.</span> Click <span className="font-semibold text-[#0071e3] whitespace-nowrap">Index ↗</span> on any post below — it copies that post’s URL and opens{' '}
                <a href={inspectUrl} target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline inline-flex items-center gap-0.5">Search Console <ExternalLink size={11} /></a>. Paste the URL into the Inspect bar at the top, then click <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Request Indexing</strong>. Use the <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Not indexed</strong> filter below to work through them in order. Google allows about 10 a day — it’s a nudge, not a guarantee, but it’s the strongest signal you can send.
              </li>
              <li>
                <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Build links and momentum.</span> Share each post on social (MVP can auto-post to Pinterest, Facebook &amp; Instagram — every share is a crawlable link back). Internal links are already handled (a “Related reviews” block is added to each post). Over time, a few real backlinks from other sites are the single biggest accelerator.
              </li>
            </ol>
          </div>

          {!connected && (
            <p className="text-[12px] text-[#86868b]">Connect Google Search Console to see live index status and get one-click links here.</p>
          )}
        </div>
      )}
    </div>
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
