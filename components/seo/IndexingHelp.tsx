'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET YOUR POSTS INTO GOOGLE (Seb, 2026-10-11). Three things, each something
// the creator can act on from here:
//   1. Your sitemap: submitted or not, read back from Search Console.
//   2. Where today's Request indexing list is: the board's stage plans
//      (one list on the page, 2026-10-12).
//   3. Every reason Google gives for a post, with what it means and what to do,
//      and a decoder for Search Console's "Validation failed" reports.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Check, AlertTriangle, Copy, Loader2, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { reasonGuide, REPORT_GUIDE, REQUESTS_PER_DAY, type Severity } from '@/lib/indexing-help'
import { gscSitemapsUrl } from '@/lib/gsc-links'
import { readRequested, REQUESTED_EVENT } from '@/lib/gsc-request-client'
import RequestIndexingButton from '@/components/seo/RequestIndexingButton'

type Post = { postId: string; title: string; url: string | null; indexed: boolean | null; coverageState: string | null }
type SitemapRow = { path: string; lastSubmitted: string | null; lastDownloaded: string | null; pending: boolean; errors: number; warnings: number; urls: number }

const TONE: Record<Severity, { dot: string; word: string }> = {
  urgent: { dot: '#ff3b30', word: 'Fix now' },
  fix: { dot: '#ff9500', word: 'Fix' },
  wait: { dot: '#5856d6', word: 'Help it along' },
  fine: { dot: '#8e8e93', word: 'Nothing to do' },
}

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const d = Math.round((Date.now() - Date.parse(iso)) / 86_400_000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}

export default function IndexingHelp({ property, posts, blogUrl }: { property: string | null; posts: Post[]; blogUrl: string | null }) {
  const [sm, setSm] = useState<{ sitemaps: SitemapRow[]; error?: string } | null>(null)
  const [requested, setRequested] = useState<Record<string, string>>({})
  const [openReason, setOpenReason] = useState<string | null>(null)
  const [showDecoder, setShowDecoder] = useState(false)

  // Requests made from the per-post board count here too.
  useEffect(() => {
    const sync = () => setRequested(readRequested())
    sync()
    window.addEventListener(REQUESTED_EVENT, sync)
    return () => window.removeEventListener(REQUESTED_EVENT, sync)
  }, [])
  useEffect(() => {
    fetch('/api/seo/sitemap-status', { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
      .then((r) => r.json())
      .then((d) => setSm({ sitemaps: Array.isArray(d.sitemaps) ? d.sitemaps : [], error: d.error }))
      .catch(() => setSm({ sitemaps: [], error: 'MVP could not ask Search Console about your sitemap just now.' }))
  }, [])

  // Google's own link (a hand-built inspect link opened Google's 404); the
  // shared helper opens it and remembers the request for a week.
  const requestedToday = Object.values(requested).filter((t) => Date.now() - Date.parse(t) < 86_400_000).length

  // Every post not in Google, grouped by Google's reason.
  const groups = useMemo(() => {
    const m = new Map<string, { guide: ReturnType<typeof reasonGuide>; posts: Post[] }>()
    for (const p of posts) {
      if (p.indexed !== false) continue
      const g = reasonGuide(p.coverageState)
      const cur = m.get(g.label) ?? { guide: g, posts: [] }
      cur.posts.push(p)
      m.set(g.label, cur)
    }
    const order: Record<Severity, number> = { urgent: 0, fix: 1, wait: 2, fine: 3 }
    return [...m.values()].sort((a, b) => order[a.guide.severity] - order[b.guide.severity] || b.posts.length - a.posts.length)
  }, [posts])

  const sitemapAddress = blogUrl ? `${blogUrl.replace(/\/+$/, '')}/wp-sitemap.xml` : 'yourblog.com/wp-sitemap.xml'
  const submitted = sm?.sitemaps ?? []
  const smOk = submitted.length > 0 && submitted.every((s) => s.errors === 0)

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-white/10">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Get your posts into Google</p>
        <p className="text-xs text-[#86868b] mt-0.5">What Google itself says about your posts, read from Search Console. Google decides what it keeps; these three things are what move it.</p>
      </div>

      {/* 1. Sitemap */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-white/10 flex flex-col gap-1.5">
        <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">1. Your sitemap</p>
        {sm === null ? (
          <p className="text-xs text-[#86868b] inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Asking Search Console…</p>
        ) : sm.error && submitted.length === 0 ? (
          <p className="text-xs text-[#ff9500]">{sm.error}</p>
        ) : submitted.length === 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-[#ff3b30] inline-flex items-center gap-1"><AlertTriangle size={12} /> No sitemap is submitted to Google. This is the list Google uses to find every post, so do this first, once.</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-[11px] px-2 py-1 rounded bg-black/5 dark:bg-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]">{sitemapAddress}</code>
              <button onClick={() => { void navigator.clipboard?.writeText(sitemapAddress); toast.success('Sitemap address copied') }} className="text-[11px] font-medium text-[#7C3AED] inline-flex items-center gap-1 hover:underline"><Copy size={11} /> Copy</button>
              <a href={gscSitemapsUrl(property)} target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium text-[#7C3AED] inline-flex items-center gap-1 hover:underline">Open Sitemaps in Search Console <ExternalLink size={11} /></a>
            </div>
            <p className="text-[11px] text-[#86868b]">Paste the address in &quot;Add a new sitemap&quot; and press Submit. MVP checks it again the next time you open this page.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {submitted.map((s) => (
              <p key={s.path} className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] inline-flex flex-wrap items-center gap-1.5">
                {s.errors === 0 ? <Check size={12} className="text-[#34c759]" /> : <AlertTriangle size={12} className="text-[#ff3b30]" />}
                <span className="font-medium break-all">{s.path}</span>
                <span className="text-[#86868b]">
                  · submitted {ago(s.lastSubmitted)} · Google last read it {s.pending ? 'never yet (pending)' : ago(s.lastDownloaded)}
                  {s.urls ? ` · ${s.urls.toLocaleString()} addresses` : ''}
                  {s.errors ? ` · ${s.errors} error${s.errors === 1 ? '' : 's'}` : ''}{s.warnings ? ` · ${s.warnings} warning${s.warnings === 1 ? '' : 's'}` : ''}
                </span>
              </p>
            ))}
            <p className="text-[11px] text-[#86868b]">{smOk ? 'Good. Nothing to do here: Google re-reads it by itself.' : 'Google found problems in your sitemap. Open it in Search Console to see which.'} <a href={gscSitemapsUrl(property)} target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">Sitemaps in Search Console</a></p>
          </div>
        )}
      </div>

      {/* 2. Request indexing: one list on the page (2026-10-12). It used to
          be here AND in each stage of the board, two lists picking differently.
          It lives in the board's stage plans now; this says where. */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-white/10 flex flex-col gap-1.5">
        <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">2. Ask Google to read your posts</p>
        <p className="text-xs text-[#4b4b4f] dark:text-[#b0b0b5]">Google lets you ask about {REQUESTS_PER_DAY} pages a day, by hand in Search Console: no tool can press it for you. Today&apos;s list is in <b>What each post needs</b>, inside the plan for each stage, with the posts that have a path in first.{requestedToday > 0 ? ` You have opened ${requestedToday} in the last day.` : ''}</p>
        <button onClick={() => document.getElementById('seo-board')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="self-start text-[12px] font-semibold text-[#7C3AED] hover:underline">Go to today&apos;s list</button>
      </div>

      {/* 3. Why each post is not in Google */}
      <div className="px-4 py-3 flex flex-col gap-2">
        <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">3. What Google says about each post, and what to do</p>
        {groups.length === 0 ? (
          <p className="text-xs text-[#34c759]">Every post MVP has checked is in Google.</p>
        ) : groups.map(({ guide, posts: ps }) => (
          <div key={guide.label} className="rounded-lg border border-gray-100 dark:border-white/10">
            <button onClick={() => setOpenReason(openReason === guide.label ? null : guide.label)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: TONE[guide.severity].dot }} />
              <span className="text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] flex-1">{guide.label}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: TONE[guide.severity].dot }}>{TONE[guide.severity].word}</span>
              <span className="text-[13px] font-semibold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7] w-8 text-right">{ps.length}</span>
              <ChevronDown size={14} className={`text-[#86868b] transition-transform ${openReason === guide.label ? 'rotate-180' : ''}`} />
            </button>
            {openReason === guide.label && (
              <div className="px-3 pb-3 flex flex-col gap-1.5">
                <p className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7]"><b>What it means:</b> {guide.means}</p>
                <p className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7]"><b>What to do:</b> {guide.todo}</p>
                <p className="text-[11px] text-[#86868b]">{guide.validate ? 'Once fixed, pressing Validate fix in Search Console is worth it.' : 'Do not press Validate fix for this one: it cannot pass, and failing it does no harm.'}</p>
                {guide.tool && <Link href={guide.tool.href} className="text-[11px] font-medium text-[#7C3AED] hover:underline self-start">Open {guide.tool.label} →</Link>}
                <div className="flex flex-col mt-1">
                  {ps.slice(0, 15).map((p) => (
                    <div key={p.postId} className="flex items-center flex-wrap gap-x-2 gap-y-1 py-1">
                      <span className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7] flex-1 min-w-0 truncate">{p.title}</span>
                      {p.url && <RequestIndexingButton url={p.url} property={property} small label="Inspect in Google" />}
                    </div>
                  ))}
                  {ps.length > 15 && <p className="text-[10px] text-[#86868b]">and {ps.length - 15} more</p>}
                </div>
              </div>
            )}
          </div>
        ))}

        <button onClick={() => setShowDecoder((v) => !v)} className="self-start text-[12px] font-medium text-[#7C3AED] hover:underline inline-flex items-center gap-1 mt-1">
          Search Console says &quot;Validation failed&quot;? What each report means <ChevronDown size={12} className={showDecoder ? 'rotate-180' : ''} />
        </button>
        {showDecoder && (
          <div className="flex flex-col gap-2">
            {REPORT_GUIDE.map((r) => (
              <div key={r.report} className="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2">
                <p className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{r.report}</p>
                <p className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7] mt-0.5">{r.yours}</p>
                <p className="text-[11px] text-[#86868b] mt-0.5">{r.validate}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
