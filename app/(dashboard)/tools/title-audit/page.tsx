// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// /tools/title-audit — catch WagComb-class title hallucinations already
// published in production. factCheckTitleVsBody runs at generation time
// but doesn't retroactively fix posts created before that check shipped.
// This page walks the user's entire blog_posts archive, identifies
// mismatches, and lets them one-click apply each correction (or
// bulk-apply all). Moved from /admin to /tools 2026-06-07 — opened to
// Creator+ since title hallucinations hurt the user's site, not ours.
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { Loader2, AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, ChevronLeft, ShieldCheck } from 'lucide-react'

interface Mismatch {
  postId: string
  videoId: string | null
  oldTitle: string
  newTitle: string
  wordpressPostId: number | null
  wordpressUrl: string
  preview: string
}

interface ScanState {
  scanning: boolean
  scannedCount: number
  totalCount: number | null
  nextOffset: number
  hasMore: boolean
  mismatches: Mismatch[]
  startedAt: number | null
}

export default function TitleAuditPage() {
  const [scan, setScan] = useState<ScanState>({
    scanning: false,
    scannedCount: 0,
    totalCount: null,
    nextOffset: 0,
    hasMore: true,
    mismatches: [],
    startedAt: null,
  })
  const [applied, setApplied] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Record<string, string>>({})

  async function runScan() {
    setScan(prev => ({ ...prev, scanning: true, mismatches: [], scannedCount: 0, nextOffset: 0, hasMore: true, startedAt: Date.now() }))
    setApplied(new Set())
    let offset = 0
    let allMismatches: Mismatch[] = []
    let totalCount: number | null = null
    let scanned = 0
    try {
      while (true) {
        const res = await fetch('/api/tools/title-audit/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // 40-post batches — the scan endpoint now parallelizes the
          // Haiku checks so a batch finishes in ~3-5s regardless of size.
          // Larger batches = fewer round-trips.
          body: JSON.stringify({ limit: 40, offset }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || `Scan failed (${res.status})`)
        }
        const j = await res.json() as { mismatches: Mismatch[]; scannedCount: number; totalCount: number | null; hasMore: boolean; nextOffset: number }
        allMismatches = [...allMismatches, ...j.mismatches]
        scanned += j.scannedCount
        if (j.totalCount != null) totalCount = j.totalCount
        offset = j.nextOffset
        setScan({
          scanning: true,
          scannedCount: scanned,
          totalCount,
          nextOffset: offset,
          hasMore: j.hasMore,
          mismatches: allMismatches,
          startedAt: scan.startedAt,
        })
        if (!j.hasMore) break
      }
      setScan(prev => ({ ...prev, scanning: false }))
      toast.success(`Scan complete — ${allMismatches.length} mismatch${allMismatches.length === 1 ? '' : 'es'} found out of ${scanned} post${scanned === 1 ? '' : 's'}`)
    } catch (e) {
      setScan(prev => ({ ...prev, scanning: false }))
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  async function applyOne(m: Mismatch) {
    const finalTitle = (editing[m.postId] ?? m.newTitle).trim()
    if (!finalTitle) {
      toast.error('Title cannot be empty')
      return
    }
    setApplying(prev => new Set(prev).add(m.postId))
    try {
      const res = await fetch('/api/tools/title-audit/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: m.postId, newTitle: finalTitle }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Failed (${res.status})`)
      }
      setApplied(prev => new Set(prev).add(m.postId))
      toast.success('Title updated on WordPress + DB')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setApplying(prev => {
        const next = new Set(prev)
        next.delete(m.postId)
        return next
      })
    }
  }

  async function applyAll() {
    const pending = scan.mismatches.filter(m => !applied.has(m.postId))
    if (pending.length === 0) return
    if (!confirm(`Apply ${pending.length} title fixes? This updates WordPress + your DB. Cannot be undone via this page.`)) return
    for (const m of pending) {
      // Serial — keeps WP REST from rate-limiting and surfaces errors per row.
      // eslint-disable-next-line no-await-in-loop
      await applyOne(m)
    }
  }

  const remaining = scan.mismatches.filter(m => !applied.has(m.postId)).length

  return (
    <div>
      <PageHero
        title="Title accuracy check"
        subtitle="Find published posts whose title names the wrong product — then fix each title in one click, without touching the rest of the post."
      />

      <Link
        href="/seo"
        className="inline-flex items-center gap-1 text-xs font-medium text-[#7C3AED] hover:underline mb-4"
      >
        <ChevronLeft size={13} /> Back to SEO &amp; Indexing
      </Link>

      {/* What this is + why it's here — written for the creator, not for us.
          The old subtitle leaned on internal jargon ("WagComb-class
          hallucination"); this explains the actual problem and reassures that
          nothing changes until they click Apply. */}
      <div className="mb-6 rounded-xl border border-[#7C3AED]/20 bg-[#7C3AED]/5 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck size={20} className="text-[#7C3AED] flex-shrink-0 mt-0.5" />
          <div className="space-y-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]">
            <p className="font-semibold">What this checks — and why it&apos;s here</p>
            <p className="text-[#3a3a3c] dark:text-[#d1d1d6] leading-relaxed">
              Once in a while a post&apos;s <strong>title</strong> can name a product the article isn&apos;t actually about — for example, the title says one model while the review covers another. It&apos;s rare, and it mostly shows up on older posts published before MVP started fact-checking every title as it&apos;s written.
            </p>
            <p className="text-[#3a3a3c] dark:text-[#d1d1d6] leading-relaxed">
              A wrong product in the title is the most damaging title problem to leave live: it misleads readers, kills your click-through from Google, and can get the page demoted in search. This keeps your titles honest — always matching what&apos;s actually on the page.
            </p>
            <p className="text-[#3a3a3c] dark:text-[#d1d1d6] leading-relaxed">
              <strong>How it works:</strong> hit <em>Run scan</em> — MVP reads each post&apos;s title against its body and flags only genuine mismatches. For each one you get a corrected title you can edit first, then apply with one click; it updates WordPress and your library together. <strong>Nothing changes until you click Apply.</strong>
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button
          onClick={runScan}
          disabled={scan.scanning}
          className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-60 transition-colors"
        >
          {scan.scanning
            ? <><Loader2 size={12} className="animate-spin" /> Scanning {scan.scannedCount}{scan.totalCount ? `/${scan.totalCount}` : ''}…</>
            : <><RefreshCw size={12} /> Run scan</>
          }
        </button>
        {scan.mismatches.length > 0 && !scan.scanning && (
          <button
            onClick={applyAll}
            disabled={remaining === 0}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-[#34c759]/40 bg-[#34c759]/5 text-[#1f8a3a] hover:bg-[#34c759]/10 disabled:opacity-60 transition-colors"
          >
            <CheckCircle2 size={12} /> Apply all {remaining}
          </button>
        )}
        {scan.mismatches.length > 0 && (
          <span className="text-xs text-[#86868b] dark:text-[#8e8e93]">
            {scan.mismatches.length} mismatch{scan.mismatches.length === 1 ? '' : 'es'} · {applied.size} applied · {remaining} pending
          </span>
        )}
      </div>

      {scan.mismatches.length === 0 && !scan.scanning && scan.scannedCount > 0 && (
        <div className="mt-6 card p-6 text-center border-[#34c759]/30 bg-[#34c759]/5">
          <CheckCircle2 size={24} className="mx-auto text-[#34c759]" />
          <p className="mt-2 text-sm font-semibold text-[#34c759]">No mismatches found</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-1">
            Scanned {scan.scannedCount} post{scan.scannedCount === 1 ? '' : 's'}. Every title matches its body.
          </p>
        </div>
      )}

      {scan.mismatches.length > 0 && (
        <div className="mt-6 flex flex-col gap-3">
          {scan.mismatches.map(m => {
            const isApplied = applied.has(m.postId)
            const isApplying = applying.has(m.postId)
            const editedTitle = editing[m.postId] ?? m.newTitle
            return (
              <div
                key={m.postId}
                className={`card p-4 ${isApplied ? 'border-[#34c759]/30 bg-[#34c759]/5' : 'border-[#ff9500]/30 bg-[#ff9500]/5'}`}
              >
                <div className="flex items-start gap-3">
                  {isApplied
                    ? <CheckCircle2 size={16} className="text-[#34c759] flex-shrink-0 mt-0.5" />
                    : <AlertTriangle size={16} className="text-[#ff9500] flex-shrink-0 mt-0.5" />
                  }
                  <div className="flex-1 min-w-0 space-y-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93]">Current title</p>
                      <p className="text-sm font-semibold text-[#ff3b30] line-through decoration-2 decoration-[#ff3b30]/50">{m.oldTitle}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93]">Suggested title (edit before applying if you want)</p>
                      <input
                        type="text"
                        value={editedTitle}
                        disabled={isApplied || isApplying}
                        onChange={e => setEditing(prev => ({ ...prev, [m.postId]: e.target.value }))}
                        className="w-full px-2 py-1.5 text-sm font-semibold rounded border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:border-[#7C3AED] disabled:opacity-60"
                      />
                    </div>
                    <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] italic">&ldquo;{m.preview}…&rdquo;</p>
                    <div className="flex items-center gap-3 pt-1">
                      <a
                        href={m.wordpressUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[#7C3AED] hover:underline inline-flex items-center gap-1"
                      >
                        <ExternalLink size={11} /> Open post
                      </a>
                      {!isApplied && (
                        <button
                          onClick={() => applyOne(m)}
                          disabled={isApplying}
                          className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md bg-[#34c759] text-white hover:bg-[#2db34a] disabled:opacity-60 transition-colors"
                        >
                          {isApplying
                            ? <><Loader2 size={11} className="animate-spin" /> Applying…</>
                            : <><CheckCircle2 size={11} /> Apply this fix</>
                          }
                        </button>
                      )}
                      {isApplied && (
                        <span className="text-xs text-[#34c759] inline-flex items-center gap-1">
                          <CheckCircle2 size={11} /> Applied
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {scan.scannedCount === 0 && !scan.scanning && (
        <div className="mt-8 card p-6 text-center">
          <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7]">Click <strong>Run scan</strong> to walk your archive.</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-1">
            Each post costs one Haiku call (~$0.0001). For 126 posts: roughly $0.013 + ~20 seconds (parallel scan).
          </p>
        </div>
      )}
    </div>
  )
}
