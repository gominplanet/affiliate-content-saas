'use client'

/**
 * SEO & Indexing hub. Shows every published post's SEO/AEO score and — when
 * Google Search Console is connected — whether Google has indexed it, plus its
 * clicks / impressions / position. Sorted worst-score-first by default so the
 * creator fixes the highest-impact posts. Expand a row to see exactly what's
 * missing (and, soon, one-click fixes).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { generateBlogRequest } from '@/lib/blog-generate-client'
import OpportunitiesPanel from '@/components/seo/OpportunitiesPanel'
import Link from 'next/link'
import PageHero from '@/components/layout/PageHero'
import SeoHubTabs from '@/components/seo/SeoHubTabs'
import GetFound404Upload from '@/components/seo/GetFound404Upload'
import { SeoGuide } from '@/components/guide/tool-guides'
import { Gauge, Loader2, RefreshCw, ExternalLink, CheckCircle, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight, Wand2, X, Zap, Youtube, DollarSign, ImageOff, Link2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { createBrowserClient } from '@/lib/supabase/client'
import { type Tier } from '@/lib/tier'
import { effectiveTier, VIEW_AS_EVENT } from '@/lib/view-as'
import { gscSitemapsUrl, gscPageIndexingUrl } from '@/lib/gsc-links'

interface Check { id: string; label: string; pass: boolean; weight: number; hint?: string }
interface PostRow {
  postId: string; title: string; slug: string; url: string | null
  /** WordPress post id — present whenever the post is live on WP. Used by the
   *  "Rebuild from video" modal to link a YouTube URL to this exact post. */
  wordpressPostId: number | null
  /** Whether MVP has this post's body stored. Legacy/imported posts are live on
   *  WP but have an empty blog_posts.content — the auto-fixer edits the STORED
   *  body, so without it "Fix all" can't run. False → steer to Rebuild. */
  hasBody?: boolean
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
  summary: { total: number; avgScore: number; indexed: number; notIndexed: number; unknown: number; notInSitemap: number; recentlyDropped: number; thumbnailBlocked: number; sitemapFound: boolean; reasons?: Array<{ reason: string; fixable: 'redirect' | 'benign' | 'wait' | 'other'; count: number }>; totalClicks: number; totalImpressions: number }
  posts: PostRow[]
}

const scoreColor = (s: number) => (s >= 80 ? '#34c759' : s >= 60 ? '#ff9500' : '#ff3b30')

// Mirror the server's fixableFailing rule (lib/seo-fix): a check is auto-
// fixable only when the engine can actually ACT on it. title_length is auto-
// fixable ONLY when the title is too LONG (>65) — we never auto-EXPAND a short
// title (that would mean inventing a hook), so a short title gets a manual-edit
// hint instead of a dead "Fix" button. Body-less posts ARE auto-fixable: the
// route hydrates the live body from WordPress first, so we don't gate on
// hasBody here. Keeping this in lockstep with the server is what stops "Fix all
// N" from promising fixes the engine then skips.
const AUTO_FIX_IDS = ['internal_links', 'faq', 'image_alt', 'disclosure', 'keyword_intro', 'keyword_subhead', 'keyword_title'] as const
type AutoFixId = typeof AUTO_FIX_IDS[number] | 'title_length'
const isAutoFixable = (p: { title: string }, c: Check): boolean => {
  if (c.pass) return false
  // MVP now rewrites the title for BOTH failing cases — too short and
  // keyword-missing — grounded in the article (no fabrication), so both
  // title_length and keyword_title are auto-fixable.
  if (c.id === 'title_length') return true
  return (AUTO_FIX_IDS as readonly string[]).includes(c.id)
}


export default function SeoPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sort, setSort] = useState<'score' | 'clicks' | 'impressions'>('score')
  const [filterNotIndexed, setFilterNotIndexed] = useState(false)  // "Request indexing" worklist
  const [fixing, setFixing] = useState<string | null>(null)   // `${postId}:${fix}`
  const [fixMsg, setFixMsg] = useState<{ ok: boolean; text: string; postId?: string } | null>(null)
  const [titleDraft, setTitleDraft] = useState<{ postId: string; value: string } | null>(null)  // manual title editor
  const [savingTitle, setSavingTitle] = useState(false)
  const [bulkPreview, setBulkPreview] = useState<{ total: number; toFix: number; totalFixes: number; preview: { postId: string; title: string; fixes: number }[] } | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkApplying, setBulkApplying] = useState(false)
  // Header "Tools" disclosure — the green "Get my blog found" button now covers
  // fix-all + URL refresh + sitemap, so the individual actions are tucked away
  // to keep the header calm. Off by default.
  const [toolsOpen, setToolsOpen] = useState(false)
  // One-click "Get my blog found" — runs the whole visibility loop (sitemap +
  // ping Google/Bing/AI, heal changed links, auto-fix SEO) with a plain
  // checklist. step = which stage is running; null = idle.
  const [getFound, setGetFound] = useState<{
    step: number; done: boolean
    results: { purged: boolean; pinged: number; links: number; posts: number }
  } | null>(null)
  // Per-row "Check" button — set of postIds currently being rechecked, so we
  // can show a spinner on the right row(s) while the GSC call is in flight.
  const [rechecking, setRechecking] = useState<Set<string>>(new Set())
  // "Check visible" bulk re-check progress (null = idle).
  const [checkingAll, setCheckingAll] = useState<{ done: number; total: number } | null>(null)
  // Bulk-index selection — postIds the user has ticked. Cap is 50 (matches
  // Google's daily Indexing API quota per account, so we never start work
  // that's guaranteed to fail mid-batch).
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set())
  /** Live progress while the bulk-index loop is running. null when idle.
   *  `results` is per-postId outcome ('submitted'/'quota'/'forbidden'/'failed'
   *  /'pending'). The UI shows a strip with N/M done + each row gets a
   *  status icon. */
  const [bulkIndexProgress, setBulkIndexProgress] = useState<{
    current: number
    total: number
    currentTitle: string | null
    results: Record<string, 'pending' | 'submitted' | 'quota' | 'forbidden' | 'failed'>
    aborted: boolean
  } | null>(null)
  const BULK_INDEX_CAP = 50
  const [refreshPriceProgress, setRefreshPriceProgress] = useState<{ done: number; total: number; current?: string } | null>(null)
  // "Sync bodies from WordPress" — one-time repair for legacy/imported posts
  // whose blog_posts.content is empty (they score near-zero because the overview
  // scores the STORED body). Pulls the live body for all such posts so the whole
  // list reads true. null = idle.
  const [syncingBodies, setSyncingBodies] = useState(false)
  // "Rebuild from video" modal state — the user pastes a YouTube URL for a
  // legacy post that pre-dates MVP, we link it + run the full generation
  // pipeline against the existing WP post id (preserves URL + indexing).
  const [rebuildTarget, setRebuildTarget] = useState<PostRow | null>(null)
  const [rebuildUrl, setRebuildUrl] = useState('')
  const [rebuildFeedback, setRebuildFeedback] = useState('')
  const [rebuildStage, setRebuildStage] = useState<'' | 'linking' | 'generating'>('')
  const [rebuildError, setRebuildError] = useState<string | null>(null)
  // Tier restructure 2026-06-04: Rebuild-from-video is Pro-only. Tracked
  // separately from the rest of SEO so the page still loads / shows scores
  // for everyone — we just hide the Rebuild button for non-Pro users.
  // Server (/api/blog/attach-video) is the source of truth; this is UX.
  //
  // effectiveTier() honors the admin View-as override so admins can preview
  // the hidden-button experience without changing their DB tier.
  const [tier, setTier] = useState<Tier | null>(null)
  useEffect(() => {
    let cancelled = false
    let realTier: string = 'trial'
    const apply = () => { if (!cancelled) setTier(effectiveTier(realTier)) }

    ;(async () => {
      try {
        const supabase = createBrowserClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { realTier = 'trial'; apply(); return }
        const { data } = await supabase
          .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
        realTier = (data as { tier?: string } | null)?.tier ?? 'trial'
        apply()
      } catch {
        realTier = 'trial'
        apply()
      }
    })()

    window.addEventListener(VIEW_AS_EVENT, apply)
    return () => { cancelled = true; window.removeEventListener(VIEW_AS_EVENT, apply) }
  }, [])
  const canRebuild = tier === 'pro' || tier === 'admin'

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

  // Re-attach missing thumbnails: heals published posts whose featured image
  // failed to upload (host was blocking WP media uploads). Idempotent + safe to
  // click anytime; reloads the overview so the banner clears as they're fixed.
  const [reattaching, setReattaching] = useState(false)
  const reattachThumbnails = useCallback(async () => {
    setReattaching(true)
    try {
      const res = await fetch('/api/blog/reattach-thumbnails', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error || 'Couldn’t re-attach thumbnails.'); return }
      if (d.fixed > 0 && d.stillBlocked === 0) toast.success(`Re-attached ${d.fixed} thumbnail${d.fixed !== 1 ? 's' : ''}. ✅`)
      else if (d.fixed > 0) toast.success(`Re-attached ${d.fixed}, but ${d.stillBlocked} still blocked — your host is likely still rejecting uploads.`)
      else if (d.stillBlocked > 0) toast.error(`Still blocked on ${d.stillBlocked} post${d.stillBlocked !== 1 ? 's' : ''} — your host is rejecting image uploads. Allowlist /wp-json/wp/v2/media, then retry.`)
      else toast.success('All thumbnails are already in place.')
      await load()
    } catch { toast.error('Couldn’t reach the server.') }
    finally { setReattaching(false) }
  }, [load])

  // Re-sync stored post URLs from WordPress — fixes ugly ?p=123 links left over
  // from before a permalink change (WP now reports the pretty /post-name/ URL).
  const [resyncingUrls, setResyncingUrls] = useState(false)
  const resyncUrls = useCallback(async () => {
    setResyncingUrls(true)
    try {
      const res = await fetch('/api/blog/resync-permalinks', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Couldn’t refresh post URLs.'); return }
      if (d.updated > 0) toast.success(`Updated ${d.updated} post URL${d.updated !== 1 ? 's' : ''} to the current WordPress permalink.`)
      else toast.success('All post URLs already match WordPress.')
      await load()
    } catch { toast.error('Couldn’t reach the server.') }
    finally { setResyncingUrls(false) }
  }, [load])

  // One-time repair: pull live bodies from WordPress for legacy/imported posts
  // whose stored body is empty (they score near-zero). After it runs, reload so
  // the overview re-scores the real bodies and the whole list reads true.
  const syncBodies = useCallback(async () => {
    setSyncingBodies(true); setFixMsg(null)
    try {
      const res = await fetch('/api/seo/backfill-bodies', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.error) { setFixMsg({ ok: false, text: d.error || 'Couldn’t sync from WordPress. Try again in a moment.' }); return }
      const n = d.backfilled ?? 0
      const tail = d.remaining ? ` ${d.remaining} more to go — click again to finish.` : ''
      const fails = d.failed ? ` (${d.failed} couldn’t be read.)` : ''
      setFixMsg({ ok: true, text: n === 0
        ? 'Nothing to sync — every post already has its text stored.'
        : `Synced ${n} post${n !== 1 ? 's' : ''} from WordPress — scores now reflect the real content.${tail}${fails}` })
      await load()
    } catch { setFixMsg({ ok: false, text: 'Couldn’t sync from WordPress. Try again in a moment.' }) }
    finally { setSyncingBodies(false) }
  }, [load])

  const runFix = useCallback(async (postId: string, fix: AutoFixId | 'all') => {
    setFixing(`${postId}:${fix}`); setFixMsg(null)
    try {
      const res = await fetch('/api/seo/fix', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, fix }),
      })
      const d = await res.json()
      if (d.error) { setFixMsg({ ok: false, text: d.error, postId }); return }
      const n = Array.isArray(d.applied) ? d.applied.length : 1
      setFixMsg(n === 0
        ? { ok: false, text: 'Nothing could be auto-applied here — these checks need a manual edit in WordPress (or a rebuild from the source video).', postId }
        : { ok: true, text: `Applied ${n} fix${n !== 1 ? 'es' : ''} — re-scored to ${d.score}/100 and republished.`, postId })
      await load()
    } catch { setFixMsg({ ok: false, text: 'Something went wrong.', postId }) }
    finally { setFixing(null) }
  }, [load])

  // Manual title editor — set the title by hand from the panel. Hits
  // /api/seo/edit-title (updates WordPress + re-scores), then reloads.
  const saveTitle = useCallback(async (postId: string, title: string) => {
    const clean = title.trim()
    if (clean.length < 5) { setFixMsg({ ok: false, text: 'That title is too short.', postId }); return }
    setSavingTitle(true); setFixMsg(null)
    try {
      const res = await fetch('/api/seo/edit-title', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, title: clean }),
      })
      const d = await res.json()
      if (!res.ok || d.error) { setFixMsg({ ok: false, text: d.error || 'Couldn’t save the title.', postId }); return }
      setFixMsg({ ok: true, text: `Title updated on WordPress — re-scored to ${d.score}/100.`, postId })
      setTitleDraft(null)
      await load()
    } catch { setFixMsg({ ok: false, text: 'Something went wrong.', postId }) }
    finally { setSavingTitle(false) }
  }, [load])

  // "Request indexing" — submit directly via Google's Indexing API instead
  // of opening GSC and waiting for the user to click Request Indexing
  // themselves. Three outcomes:
  //
  //   1. GSC not connected at all          → tell them to connect on /seo.
  //   2. Connected but missing the new     → 412 from the API; nudge to
  //      indexing scope (older OAuth)        reconnect.
  //   3. Submission accepted / failed /    → toast the per-URL outcome.
  //      quota                              "Submitted — Google will crawl
  //                                          within 24h." / "Quota hit."
  //
  // We DELIBERATELY don't fall back to opening GSC anymore — that flow
  // was the whole reason this feature exists. If indexing fails, the
  // toast tells the user what to do.
  const requestIndexing = useCallback(async (url: string) => {
    setFixMsg({ ok: true, text: 'Submitting to Google…' })
    try {
      const res = await fetch('/api/seo/request-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [url] }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.status === 403 || d.proRequired) {
        setFixMsg({ ok: false, text: d.error || 'Manual index submission is a Pro feature — your posts still index automatically via your sitemap.' })
        return
      }
      if (res.status === 412 || d.scopeMissing) {
        setFixMsg({ ok: false, text: `${d.error || 'We need indexing permission.'} On /seo, click Disconnect on the Search Console card, then Connect again — Google will show a new consent screen that includes the indexing scope.` })
        return
      }
      if (res.status === 429 || d.limitReached) {
        setFixMsg({ ok: false, text: d.error || 'Daily indexing cap hit. Try again tomorrow.' })
        return
      }
      if (!res.ok) {
        setFixMsg({ ok: false, text: d.error || 'Submission failed. Try again in a moment.' })
        return
      }
      const result = (d.results || [])[0]
      if (result?.outcome === 'submitted') {
        setFixMsg({ ok: true, text: `Submitted to Google. Crawl usually happens within 24h. (${d.dailyRemaining ?? '–'} of 2 daily nudges left.)` })
      } else if (result?.outcome === 'quota') {
        setFixMsg({ ok: false, text: result.message || 'Google\'s daily quota is exhausted for now.' })
      } else if (result?.outcome === 'forbidden') {
        setFixMsg({ ok: false, text: result.message || 'Google declined. Reconnect Search Console.' })
      } else {
        setFixMsg({ ok: false, text: result?.message || 'Submission failed.' })
      }
    } catch (e) {
      setFixMsg({ ok: false, text: e instanceof Error ? e.message : 'Submission failed.' })
    }
  }, [])

  /** Toggle a postId in the bulk-index selection. Enforces the BULK_INDEX_CAP
   *  ceiling so we never let the user queue more than Google can accept in a
   *  day. */
  const toggleSelect = useCallback((postId: string) => {
    setSelectedPostIds(prev => {
      const next = new Set(prev)
      if (next.has(postId)) next.delete(postId)
      else if (next.size < BULK_INDEX_CAP) next.add(postId)
      else {
        setFixMsg({ ok: false, text: `Bulk index is capped at ${BULK_INDEX_CAP} posts per run (Google's daily limit). Unselect something first.` })
      }
      return next
    })
  }, [])

  /** Bulk-index handler — loops through the selected postIds sequentially,
   *  hits /api/seo/request-index per URL, and updates progress state between
   *  each call so the UI can render N/M done + a per-row status icon.
   *
   *  Why sequential and not batched: the server endpoint already accepts up
   *  to 50 URLs in one call, but it submits them sequentially anyway (rate
   *  limits) and returns ONLY when all 50 finish. From the user's seat that
   *  looks like a frozen spinner. Looping client-side gives live progress.
   *
   *  Stop conditions:
   *    - user clicks Cancel (sets aborted=true mid-loop)
   *    - 429 / quota response (no point continuing — every subsequent call
   *      will also 429)
   *    - 412 / scope-missing (same — Google needs reconnect first) */
  const runBulkIndex = useCallback(async (postIds: string[]) => {
    if (postIds.length === 0 || !data) return
    setFixMsg(null)
    // Build initial progress state with every row marked 'pending'.
    const initialResults: Record<string, 'pending' | 'submitted' | 'quota' | 'forbidden' | 'failed'> = {}
    for (const id of postIds) initialResults[id] = 'pending'
    const titleByPostId = new Map(data.posts.map(p => [p.postId as string, p.title]))

    setBulkIndexProgress({
      current: 0,
      total: postIds.length,
      currentTitle: titleByPostId.get(postIds[0]) ?? null,
      results: initialResults,
      aborted: false,
    })

    let submitted = 0
    let failed = 0
    let stopReason: 'completed' | 'quota' | 'scope' | 'aborted' = 'completed'

    for (let i = 0; i < postIds.length; i++) {
      // Refetch the latest progress before each iteration to see if the user
      // hit Cancel. We do this via the setState callback form below; here
      // we just check a local snapshot we keep updating.
      let aborted = false
      setBulkIndexProgress(prev => {
        if (prev?.aborted) aborted = true
        return prev
          ? { ...prev, current: i + 1, currentTitle: titleByPostId.get(postIds[i]) ?? null }
          : prev
      })
      if (aborted) { stopReason = 'aborted'; break }

      const post = data.posts.find(p => p.postId === postIds[i])
      const url = post?.url
      if (!url) {
        setBulkIndexProgress(prev => prev ? { ...prev, results: { ...prev.results, [postIds[i]]: 'failed' } } : prev)
        failed++
        continue
      }
      try {
        const res = await fetch('/api/seo/request-index', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: [url] }),
        })
        const d = await res.json().catch(() => ({} as { results?: Array<{ outcome?: string }>; scopeMissing?: boolean; limitReached?: boolean; error?: string }))
        if (res.status === 412 || d.scopeMissing) {
          stopReason = 'scope'
          setBulkIndexProgress(prev => prev ? { ...prev, results: { ...prev.results, [postIds[i]]: 'forbidden' } } : prev)
          break
        }
        if (res.status === 429 || d.limitReached) {
          stopReason = 'quota'
          setBulkIndexProgress(prev => prev ? { ...prev, results: { ...prev.results, [postIds[i]]: 'quota' } } : prev)
          break
        }
        const outcome = (d.results?.[0]?.outcome as string | undefined) ?? (res.ok ? 'submitted' : 'failed')
        const normalised: 'submitted' | 'quota' | 'forbidden' | 'failed' =
          outcome === 'submitted' ? 'submitted'
          : outcome === 'quota' ? 'quota'
          : outcome === 'forbidden' ? 'forbidden'
          : 'failed'
        if (normalised === 'submitted') submitted++
        else if (normalised === 'quota') { stopReason = 'quota'; setBulkIndexProgress(prev => prev ? { ...prev, results: { ...prev.results, [postIds[i]]: normalised } } : prev); break }
        else failed++
        setBulkIndexProgress(prev => prev ? { ...prev, results: { ...prev.results, [postIds[i]]: normalised } } : prev)
      } catch {
        failed++
        setBulkIndexProgress(prev => prev ? { ...prev, results: { ...prev.results, [postIds[i]]: 'failed' } } : prev)
      }
    }

    // Wrap-up toast — distinct copy per stop reason.
    const summary = stopReason === 'completed'
      ? `Bulk indexing complete — ${submitted} submitted${failed > 0 ? `, ${failed} failed` : ''}.`
      : stopReason === 'quota'
      ? `Stopped at Google's daily quota — ${submitted} submitted before the cap hit. Try the rest tomorrow.`
      : stopReason === 'scope'
      ? 'Stopped — Google needs to be reconnected for the indexing scope. Disconnect Search Console on /seo and reconnect.'
      : `Cancelled — ${submitted} submitted before you stopped.`
    setFixMsg({ ok: stopReason === 'completed' && failed === 0, text: summary })
    // Clear the selection on success; leave it on quota/abort so the user
    // can see what didn't ship.
    if (stopReason === 'completed') setSelectedPostIds(new Set())
    // Leave the progress strip up for ~5s so the user can read the final
    // status, then auto-clear.
    setTimeout(() => setBulkIndexProgress(null), 5000)
  }, [data])

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

  // "Check visible" — re-check indexing for every post currently shown, one at
  // a time (Google's URL Inspection API is rate-limited, so we never fan out).
  // Capped at BULK_INDEX_CAP so a huge library can't blow the daily quota in
  // one click. Each row updates in place via recheckIndexing.
  const checkVisible = useCallback(async (targets: { postId: string; url: string | null }[]) => {
    const list = targets.filter(t => !!t.url).slice(0, 50)
    if (!list.length) return
    setCheckingAll({ done: 0, total: list.length })
    for (let i = 0; i < list.length; i++) {
      await recheckIndexing(list[i].postId)
      setCheckingAll({ done: i + 1, total: list.length })
    }
    setCheckingAll(null)
    setFixMsg({ ok: true, text: `Re-checked indexing for ${list.length} post${list.length === 1 ? '' : 's'}.` })
  }, [recheckIndexing])

  // "Rebuild from video" — for legacy posts (pre-MVP or first-generation
  // posts on a thin prompt) that score low and can't be auto-fixed. The user
  // pastes the YouTube URL of the original video; we link it to the existing
  // WP post and run the full generation pipeline against the SAME WP post id
  // so the URL + Google indexing history are preserved.
  //
  // Two-step flow with intermediate UI state so the user understands why this
  // takes ~60s (transcript fetch + Claude generation + WordPress push).
  const submitRebuild = useCallback(async () => {
    if (!rebuildTarget?.wordpressPostId) return
    const url = rebuildUrl.trim()
    if (!url) { setRebuildError('Paste the YouTube URL for this post.'); return }
    setRebuildError(null); setRebuildStage('linking'); setFixMsg(null)
    try {
      const linkRes = await fetch('/api/blog/attach-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wordpressPostId: rebuildTarget.wordpressPostId, youtubeUrl: url }),
      })
      const linkJson = await linkRes.json().catch(() => ({})) as { videoId?: string; error?: string; youtubeTitle?: string }
      if (!linkRes.ok || !linkJson.videoId) {
        setRebuildError(linkJson.error || `Couldn't link that video (${linkRes.status}).`)
        setRebuildStage(''); return
      }
      setRebuildStage('generating')
      const genRes = await generateBlogRequest({
        videoId: linkJson.videoId,
        rewriteFeedback: rebuildFeedback.trim() || undefined,
        // Body images are slow + best-effort; the rebuild's gain is body
        // quality (transcript-grounded, voice-tuned, comparison table,
        // FAQ etc.). Existing featured image stays.
        includeImages: true,
      })
      const genJson = await genRes.json().catch(() => ({})) as { error?: string; wordpressUrl?: string }
      if (!genRes.ok) {
        setRebuildError(genJson.error || `Rebuild failed (${genRes.status}).`)
        setRebuildStage(''); return
      }
      const title = linkJson.youtubeTitle ? ` ("${linkJson.youtubeTitle}")` : ''
      setFixMsg({ ok: true, text: `Rebuilt the post${title} from the video — same URL, fresh body. Refreshing your scores…` })
      setRebuildTarget(null); setRebuildUrl(''); setRebuildFeedback(''); setRebuildStage('')
      await load()
    } catch (e) {
      setRebuildError(e instanceof Error ? e.message : 'Something went wrong.')
      setRebuildStage('')
    }
  }, [rebuildTarget, rebuildUrl, rebuildFeedback, load])

  // One click: purge the host sitemap cache (so Google's sitemap is complete)
  // + push URLs to Bing/Copilot via IndexNow + re-check.

  // The dummy-proof button: one click runs the whole get-found loop so a
  // non-technical creator never has to know which tool does what. Every step
  // reuses an existing, non-destructive endpoint.
  const runGetFound = useCallback(async () => {
    const results = { purged: false, pinged: 0, links: 0, posts: 0 }
    setGetFound({ step: 0, done: false, results: { ...results } })
    // 1 — refresh the sitemap + ping Google's cache, Bing, Copilot & AI crawlers.
    try {
      const pr = await fetch('/api/seo/purge-sitemap', { method: 'POST' })
      if (pr.ok) results.purged = true
      const ir = await fetch('/api/seo/indexnow', { method: 'POST' })
      const id = await ir.json().catch(() => ({}))
      results.pinged = id.submitted || 0
    } catch { /* best-effort */ }
    setGetFound({ step: 1, done: false, results: { ...results } })
    // 2 — heal any changed permalinks so old URLs 301 instead of 404.
    try {
      const rr = await fetch('/api/blog/resync-permalinks', { method: 'POST' })
      const rd = await rr.json().catch(() => ({}))
      results.links = rd.redirected || 0
    } catch { /* best-effort */ }
    setGetFound({ step: 2, done: false, results: { ...results } })
    // 3 — auto-fix every post's fixable SEO issues (same engine as "Fix all").
    try {
      for (let guard = 0; guard < 20; guard++) {
        const res = await fetch('/api/seo/fix-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
        const d = await res.json().catch(() => ({})) as { error?: string; fixed?: number; remaining?: number }
        if (d.error) break
        results.posts += d.fixed || 0
        if (!d.remaining || d.fixed === 0) break
      }
    } catch { /* best-effort */ }
    setGetFound({ step: 3, done: false, results: { ...results } })
    // 4 — re-read the freshened sitemap + refresh what's indexed.
    await new Promise(r => setTimeout(r, 1500))
    await load()
    setGetFound({ step: 4, done: true, results: { ...results } })
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
      } else if (totalFixed === 0) {
        // Auto-fixer is tapped out. WHETHER that's good news depends on
        // the score — at 95+ avg it really IS celebration-worthy, but at
        // 58 there's plenty of room left, it just needs manual work
        // (longer posts, more H2s, better titles). Branch on the score
        // and aggregate WHAT'S failing across the catalogue so creators
        // know what to do next.
        const avgScore = data?.summary?.avgScore ?? 100
        const posts = data?.posts ?? []
        // Count each failing check across the catalogue. Skip checks the
        // auto-fixer CAN handle (we'd have fixed them; if we didn't, the
        // skip reason is already in lastSkipped). Surface only the
        // unfixable ones — the ones that genuinely need the user.
        const AUTO_FIXABLE = new Set(['internal_links', 'has_faq', 'has_alt', 'has_table'])
        const fails = new Map<string, { count: number; label: string; hint: string }>()
        for (const p of posts) {
          for (const c of p.checks ?? []) {
            if (c.pass) continue
            if (AUTO_FIXABLE.has(c.id)) continue
            const cur = fails.get(c.id) || { count: 0, label: c.label || c.id, hint: c.hint || '' }
            cur.count++
            fails.set(c.id, cur)
          }
        }
        const breakdown = [...fails.values()]
          .sort((a, b) => b.count - a.count)
          .slice(0, 4)
          .map(f => `• ${f.count} post${f.count === 1 ? '' : 's'}: ${f.label}${f.hint ? ` — ${f.hint}` : ''}`)
        const manualLines = lastSkipped
          .filter(s => s.reasons.some(r => /manual|edit it manually|edit it yourself/i.test(r)))
          .slice(0, 5)
          .map(s => `• "${s.title}": ${s.reasons.join(' · ')}`)

        if (avgScore >= 90) {
          const tail = breakdown.length ? `\n\nA few small things still need your hand:\n${breakdown.join('\n')}` : ''
          setFixMsg({ ok: true, text: `Every post is in great shape (avg ${Math.round(avgScore)}/100) — auto-fixer can't push further. 🎉${tail}` })
        } else if (avgScore >= 70) {
          const tail = breakdown.length
            ? `\n\nThe remaining points need YOUR hand:\n${breakdown.join('\n')}`
            : manualLines.length ? `\n\n${manualLines.join('\n')}` : ''
          setFixMsg({ ok: true, text: `Auto-fixer's done what it can (avg ${Math.round(avgScore)}/100).${tail}` })
        } else {
          // Score < 70 — DO NOT celebrate. Be direct: the auto-fixer is
          // tapped out AND there's lots of room left. The remaining points
          // are not script-able — they need content / structure work.
          const tail = breakdown.length
            ? `\n\nMost of what's missing:\n${breakdown.join('\n')}\n\nThese aren't auto-fixable — they need a content pass in WordPress (or a regen from the source video).`
            : `\n\nAuto-fixer couldn't help further on this batch.`
          setFixMsg({ ok: false, text: `Auto-fixer is tapped out, but average score is only ${Math.round(avgScore)}/100 — plenty of room.${tail}` })
        }
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

  const refreshPrices = useCallback(async () => {
    setRefreshPriceProgress({ done: 0, total: 0 })
    try {
      const res = await fetch('/api/blog/refresh-prices')
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}))
        if ((d as { skipped?: boolean }).skipped) {
          setFixMsg({ ok: true, text: 'Price schema is disabled in Customize Blog — enable it first.' })
        } else {
          setFixMsg({ ok: false, text: (d as { error?: string }).error || 'Price refresh failed.' })
        }
        setRefreshPriceProgress(null)
        return
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim()
          if (!line) continue
          try {
            const ev = JSON.parse(line) as { done: number; total: number; current?: string; finished?: boolean }
            setRefreshPriceProgress({ done: ev.done, total: ev.total, current: ev.current })
            if (ev.finished) {
              setFixMsg({ ok: true, text: `Updated prices on ${ev.done} post${ev.done !== 1 ? 's' : ''}.` })
              setRefreshPriceProgress(null)
            }
          } catch { /* partial chunk */ }
        }
      }
    } catch (e) {
      setFixMsg({ ok: false, text: e instanceof Error ? e.message : 'Price refresh failed.' })
      setRefreshPriceProgress(null)
    }
  }, [])

  return (
    <>
      <PageHero
        guide={<SeoGuide />}
        title="SEO & Indexing"
        accent="rgba(16, 185, 129, 0.30)"
        subtitle={
          loading
            ? 'Loading…'
            : data
              ? `${data.summary.total} posts · avg score ${data.summary.avgScore}/100${data.connected ? ` · tracking ${data.property}` : ''}`
              : 'Make sure your posts are indexed and optimized'
        }
        actions={
          <>
            {toolsOpen && (
              <>
                <button
                  onClick={previewFixAll}
                  disabled={loading || bulkLoading || bulkApplying}
                  className="px-3.5 py-2 rounded-lg border text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-bright)', color: 'var(--text)' }}
                  title="Auto-fix every post's fixable SEO issues"
                >
                  {bulkLoading ? <><Loader2 size={13} className="animate-spin" /> Scanning…</> : <><Wand2 size={13} /> Fix all posts</>}
                </button>
                <button
                  onClick={refreshPrices}
                  disabled={!!refreshPriceProgress}
                  className="px-3.5 py-2 rounded-lg border text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-bright)', color: 'var(--text)' }}
                  title="Re-fetch current Amazon prices and update all posts' product schema"
                >
                  {refreshPriceProgress
                    ? <><Loader2 size={13} className="animate-spin" /> {refreshPriceProgress.total > 0 ? `${refreshPriceProgress.done}/${refreshPriceProgress.total}` : 'Scanning…'}</>
                    : <><DollarSign size={13} /> Refresh prices</>}
                </button>
                <button
                  onClick={resyncUrls}
                  disabled={resyncingUrls}
                  className="px-3.5 py-2 rounded-lg border text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-bright)', color: 'var(--text)' }}
                  title="Re-fetch each post's current WordPress permalink and update stored links"
                >
                  {resyncingUrls ? <><Loader2 size={13} className="animate-spin" /> Syncing URLs…</> : <><Link2 size={13} /> Refresh post URLs</>}
                </button>
              </>
            )}
            <button
              onClick={() => setToolsOpen(v => !v)}
              className="px-3 py-2 rounded-lg border text-[13px] font-semibold inline-flex items-center gap-1 transition-colors"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-bright)', color: 'var(--text)' }}
              title="More tools"
            >
              Tools <ChevronDown size={13} className={toolsOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="px-3.5 py-2 rounded-lg border text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-bright)', color: 'var(--text)' }}
            >
              {loading ? <><Loader2 size={13} className="animate-spin" /> Refreshing…</> : <><RefreshCw size={13} /> Refresh</>}
            </button>
          </>
        }
      />

      <SeoHubTabs />

      {/* Super dummy-proof hero: explains it in plain words, one button does the
          whole get-found loop, and a drop zone fixes 404s straight from a Search
          Console export. All the links they need are right here. */}
      <div className="rounded-2xl border border-[#34c759]/30 bg-[#34c759]/[0.06] p-4 sm:p-5 mb-5">
        <div className="flex items-center gap-2 mb-1">
          <Zap size={18} className="text-[#34c759]" />
          <h2 className="text-[16px] font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Get found on Google, Bing &amp; AI</h2>
        </div>
        <p className="text-[13px] text-[#4b4b4f] dark:text-[#b0b0b5] mb-4 max-w-2xl">
          Google, Bing and AI models can only show pages they&apos;ve crawled. This does the whole job for you, no SEO knowledge needed. Run step 1 anytime; do step 2 once to win back rankings from old broken links.
        </p>

        {/* Step 1 — one button does everything */}
        <div className="rounded-xl bg-white/70 dark:bg-white/[0.03] border border-black/5 dark:border-white/10 p-3.5 mb-3">
          {!getFound ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]"><span className="text-[#34c759]">1.</span> One click — we handle the rest</p>
                <p className="text-[12px] text-[#4b4b4f] dark:text-[#b0b0b5] mt-0.5">Refreshes your sitemap, pings Google, Bing &amp; AI crawlers, heals broken links, and auto-fixes SEO issues on every post.</p>
              </div>
              <button onClick={runGetFound} className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-[15px] font-bold text-white bg-[#34c759] hover:bg-[#2fb350] transition-colors shadow-sm">
                <Zap size={18} /> Get my blog found
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-3">
                {getFound.done ? <CheckCircle2 size={18} className="text-[#34c759]" /> : <Loader2 size={18} className="animate-spin text-[#34c759]" />}
                <p className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{getFound.done ? 'Done — your blog is set up to be found' : 'Getting your blog found…'}</p>
              </div>
              <div className="space-y-1.5">
                {['Refreshing your sitemap + pinging Google, Bing & AI', 'Healing changed links so nothing 404s', 'Auto-fixing SEO issues on your posts', 'Re-checking what search engines see'].map((label, i) => {
                  const st = getFound.step > i ? 'done' : getFound.step === i ? 'active' : 'todo'
                  return (
                    <div key={i} className="flex items-center gap-2 text-[13px]">
                      {st === 'done' ? <CheckCircle2 size={15} className="text-[#34c759]" />
                        : st === 'active' ? <Loader2 size={15} className="animate-spin text-[#34c759]" />
                        : <span className="w-[15px] h-[15px] rounded-full border border-black/15 dark:border-white/20 inline-block" />}
                      <span className={st === 'todo' ? 'text-[#86868b]' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'}>{label}</span>
                    </div>
                  )
                })}
              </div>
              {getFound.done && (() => {
                const r = getFound.results
                const parts = [
                  r.purged ? 'refreshed your sitemap' : null,
                  r.pinged ? `pinged Bing/Copilot with ${r.pinged} pages` : null,
                  r.links ? `healed ${r.links} link${r.links === 1 ? '' : 's'}` : null,
                  r.posts ? `improved ${r.posts} post${r.posts === 1 ? '' : 's'}` : null,
                ].filter(Boolean)
                const summary = parts.length ? parts.join(' · ') : 'Everything was already in good shape'
                return (
                  <div className="mt-3 pt-3 border-t border-[#34c759]/20">
                    <p className="text-[13px] text-[#4b4b4f] dark:text-[#b0b0b5]">
                      {summary.charAt(0).toUpperCase() + summary.slice(1)}. Google and Bing re-crawl over the next few days.
                    </p>
                    <button onClick={() => setGetFound(null)} className="mt-2 text-[13px] font-medium text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]">Run again</button>
                  </div>
                )
              })()}
            </div>
          )}
        </div>

        {/* Step 2 — fix 404s from a Search Console export (drop the file, we do the rest) */}
        <div className="rounded-xl bg-white/70 dark:bg-white/[0.03] border border-black/5 dark:border-white/10 p-3.5">
          <p className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]"><span className="text-[#34c759]">2.</span> Win back rankings from broken links <span className="font-normal text-[#86868b]">— one-time, worth it</span></p>
          <ol className="text-[12px] text-[#4b4b4f] dark:text-[#b0b0b5] mt-1.5 mb-2.5 space-y-1 list-none pl-0">
            <li>
              <strong>a.</strong>{' '}
              {data?.connected ? (
                <a href={data.property ? `https://search.google.com/search-console/index?resource_id=${encodeURIComponent(data.property)}` : 'https://search.google.com/search-console'} target="_blank" rel="noreferrer" className="font-medium text-[#7C3AED] hover:underline inline-flex items-center gap-1">Open your Pages report in Search Console <ExternalLink size={11} /></a>
              ) : (
                <a href="/api/auth/gsc" className="font-medium text-[#7C3AED] hover:underline">Connect Google Search Console first</a>
              )}
              , then click the <strong>Not found (404)</strong> row.
            </li>
            <li><strong>b.</strong> Hit <strong>Export</strong> (top-right) and download the file (.zip or .csv).</li>
            <li><strong>c.</strong> Drop it below. We match each dead URL to the right live post and 301-redirect it, recovering the rankings Google already found.</li>
          </ol>
          <GetFound404Upload onDone={load} />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#86868b] dark:text-[#8e8e93] py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Scoring your posts…
        </div>
      ) : error ? (
        <div className="card p-5 border border-[#ff3b30]/30 bg-[#ff3b30]/5 text-sm text-[#ff3b30]">{error}</div>
      ) : !data ? null : (
        <div className="flex flex-col gap-4">
          <IndexingGuide property={data.property} connected={data.connected} />

          {/* Revenue-opportunity worklist (Phase 2). Self-contained — fetches
              /api/seo/opportunities and ranks every post by its single highest-
              leverage fix. Only shown when GSC is connected (the page already
              renders a prominent connect prompt below when it isn't). */}
          {data.connected && <OpportunitiesPanel />}
          {/* Post-scoped fix results render INLINE under that post's button (so a
              user scrolled down to a row actually sees the outcome). Only page-
              level messages — bulk fix-all, sitemap, indexing — show up here. */}
          {fixMsg && !fixMsg.postId && (
            <div className={`flex items-start justify-between gap-3 px-4 py-2.5 rounded-lg text-sm ${fixMsg.ok ? 'bg-[#34c759]/10 text-[#1d1d1f] dark:text-[#f5f5f7] border border-[#34c759]/30' : 'bg-[#ff3b30]/5 text-[#ff3b30] border border-[#ff3b30]/30'}`}>
              <span className="whitespace-pre-line">{fixMsg.text}</span>
              <button onClick={() => setFixMsg(null)} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] flex-shrink-0 mt-0.5"><X size={14} /></button>
            </div>
          )}
          {/* Needs attention — every actionable warning folded into ONE compact
              strip (connect GSC, de-indexed drops, missing from sitemap, missing
              thumbnails) so five possible banners never stack into a wall. */}
          {(() => {
            const F = 'font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]'
            const actBtn = 'shrink-0 text-[12px] font-semibold px-2.5 py-1 rounded-md text-white transition-opacity hover:opacity-90 disabled:opacity-60'
            const rows: Array<{ key: string; icon: React.ReactNode; text: React.ReactNode; action?: React.ReactNode }> = []
            if (!data.connected) rows.push({
              key: 'gsc', icon: <Gauge size={15} className="text-[#4285F4] flex-shrink-0" />,
              text: <><span className={F}>Connect Search Console</span> to see indexing, rankings and traffic (scores work without it).</>,
              action: <a href="/api/auth/gsc?returnTo=/seo" className={`${actBtn} bg-[#4285F4]`}>Connect</a>,
            })
            if (data.connected && data.summary.recentlyDropped > 0) rows.push({
              key: 'dropped', icon: <AlertCircle size={15} className="text-[#ff3b30] flex-shrink-0" />,
              text: <><span className={F}>{data.summary.recentlyDropped} post{data.summary.recentlyDropped !== 1 ? 's' : ''} dropped from Google&apos;s index</span> in the last 7 days (broken canonical, a 404, or accidental noindex).</>,
              action: <button onClick={() => setFilterNotIndexed(true)} className={`${actBtn} bg-[#ff3b30]`}>Show</button>,
            })
            if (data.summary.sitemapFound && data.summary.notInSitemap > 0) rows.push({
              key: 'sitemap', icon: <AlertCircle size={15} className="text-[#ff9500] flex-shrink-0" />,
              text: <><span className={F}>{data.summary.notInSitemap} post{data.summary.notInSitemap !== 1 ? 's' : ''} missing from your sitemap.</span> The green <span className="font-semibold text-[#34c759]">Get my blog found</span> button up top fixes this.</>,
            })
            if (data.summary.thumbnailBlocked > 0) rows.push({
              key: 'thumb', icon: <ImageOff size={15} className="text-[#ff9500] flex-shrink-0" />,
              text: <><span className={F}>{data.summary.thumbnailBlocked} post{data.summary.thumbnailBlocked !== 1 ? 's' : ''} published without a thumbnail</span> — usually your host blocking image uploads via the API. Safe to re-run.</>,
              action: <button onClick={reattachThumbnails} disabled={reattaching} className={`${actBtn} bg-[#ff9500]`}>{reattaching ? 'Fixing…' : 'Re-attach'}</button>,
            })
            if (rows.length === 0) return null
            return (
              <div className="rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden">
                <div className="px-4 py-2 border-b border-gray-100 dark:border-white/10">
                  <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Needs attention</p>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-white/5">
                  {rows.map(r => (
                    <div key={r.key} className="flex items-center gap-2.5 px-4 py-2.5">
                      {r.icon}
                      <span className="text-[13px] text-[#4b4b4f] dark:text-[#d2d2d7] flex-1 min-w-0">{r.text}</span>
                      {r.action}
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

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
                <SummaryCard label="Clicks (28d)" value={data.summary.totalClicks.toLocaleString()} accent="#7C3AED" />
                <SummaryCard label="Impressions (28d)" value={data.summary.totalImpressions.toLocaleString()} accent="#5856d6" />
              </>
            ) : (
              <SummaryCard label="Posts" value={String(data.summary.total)} accent="#7C3AED" />
            )}
          </div>

          {/* Why aren't they indexed — mirrors GSC's breakdown so the user knows
              which pile is worth acting on. 404/soft-404 → fixable with redirects;
              noindex/canonical → benign (archives); discovered/crawled → just
              waiting on Google. */}
          {data.connected && (data.summary.reasons?.length ?? 0) > 0 && (() => {
            const meta: Record<string, { dot: string; note: string }> = {
              redirect: { dot: '#ff3b30', note: 'Fixable — send these to a live page with Fix 404s' },
              other:    { dot: '#ff9500', note: 'Worth a look' },
              wait:     { dot: '#5856d6', note: 'Waiting on Google — keep the sitemap fresh' },
              benign:   { dot: '#8e8e93', note: 'Expected — archive/duplicate pages, nothing to do' },
            }
            const order = { redirect: 0, other: 1, wait: 2, benign: 3 } as const
            const reasons = [...(data.summary.reasons || [])].sort((a, b) => (order[a.fixable] - order[b.fixable]) || (b.count - a.count))
            const fixable = reasons.filter(r => r.fixable === 'redirect').reduce((s, r) => s + r.count, 0)
            return (
              <div className="rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-gray-100 dark:border-white/10 flex items-center justify-between">
                  <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Why posts aren&apos;t indexed</p>
                  {fixable > 0 && (
                    <Link href="/tools/redirects" className="text-xs font-medium text-[#7C3AED] hover:underline inline-flex items-center gap-1">
                      Fix {fixable} with redirects →
                    </Link>
                  )}
                </div>
                <div className="divide-y divide-gray-100 dark:divide-white/5">
                  {reasons.map(r => (
                    <div key={r.reason} className="flex items-center gap-3 px-4 py-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: meta[r.fixable].dot }} />
                      <span className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex-shrink-0 w-40 truncate">{r.reason}</span>
                      <span className="text-xs text-[#86868b] flex-1 truncate hidden sm:block">{meta[r.fixable].note}</span>
                      <span className="text-sm font-semibold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">{r.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Missed demand (Phase 3 GSC loop) — queries the site already gets
              impressions for with no post squarely targeting them. */}
          {data.connected && <QueryGapsCard />}

          {/* One-time "sync bodies from WordPress" prompt. Legacy/imported posts
              are live on WP but have no body stored in MVP, so they score near-
              zero (the overview scores the STORED body). One click pulls the real
              bodies in → scores read true + they become auto-fixable in place. */}
          {(() => {
            const missingBodies = (data.posts || []).filter(p => p.hasBody === false).length
            if (missingBodies === 0) return null
            const plural = missingBodies !== 1
            return (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 rounded-xl border border-[#7C3AED]/30 bg-[#7C3AED]/5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {missingBodies} older post{plural ? 's' : ''} {plural ? 'score' : 'scores'} low because {plural ? 'their' : 'its'} text isn&apos;t synced to MVP yet
                  </p>
                  <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
                    They&apos;re live on WordPress — pull the real bodies in so the scores read true and you can auto-fix them in place. No rebuild needed.
                  </p>
                </div>
                <button
                  onClick={syncBodies}
                  disabled={syncingBodies}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 transition-colors"
                >
                  {syncingBodies ? <><Loader2 size={13} className="animate-spin" /> Syncing…</> : <><RefreshCw size={13} /> Sync {missingBodies} from WordPress</>}
                </button>
              </div>
            )
          })()}

          {/* Sort controls */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#86868b]">Sort by:</span>
            {([['score', 'Lowest score'], ['clicks', 'Most clicks'], ['impressions', 'Most impressions']] as const).map(([k, lbl]) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                disabled={(k !== 'score') && !data.connected}
                className={`px-2.5 py-1 rounded-full border transition-colors ${sort === k ? 'border-[#7C3AED] text-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:text-[#1d1d1f] disabled:opacity-40'}`}
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

          {/* Bulk index toolbar — only shown when GSC is connected (no point
              indexing if we can't submit), only when something is selected
              OR a run is in progress. The toolbar floats just above the
              posts table so users keep their place. */}
          {data.connected && (selectedPostIds.size > 0 || bulkIndexProgress) && (() => {
            const selectableUrlsForBulk = posts
              .filter(p => selectedPostIds.has(p.postId) && p.url)
              .map(p => p.postId)
            const running = !!bulkIndexProgress && (bulkIndexProgress.current < bulkIndexProgress.total) && !bulkIndexProgress.aborted
            return (
              <div className="card p-3 flex items-center gap-3 flex-wrap bg-[#34c759]/5 border-[#34c759]/30">
                {bulkIndexProgress ? (
                  <>
                    <Loader2 size={14} className={`text-[#34c759] ${running ? 'animate-spin' : ''}`} />
                    <span className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                      Indexing {bulkIndexProgress.current} of {bulkIndexProgress.total}
                      {bulkIndexProgress.currentTitle && running && (
                        <span className="text-[#86868b] font-normal">
                          {' · '}{bulkIndexProgress.currentTitle.slice(0, 60)}{bulkIndexProgress.currentTitle.length > 60 ? '…' : ''}
                        </span>
                      )}
                    </span>
                    <div className="flex-1 min-w-[100px] h-1.5 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-[#34c759] transition-all" style={{ width: `${(bulkIndexProgress.current / Math.max(1, bulkIndexProgress.total)) * 100}%` }} />
                    </div>
                    {running ? (
                      <button
                        onClick={() => setBulkIndexProgress(prev => prev ? { ...prev, aborted: true } : prev)}
                        className="px-3 py-1.5 text-xs font-semibold text-[#ff3b30] hover:bg-[#ff3b30]/10 rounded transition-colors"
                      >
                        Cancel
                      </button>
                    ) : (
                      <button
                        onClick={() => setBulkIndexProgress(null)}
                        className="px-3 py-1.5 text-xs font-semibold text-[#86868b] hover:bg-gray-100 dark:hover:bg-white/5 rounded transition-colors"
                      >
                        Dismiss
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                      {selectedPostIds.size} selected
                    </span>
                    <span className="text-xs text-[#86868b]">
                      {selectedPostIds.size >= BULK_INDEX_CAP ? '(cap reached)' : `up to ${BULK_INDEX_CAP - selectedPostIds.size} more`}
                    </span>
                    <div className="flex-1" />
                    <button
                      onClick={() => setSelectedPostIds(new Set())}
                      className="px-3 py-1.5 text-xs font-semibold text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => void runBulkIndex(selectableUrlsForBulk)}
                      disabled={selectableUrlsForBulk.length === 0}
                      className="px-4 py-1.5 text-xs font-semibold text-white bg-[#34c759] hover:bg-[#2ea44f] disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 transition-colors shadow-sm"
                    >
                      <CheckCircle size={12} /> Index {selectableUrlsForBulk.length} post{selectableUrlsForBulk.length === 1 ? '' : 's'}
                    </button>
                  </>
                )}
              </div>
            )
          })()}

          {/* Posts table */}
          <div className="card divide-y divide-gray-100 dark:divide-white/10">
            {/* Select-all-visible header — only shown when GSC is connected. */}
            {data.connected && posts.length > 0 && (() => {
              const selectableHere = posts.filter(p => p.url && p.indexed !== true)
              const allSelected = selectableHere.length > 0 && selectableHere.every(p => selectedPostIds.has(p.postId))
              const anySelected = selectableHere.some(p => selectedPostIds.has(p.postId))
              return (
                <div className="px-3 py-2 text-[11px] text-[#86868b] dark:text-[#8e8e93] flex items-center gap-2 border-b border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-white/[0.02]">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = !allSelected && anySelected }}
                    onChange={() => {
                      if (allSelected) {
                        // Deselect just the visible rows; preserve any
                        // selections from a different filter view.
                        setSelectedPostIds(prev => {
                          const next = new Set(prev)
                          for (const p of selectableHere) next.delete(p.postId)
                          return next
                        })
                      } else {
                        // Add up to BULK_INDEX_CAP from the visible rows.
                        setSelectedPostIds(prev => {
                          const next = new Set(prev)
                          for (const p of selectableHere) {
                            if (next.size >= BULK_INDEX_CAP) break
                            next.add(p.postId)
                          }
                          return next
                        })
                      }
                    }}
                    className="accent-[#34c759] w-3.5 h-3.5"
                    title={`Select up to ${BULK_INDEX_CAP} posts for bulk indexing`}
                  />
                  <span>Select visible (max {BULK_INDEX_CAP}) for bulk indexing</span>
                  {/* Bulk re-check indexing for every post shown (sequential,
                      capped at 50 to respect Google's daily quota). */}
                  <button
                    onClick={() => checkVisible(posts)}
                    disabled={!!checkingAll}
                    className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-[#7C3AED] hover:underline disabled:opacity-60 disabled:no-underline"
                    title="Re-check Google indexing status for every post shown (up to 50)"
                  >
                    {checkingAll
                      ? <><Loader2 size={11} className="animate-spin" /> Checking {checkingAll.done}/{checkingAll.total}…</>
                      : <><RefreshCw size={11} /> Check visible</>}
                  </button>
                </div>
              )
            })()}
            {posts.length === 0 ? (
              <div className="p-6 text-sm text-[#86868b] text-center">{filterNotIndexed ? 'No posts are marked “not indexed” right now. 🎉' : 'No published posts yet.'}</div>
            ) : posts.map((p) => {
              const open = expanded === p.postId
              const failing = p.checks.filter(c => !c.pass && c.weight > 0)
              const autoFixable = p.checks.filter(c => isAutoFixable(p, c)).length
              const selectable = !!p.url && p.indexed !== true && data.connected
              const isSelected = selectedPostIds.has(p.postId)
              const bulkOutcome = bulkIndexProgress?.results[p.postId]
              return (
                <div key={p.postId} className={isSelected ? 'bg-[#34c759]/5' : undefined}>
                  <button
                    onClick={() => setExpanded(open ? null : p.postId)}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                  >
                    {/* Selection checkbox — only when this post is eligible
                        for indexing (has a URL + GSC connected + not already
                        indexed). Wrapped in a span with onClick stopPropagation
                        so ticking it doesn't ALSO expand the row. */}
                    {selectable ? (
                      <span
                        onClick={(e) => { e.stopPropagation(); toggleSelect(p.postId) }}
                        className="flex items-center justify-center flex-shrink-0"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          tabIndex={-1}
                          className="accent-[#34c759] w-3.5 h-3.5 pointer-events-none"
                          title={selectedPostIds.size >= BULK_INDEX_CAP && !isSelected ? `Bulk cap is ${BULK_INDEX_CAP}` : 'Tick to bulk-index this post'}
                        />
                      </span>
                    ) : (
                      <span className="w-3.5 flex-shrink-0" />
                    )}
                    {/* Bulk-run status badge — shown when a bulk run has
                        either recorded an outcome for this row OR has it
                        queued as pending. */}
                    {bulkOutcome && (
                      <span className="flex-shrink-0" title={`Bulk index: ${bulkOutcome}`}>
                        {bulkOutcome === 'submitted' && <CheckCircle size={13} className="text-[#34c759]" />}
                        {bulkOutcome === 'pending' && <Loader2 size={13} className="text-[#86868b] animate-spin" />}
                        {bulkOutcome === 'quota' && <AlertCircle size={13} className="text-[#ff9500]" />}
                        {bulkOutcome === 'forbidden' && <AlertCircle size={13} className="text-[#ff3b30]" />}
                        {bulkOutcome === 'failed' && <X size={13} className="text-[#ff3b30]" />}
                      </span>
                    )}
                    {open ? <ChevronDown size={14} className="text-[#86868b] flex-shrink-0" /> : <ChevronRight size={14} className="text-[#86868b] flex-shrink-0" />}
                    {/* score donut */}
                    <span className="flex items-center justify-center w-9 h-9 rounded-full text-[11px] font-bold flex-shrink-0" style={{ color: scoreColor(p.score), background: `${scoreColor(p.score)}1a` }}>
                      {p.score}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{p.title}</span>
                      <span className="block text-[11px] text-[#86868b] truncate">{failing.length === 0
                        ? 'All checks pass'
                        : autoFixable > 0
                          ? `${failing.length} to improve · ${autoFixable} auto-fixable`
                          : `${failing.length} to improve — manual edits`}</span>
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
                        className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-[#86868b] hover:text-[#7C3AED] disabled:opacity-60 flex-shrink-0"
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
                        className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-[#7C3AED] hover:underline flex-shrink-0"
                        title="Submit this post to Google for indexing — sends a request via Google's Indexing API (no manual Search Console step)"
                      >
                        Index <ExternalLink size={11} />
                      </button>
                    )}
                    {p.wordpressPostId && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setRebuildTarget(p); setRebuildUrl(''); setRebuildFeedback(''); setRebuildError(null) }}
                        className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-[#5856d6] hover:underline flex-shrink-0"
                        title="Paste the original YouTube URL — we'll rebuild this post's body from the transcript while keeping the same URL and indexing history"
                      >
                        <Youtube size={11} /> Rebuild
                      </button>
                    )}
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[#86868b] hover:text-[#7C3AED] flex-shrink-0" title="Open post">
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </button>
                  {open && (
                    <div className="px-4 pb-4 pl-12">
                      {(() => {
                        const fixableCount = p.checks.filter(c => isAutoFixable(p, c)).length
                        if (fixableCount < 2) return null  // a single fix → just use its own button
                        const busy = fixing === `${p.postId}:all`
                        return (
                          <button
                            onClick={() => runFix(p.postId, 'all')}
                            disabled={!!fixing}
                            className="mb-3 mr-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 transition-colors"
                          >
                            {busy ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} Fix all {fixableCount} automatically
                          </button>
                        )
                      })()}
                      {/* Inline outcome — the result/error lives RIGHT under the
                          buttons the user clicked, not in a banner at the top of
                          the page they can't see while scrolled down to a row.
                          Fixes (esp. FAQ generation + WP republish) can take ~30s,
                          so a clear "Applying…" state matters too. */}
                      {fixing?.startsWith(`${p.postId}:`) && (
                        <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-[#7C3AED]">
                          <Loader2 size={12} className="animate-spin" /> Applying fixes — this can take up to a minute…
                        </p>
                      )}
                      {fixMsg?.postId === p.postId && !fixing && (
                        <div className={`mb-3 flex items-start justify-between gap-3 px-3 py-2 rounded-lg text-xs ${fixMsg.ok ? 'bg-[#34c759]/10 text-[#1d1d1f] dark:text-[#f5f5f7] border border-[#34c759]/30' : 'bg-[#ff3b30]/5 text-[#ff3b30] border border-[#ff3b30]/30'}`}>
                          <span className="whitespace-pre-line">{fixMsg.text}</span>
                          <button onClick={() => setFixMsg(null)} className="flex-shrink-0 text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] mt-0.5"><X size={13} /></button>
                        </div>
                      )}
                      {/* Rebuild-from-video — for low-score / legacy posts where
                          the auto-fixer can't help (no comparison table, thin
                          body, fabricated patterns). Paste the YouTube URL and
                          we rebuild the body in place. Pro-only as of the
                          2026-06-04 tier restructure (server enforces too). */}
                      {p.wordpressPostId && canRebuild && (
                        <button
                          onClick={() => { setRebuildTarget(p); setRebuildUrl(''); setRebuildFeedback(''); setRebuildError(null) }}
                          className="mb-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#5856d6] hover:bg-[#4845b4] transition-colors"
                          title="Paste the original YouTube URL — we'll rebuild this post's body using the transcript while keeping the same URL"
                        >
                          <Youtube size={11} /> Rebuild from video
                        </button>
                      )}
                      {/* Manual title editor — the optional companion to the
                          one-click AI title fix. Some creators just want to
                          type the exact title themselves; this writes it
                          straight to WordPress and re-scores. Published posts
                          only (no WP post = nothing to update). */}
                      {p.wordpressPostId && (
                        <div className="mb-3 rounded-lg border border-[var(--border-2,#e5e5e7)] dark:border-white/10 px-3 py-2.5">
                          {titleDraft?.postId === p.postId ? (
                            <div className="flex flex-col gap-2">
                              <label className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Edit title</label>
                              <textarea
                                value={titleDraft.value}
                                onChange={e => setTitleDraft({ postId: p.postId, value: e.target.value })}
                                rows={2}
                                maxLength={200}
                                className="w-full resize-none rounded-md border border-[var(--border-2,#e5e5e7)] dark:border-white/15 bg-transparent px-2.5 py-1.5 text-xs text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:ring-1 focus:ring-[#7C3AED]"
                                placeholder="Type the exact title you want…"
                                autoFocus
                              />
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] ${titleDraft.value.trim().length > 65 || titleDraft.value.trim().length < 30 ? 'text-[#ff9500]' : 'text-[#34c759]'}`}>
                                  {titleDraft.value.trim().length} chars {titleDraft.value.trim().length < 30 ? '(aim 30–65)' : titleDraft.value.trim().length > 65 ? '(aim 30–65)' : '✓'}
                                </span>
                                <div className="ml-auto flex items-center gap-2">
                                  <button
                                    onClick={() => setTitleDraft(null)}
                                    disabled={savingTitle}
                                    className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-[#6e6e73] dark:text-[#ebebf0] hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-60"
                                  >Cancel</button>
                                  <button
                                    onClick={() => saveTitle(p.postId, titleDraft.value)}
                                    disabled={savingTitle || titleDraft.value.trim().length < 5}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60"
                                  >
                                    {savingTitle ? <Loader2 size={10} className="animate-spin" /> : null} Save title
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => setTitleDraft({ postId: p.postId, value: p.title || '' })}
                              className="flex items-center gap-1.5 text-[11px] font-semibold text-[#5856d6] hover:underline"
                            >
                              <Pencil size={11} /> Edit title manually
                            </button>
                          )}
                        </div>
                      )}
                      <ul className="flex flex-col gap-1.5">
                        {p.checks.filter(c => c.weight > 0).map(c => {
                          const fixable = isAutoFixable(p, c)
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
                                  onClick={() => runFix(p.postId, c.id as AutoFixId)}
                                  disabled={fixing === key}
                                  className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 transition-colors"
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

      {/* Rebuild-from-video modal — turn a low-score legacy post into a
          full MVP-quality post grounded in its source video. */}
      {rebuildTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => !rebuildStage && setRebuildTarget(null)}>
          <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 border-b border-gray-100 dark:border-white/10">
              <div className="flex-1 min-w-0 pr-3">
                <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
                  <Youtube size={18} className="text-[#5856d6]" /> Rebuild from video
                </h3>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-1 leading-relaxed">
                  Paste the YouTube URL that this post is about. We&apos;ll pull the transcript, rebuild the body in your voice, and push it back to the SAME post — the URL and Google indexing history stay intact.
                </p>
                <p className="text-[11px] text-[#86868b] mt-1.5 truncate">For: <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{rebuildTarget.title}</span></p>
              </div>
              <button onClick={() => !rebuildStage && setRebuildTarget(null)} disabled={!!rebuildStage} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] disabled:opacity-40 flex-shrink-0">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-4 overflow-y-auto">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#6e6e73] dark:text-[#8e8e93] mb-1.5">YouTube URL</label>
                <input
                  type="url"
                  value={rebuildUrl}
                  onChange={e => setRebuildUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                  disabled={!!rebuildStage}
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-sm text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#86868b] focus:outline-none focus:ring-2 focus:ring-[#5856d6] disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#6e6e73] dark:text-[#8e8e93] mb-1.5">Any guidance? (optional)</label>
                <textarea
                  value={rebuildFeedback}
                  onChange={e => setRebuildFeedback(e.target.value)}
                  placeholder="e.g. lead with the build quality, mention the included accessories, include a comparison vs the previous model"
                  rows={3}
                  disabled={!!rebuildStage}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-sm text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#86868b] focus:outline-none focus:ring-2 focus:ring-[#5856d6] disabled:opacity-60 resize-none"
                />
              </div>
              {rebuildError && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[#ff3b301a] text-[12px] text-[#ff3b30]">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{rebuildError}</span>
                </div>
              )}
              {rebuildStage && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[#5856d61a] text-[12px] text-[#5856d6]">
                  <Loader2 size={14} className="flex-shrink-0 mt-0.5 animate-spin" />
                  <span>
                    {rebuildStage === 'linking'
                      ? 'Linking the video to your post…'
                      : 'Rewriting the article from the transcript and pushing to WordPress (this takes about a minute)…'}
                  </span>
                </div>
              )}
              <p className="text-[11px] text-[#86868b] leading-relaxed">
                The same one-rewrite-per-post limit applies. Featured image is left as-is; in-body images are refreshed in the background after the text goes live.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100 dark:border-white/10">
              <button onClick={() => !rebuildStage && setRebuildTarget(null)} disabled={!!rebuildStage} className="btn-secondary text-sm">Cancel</button>
              <button onClick={submitRebuild} disabled={!!rebuildStage || !rebuildUrl.trim()} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#5856d6] hover:bg-[#4845b4] disabled:opacity-60 transition-colors">
                {rebuildStage ? <><Loader2 size={14} className="animate-spin" /> Rebuilding…</> : <><Youtube size={14} /> Rebuild post</>}
              </button>
            </div>
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
                  {bulkPreview.toFix} of {bulkPreview.total} posts have auto-fixable issues ({bulkPreview.totalFixes} fixes total). Each gets, as needed: title trimmed, internal links + alt text + FAQ added, an affiliate disclosure added, and the target keyword worked into the opening + a subhead — then republished. Nothing&apos;s saved yet.
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
                    <span className="text-xs font-semibold text-[#7C3AED] whitespace-nowrap mt-0.5">{row.fixes} fix{row.fixes !== 1 ? 'es' : ''}</span>
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
  const sitemapsUrl = gscSitemapsUrl(property)
  const pageIndexingUrl = gscPageIndexingUrl(property)
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
              <li><strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Google:</strong> slower, on Google’s own schedule. The <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Index</strong> button sends Google a direct request through its Indexing API — a strong nudge, but Google still decides when (and whether) to index. Days to a few weeks is normal, sometimes longer for a new site, so early statuses like “Not indexed”, “Still checking” or “URL unknown to Google” are expected — not a problem with your post.</li>
              <li>Impressions show up before clicks, so 0 clicks at the start is normal.</li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">How to get indexed by Google faster</p>
            <ol className="list-decimal pl-5 flex flex-col gap-2">
              <li>
                <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Submit your sitemap (one-time).</span> Open{' '}
                <a href={sitemapsUrl} target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline inline-flex items-center gap-0.5">Search Console → Sitemaps <ExternalLink size={11} /></a>, type <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-white/10 text-[12px]">wp-sitemap.xml</code> under “Add a new sitemap”, and click Submit. The status should read “Success” within a day. You only do this once.
              </li>
              <li>
                <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Nudge a priority post (optional, Pro).</span> Your posts already index on their own via the sitemap above — you don’t need to do anything. On <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Pro</strong>, you also get a manual accelerator: click <span className="font-semibold text-[#7C3AED] whitespace-nowrap">Index ↗</span> on a post and MVP sends Google a direct request through its <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Indexing API</strong> — no Search Console, no pasting. It’s capped at <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">2 a day</strong> (that quota is shared across all of MVP, so it’s deliberately small), and it’s a nudge, not a guarantee. Use it on the one or two posts you care most about; leave the rest to index naturally.
              </li>
              <li>
                <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Build links and momentum.</span> Share each post on the social channels you’ve connected — every share is a crawlable link back. Internal links are already handled (a “Related reviews” block is added to each post). Over time, a few real backlinks from other sites are the single biggest accelerator.
              </li>
              <li>
                <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Check what Google is actually seeing.</span> Open{' '}
                <a href={pageIndexingUrl} target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline inline-flex items-center gap-0.5">Search Console → Page indexing <ExternalLink size={11} /></a>{' '}
                for the real reason anything isn’t indexed. If you see a <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Not found (404)</strong> group, those are dead URLs still holding ranking history — export that list and{' '}
                <Link href="/tools/redirects" className="text-[#7C3AED] hover:underline">Fix 404s</Link>{' '}
                matches each one to the right live post and redirects it, so the history carries over instead of being lost.
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

/** Phase 3 GSC loop — "Missed demand". Queries the site already earns
 *  impressions for with NO post squarely targeting them (proven demand,
 *  zero coverage). Each row deep-links to Buying Guides with the query
 *  prefilled so acting on a gap is one click. Renders nothing while GSC
 *  has no qualifying data — silence beats an empty teaser. */
function QueryGapsCard() {
  const [gaps, setGaps] = useState<Array<{ query: string; impressions: number; clicks: number; position: number; bestPage: string | null }> | null>(null)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let alive = true
    fetch('/api/seo/query-gaps')
      .then(r => (r.ok ? r.json() : { gaps: [] }))
      .then(d => { if (alive) setGaps(Array.isArray(d?.gaps) ? d.gaps : []) })
      .catch(() => { if (alive) setGaps([]) })
    return () => { alive = false }
  }, [])

  // Loaded and empty → hide entirely (new sites / thin GSC data).
  if (gaps !== null && gaps.length === 0) return null

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-3 p-4 text-left">
        <div className="flex items-start gap-2.5">
          <Zap size={16} className="text-[#ff9500] mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Search demand you&rsquo;re missing</p>
            <p className="text-xs text-[#86868b]">Real Google queries your site already shows for, with no post that targets them. Proven demand — strong candidates for your next guides.</p>
          </div>
        </div>
        {open ? <ChevronDown size={16} className="shrink-0 text-[#86868b]" /> : <ChevronRight size={16} className="shrink-0 text-[#86868b]" />}
      </button>
      {open && (
        <div className="border-t border-gray-100 dark:border-white/10 divide-y divide-gray-100 dark:divide-white/10">
          {gaps === null ? (
            <div className="p-4 text-xs text-[#86868b] flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Mining Search Console for missed demand…
            </div>
          ) : gaps.map(g => (
            <div key={g.query} className="p-3 px-4 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[220px]">
                <p className="text-sm font-medium text-gray-900 dark:text-white">&ldquo;{g.query}&rdquo;</p>
                <p className="text-[11px] text-[#86868b]">
                  {g.impressions.toLocaleString()} impressions (28d)
                  {' · '}{g.clicks === 0 ? 'no clicks yet' : `${g.clicks} click${g.clicks === 1 ? '' : 's'}`}
                  {' · '}best position {g.position}
                </p>
              </div>
              <Link
                href={`/buying-guides?topic=${encodeURIComponent(g.query)}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] transition-colors"
              >
                Write a guide for this →
              </Link>
            </div>
          ))}
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
  // indexed === null → we simply haven't looked yet (the daily sweep checks
  // automatically, or the user can click Check). Frame it as a neutral
  // not-yet-checked state, never an alarming "Unknown".
  return <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-[#86868b] flex-shrink-0" title="Indexing status is checked automatically overnight — or click Check to look now."><RefreshCw size={11} /> Not checked yet</span>
}
