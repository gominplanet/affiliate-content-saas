'use client'

/**
 * Newsletter compose page — pick posts, add a personal message + curated
 * links, let Claude draft it, preview, send.
 *
 * Flow:
 *   1. Step 1: pick blog posts (multi-select with thumbnails) + write
 *      personal message + add curated links.
 *   2. Click "Draft email" → POST /api/newsletter/draft → Claude
 *      generates subject + intro + per-post blurbs + outro.
 *   3. Step 2: edit the generated copy if desired (subject + intro +
 *      outro + per-post blurbs all editable). Preview iframe renders
 *      the actual email HTML.
 *   4. Click "Send to all subscribers" → confirms with recipient count
 *      → POST /api/newsletter/send → returns broadcast id + sent count.
 *
 * One-page intentionally — splitting compose/preview into separate
 * routes would lose draft state on navigation. Heavy iframe preview is
 * scoped with sandbox="allow-same-origin" so external links can't
 * exfiltrate session cookies if any draft slipped a script tag in.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import PageHero from '@/components/layout/PageHero'
import { useModalA11y } from '@/components/ui/useModalA11y'
import {
  Loader2, AlertCircle, CheckCircle, Sparkles, Send, ChevronLeft,
  Plus, X, Image as ImageIcon, MessageCircle, Search, ExternalLink, Tag,
} from 'lucide-react'

interface PickablePost {
  id: string
  title: string
  /** ≤ 100-word summary — the route trims the blog_posts.excerpt to fit. */
  summary: string
  url: string
  thumbnail: string | null
  /** First product-like URL scraped from the source video's description —
   *  usually a Geniuslink or Amazon URL. Null when nothing useful is in
   *  the description. */
  productUrl: string | null
  publishedAt: string | null
  youtubeVideoId: string | null
}

interface DraftPostBlock {
  id?: string
  url: string
  title: string
  excerpt: string
  imageUrl?: string | null
  blurb?: string | null
}

interface DraftCuratedLink {
  url: string
  label?: string | null
  blurb: string
}

interface Draft {
  subject: string
  intro: string
  outro: string
  personalMessage: string | null
  posts: DraftPostBlock[]
  curatedLinks: DraftCuratedLink[]
  html: string
  plainText: string
  brand: {
    name: string
    siteUrl: string | null
    logoUrl: string | null
    mailingAddress: string | null
    byline: string | null
  }
}

export default function NewsletterComposePage() {
  const [posts, setPosts] = useState<PickablePost[]>([])
  const [postsLoading, setPostsLoading] = useState(true)
  const [pickedIds, setPickedIds] = useState<string[]>([])
  // Once a post is picked we keep its full record around in case the
  // user searches for something else after — search results replace
  // `posts`, but the picker UI needs the picked rows to stay rendered
  // (with their checkbox stuck "checked") even if they're no longer in
  // the current search hits.
  const [pickedDetail, setPickedDetail] = useState<Record<string, PickablePost>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [personalMessage, setPersonalMessage] = useState('')
  const [curated, setCurated] = useState<Array<{ url: string; label: string; blurb: string }>>([])
  const [activeSubs, setActiveSubs] = useState<number | null>(null)

  const [drafting, setDrafting] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)

  const [sending, setSending] = useState(false)
  // sentResult now also carries the response from A/B and scheduled sends
  // so the success screen can show different copy per mode.
  const [sentResult, setSentResult] = useState<
    | { mode: 'sent'; recipients: number; sent: number; failed: number }
    | { mode: 'ab_testing'; sampleA: number; sampleB: number; holdback: number; finalizeAt: string }
    | { mode: 'scheduled'; scheduledAt: string; recipients: number }
    | null
  >(null)
  const [sendError, setSendError] = useState<string | null>(null)
  // Send confirmation modal — replaces window.confirm() (which Safari
  // content-blockers + email-extension blockers can silently swallow,
  // causing an accidental blast to every subscriber). The user must
  // explicitly type SEND to enable the confirm button. 2026-06-02 audit fix.
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTyped, setConfirmTyped] = useState('')

  // ── A/B testing (migration 090) ────────────────────────────────────────────
  // When abEnabled is true and subjectB is non-empty, the send route runs
  // an A/B test: sample of recipients gets subject A, sample gets subject
  // B, the cron fires the winning subject to the holdback once the test
  // window passes.
  const [abEnabled, setAbEnabled] = useState(false)
  const [subjectB, setSubjectB] = useState('')
  const [samplePct, setSamplePct] = useState(20)
  const [testHours, setTestHours] = useState(2)

  // ── Scheduling ────────────────────────────────────────────────────────────
  // When scheduleEnabled and scheduledAt is in the future, the send route
  // persists the broadcast in 'scheduled' state. The newsletter-process cron
  // fires it at the scheduled time.
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')   // 'YYYY-MM-DDTHH:mm' local

  // ── Segmentation ──────────────────────────────────────────────────────────
  // When segmentEnabled, the send route narrows recipients by source /
  // signup date / tags. Tags are user-defined free-text labels on
  // subscribers (e.g. 'paying', 'lead').
  const [segmentEnabled, setSegmentEnabled] = useState(false)
  const [segSource, setSegSource] = useState<'all' | 'blog_form' | 'csv_import' | 'manual'>('all')
  const [segSignedUpAfter, setSegSignedUpAfter] = useState('')
  const [segTagsRaw, setSegTagsRaw] = useState('')      // comma-separated

  // Available tags for autocomplete — loaded from /api/newsletter/subscribers.
  const [availableTags, setAvailableTags] = useState<string[]>([])

  // ── Initial load: latest 10 posts + active sub count ──────────────────────
  useEffect(() => {
    void (async () => {
      try {
        const [pRes, sRes] = await Promise.all([
          fetch('/api/newsletter/blog-posts'),
          fetch('/api/newsletter/subscribers'),
        ])
        const pData = await pRes.json()
        const sData = await sRes.json()
        if (pRes.ok) setPosts(pData.posts || [])
        if (sRes.ok) {
          setActiveSubs(sData?.counts?.active ?? 0)
          if (Array.isArray(sData?.knownTags)) setAvailableTags(sData.knownTags)
        }
      } finally {
        setPostsLoading(false)
      }
    })()
  }, [])

  // ── Debounced server-side search across the entire catalogue ──────────────
  // Empty query → reload the latest 10. Non-empty → fire to the API with
  // ?q= so PostgREST runs the ilike — works for any catalogue size, no
  // need to load every post into memory just to filter.
  useEffect(() => {
    const handle = setTimeout(() => {
      void (async () => {
        setPostsLoading(true)
        try {
          const url = searchQuery.trim()
            ? `/api/newsletter/blog-posts?q=${encodeURIComponent(searchQuery.trim())}`
            : '/api/newsletter/blog-posts'
          const r = await fetch(url)
          const d = await r.json()
          if (r.ok) setPosts(d.posts || [])
        } finally {
          setPostsLoading(false)
        }
      })()
    }, 280)
    return () => clearTimeout(handle)
  }, [searchQuery])

  // When the user ticks a post, snapshot its detail so it stays available
  // even if a subsequent search filters it out of `posts`.
  function togglePick(p: PickablePost) {
    setPickedIds(prev => {
      const isPicked = prev.includes(p.id)
      if (isPicked) return prev.filter(id => id !== p.id)
      return [...prev, p.id]
    })
    setPickedDetail(prev => ({ ...prev, [p.id]: p }))
  }

  // ── Edit handlers (manual tweaks AFTER Claude drafts) ──────────────────────
  // Each editor field re-renders the preview via a setter that re-builds
  // the iframe srcDoc from the structured fields, NOT by re-running the
  // server. That's instant + free. Same shape /api/newsletter/draft returns,
  // just with the user's edits applied.
  const updateDraft = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft(prev => (prev ? { ...prev, [key]: value } : prev))
  }, [])

  // ── Step 1 → 2: ask the server to draft ────────────────────────────────────
  async function handleDraft() {
    setDrafting(true)
    setDraftError(null)
    setSentResult(null)
    setSendError(null)
    try {
      const r = await fetch('/api/newsletter/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blogPostIds: pickedIds,
          personalMessage: personalMessage || undefined,
          curatedLinks: curated
            .filter(c => c.url.trim() && c.blurb.trim())
            .map(c => ({ url: c.url.trim(), label: c.label.trim() || undefined, blurb: c.blurb.trim() })),
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Draft failed')
      setDraft(d.draft as Draft)
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Draft failed')
    } finally {
      setDrafting(false)
    }
  }

  // ── Send ───────────────────────────────────────────────────────────────────
  // Opens the type-SEND-to-confirm modal. The actual send fires from
  // confirmSend() once the user types SEND and clicks Send.
  function handleSend() {
    if (!draft) return
    setConfirmTyped('')
    setConfirmOpen(true)
  }

  async function confirmSend() {
    if (!draft) return
    setConfirmOpen(false)
    setSending(true)
    setSendError(null)
    try {
      // Build the optional A/B + schedule + segment payload. Send route is
      // mode-aware: subject_b triggers A/B, scheduled_at triggers queue,
      // segment_filter narrows recipients in either mode.
      const payload: Record<string, unknown> = {
        subject: draft.subject,
        intro: draft.intro,
        outro: draft.outro,
        personalMessage: draft.personalMessage,
        posts: draft.posts,
        curatedLinks: draft.curatedLinks,
      }
      if (abEnabled && subjectB.trim()) {
        payload.subject_b = subjectB.trim()
        payload.ab_sample_pct = samplePct
        payload.ab_test_hours = testHours
      }
      if (scheduleEnabled && scheduledAt) {
        // <input type='datetime-local'> gives the user's local time without
        // timezone — convert to ISO via Date constructor (which interprets
        // the string as local time on the user's machine).
        const iso = new Date(scheduledAt).toISOString()
        payload.scheduled_at = iso
      }
      if (segmentEnabled) {
        const filter: Record<string, unknown> = {}
        if (segSource !== 'all') filter.source = segSource
        if (segSignedUpAfter) filter.signedUpAfter = new Date(segSignedUpAfter).toISOString()
        const tags = segTagsRaw.split(',').map(s => s.trim()).filter(Boolean)
        if (tags.length > 0) filter.tags = tags
        if (Object.keys(filter).length > 0) payload.segment_filter = filter
      }

      const r = await fetch('/api/newsletter/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Send failed')
      if (d.mode === 'scheduled') {
        setSentResult({ mode: 'scheduled', scheduledAt: d.scheduledAt, recipients: d.recipients })
      } else if (d.mode === 'ab_testing') {
        setSentResult({
          mode: 'ab_testing',
          sampleA: d.sample?.aSize ?? 0,
          sampleB: d.sample?.bSize ?? 0,
          holdback: d.sample?.holdback ?? 0,
          finalizeAt: d.finalizeAt,
        })
      } else {
        setSentResult({ mode: 'sent', recipients: d.recipients, sent: d.sent, failed: d.failed })
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  // Preview iframe — same-origin-only sandbox so an injected script can't
  // exfil. srcDoc re-renders whenever the draft changes.
  const previewRef = useRef<HTMLIFrameElement | null>(null)

  // ── Successful send: show victory state ────────────────────────────────────
  if (sentResult) {
    const headline =
      sentResult.mode === 'scheduled' ? "It's queued."
      : sentResult.mode === 'ab_testing' ? "Test is live."
      : "It's on the way."
    const body =
      sentResult.mode === 'scheduled'
        ? (
          <>
            Queued for {new Date(sentResult.scheduledAt).toLocaleString()} —{' '}
            <strong>{sentResult.recipients}</strong> matching subscribers at fire-time. You'll see the
            broadcast row on /newsletter once it goes out.
          </>
        )
        : sentResult.mode === 'ab_testing'
        ? (
          <>
            Subject A → <strong>{sentResult.sampleA}</strong> subscribers · subject B → <strong>{sentResult.sampleB}</strong>.{' '}
            The winning subject will go out to the remaining <strong>{sentResult.holdback}</strong> at{' '}
            {new Date(sentResult.finalizeAt).toLocaleString()}.
          </>
        )
        : (
          <>
            Sent to <strong>{sentResult.sent}</strong> of <strong>{sentResult.recipients}</strong> subscribers
            {sentResult.failed > 0 && <span className="text-[#ff9500]"> ({sentResult.failed} errored — check the dashboard for details)</span>}.
          </>
        )
    return (
      <>
        <PageHero title={
          sentResult.mode === 'scheduled' ? 'Newsletter scheduled'
          : sentResult.mode === 'ab_testing' ? 'A/B test sent'
          : 'Newsletter sent'
        } />
        <div className="max-w-xl mx-auto card p-8 text-center">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-[#34c759]/10 flex items-center justify-center">
            <CheckCircle size={26} className="text-[#34c759]" />
          </div>
          <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">{headline}</h2>
          <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mb-5">{body}</p>
          <div className="flex items-center gap-2 justify-center">
            <Link href="/newsletter" className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9]">Back to newsletter</Link>
            <button onClick={() => { setDraft(null); setSentResult(null); setPickedIds([]); setPersonalMessage(''); setCurated([]) }} className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 dark:border-white/10">Compose another</button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHero
        title="Compose newsletter"
        subtitle={activeSubs !== null ? `Sending to ${activeSubs} active subscribers.` : 'Pick posts, write a quick note, send.'}
      />

      <div className="mb-4">
        <Link href="/newsletter" className="inline-flex items-center gap-1 text-xs text-[#86868b] hover:text-[#7C3AED]">
          <ChevronLeft size={12} /> Back to newsletter
        </Link>
      </div>

      {/* ── Step 1: pick + write ── */}
      {!draft && (
        <>
          {/* Posts picker — search across the whole blog, default to the
              latest 10. Picked posts stay rendered at the top even if the
              user searches away from them. Each card shows the video
              thumbnail, the ≤100-word summary, and a "View product" link
              when we found a Geniuslink/Amazon URL in the source video's
              description. */}
          <div className="card p-5 mb-5">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">1. Pick posts for this issue</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-3">Search the entire blog or scroll the most-recent 10. Each picked post gets its own card with a thumbnail + a one-sentence &quot;why&quot; MVP writes for you.</p>

            <div className="relative mb-3">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b]" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by title or summary…"
                className="w-full text-sm pl-8 pr-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
            </div>

            {/* Already-picked list — kept at the top so the user always
                sees the issue they're building, even if their next search
                doesn't include those posts in its hits. */}
            {pickedIds.length > 0 && (
              <div className="mb-3 p-3 rounded-lg bg-[#7C3AED]/5 border border-[#7C3AED]/20">
                <p className="text-[11px] font-semibold text-[#7C3AED] uppercase tracking-wide mb-2">{pickedIds.length} picked for this issue</p>
                <div className="flex flex-col gap-1.5">
                  {pickedIds.map(id => {
                    const p = pickedDetail[id]
                    if (!p) return null
                    return (
                      <div key={id} className="flex items-center gap-2 text-xs text-[#1d1d1f] dark:text-[#f5f5f7]">
                        <CheckCircle size={12} className="text-[#34c759] flex-shrink-0" />
                        <span className="flex-1 truncate">{p.title}</span>
                        <button
                          type="button"
                          onClick={() => togglePick(p)}
                          className="text-[#86868b] hover:text-[#ff3b30] flex-shrink-0"
                          aria-label="Remove from issue"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {postsLoading ? (
              <div className="flex items-center gap-2 text-xs text-[#86868b]"><Loader2 size={12} className="animate-spin" /> Loading…</div>
            ) : posts.length === 0 ? (
              <p className="text-xs text-[#86868b]">{searchQuery.trim() ? `No posts matched "${searchQuery}".` : 'No published posts yet. Publish a review first, then come back.'}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {posts.map(p => {
                  const checked = pickedIds.includes(p.id)
                  return (
                    <label
                      key={p.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${checked ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-[#7C3AED]/40'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePick(p)}
                        className="accent-[#7C3AED] w-4 h-4 mt-1 flex-shrink-0"
                      />
                      {p.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.thumbnail} alt="" className="w-28 h-16 rounded object-cover flex-shrink-0 border border-gray-200 dark:border-white/10" />
                      ) : (
                        <div className="w-28 h-16 rounded bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center flex-shrink-0"><ImageIcon size={16} className="text-[#86868b]" /></div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] line-clamp-1">{p.title}</p>
                        {p.summary && <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 line-clamp-3 leading-snug">{p.summary}</p>}
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          {p.url && (
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-0.5 text-[11px] text-[#7C3AED] hover:underline"
                            >
                              View post <ExternalLink size={9} />
                            </a>
                          )}
                          {p.productUrl && (
                            <a
                              href={p.productUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-0.5 text-[11px] text-[#34c759] hover:underline"
                              title="The product link from the source video's description"
                            >
                              <Tag size={9} /> Product link
                            </a>
                          )}
                          {p.publishedAt && (
                            <span className="text-[10px] text-[#86868b]">{new Date(p.publishedAt).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {/* Personal message */}
          <div className="card p-5 mb-5">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">2. Anything to tell your readers? <span className="text-[#86868b] font-normal">(optional)</span></p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-3">A short note that appears verbatim in the email — MVP will reference it naturally in the intro.</p>
            <textarea
              value={personalMessage}
              onChange={(e) => setPersonalMessage(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder='e.g. "Quick heads-up — the wireless earbuds I reviewed last month dropped to $39 yesterday. Grabbed a pair myself."'
              className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
            />
          </div>

          {/* Curated links */}
          <div className="card p-5 mb-5">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">3. Curated links <span className="text-[#86868b] font-normal">(optional)</span></p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-3">External picks you want to share — a tool, an article, a product not on your blog. Add the URL and a short "why I'm sharing this" note.</p>
            <div className="flex flex-col gap-2">
              {curated.map((c, idx) => (
                <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2">
                  <input
                    type="url"
                    value={c.url}
                    onChange={(e) => setCurated(prev => prev.map((x, i) => i === idx ? { ...x, url: e.target.value } : x))}
                    placeholder="https://…"
                    className="md:col-span-4 text-sm px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                  />
                  <input
                    type="text"
                    value={c.label}
                    onChange={(e) => setCurated(prev => prev.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))}
                    placeholder="Label (optional)"
                    className="md:col-span-2 text-sm px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                  />
                  <input
                    type="text"
                    value={c.blurb}
                    onChange={(e) => setCurated(prev => prev.map((x, i) => i === idx ? { ...x, blurb: e.target.value } : x))}
                    placeholder="Why are you sharing this?"
                    className="md:col-span-5 text-sm px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                  />
                  <button
                    type="button"
                    onClick={() => setCurated(prev => prev.filter((_, i) => i !== idx))}
                    aria-label="Remove curated link"
                    className="md:col-span-1 inline-flex items-center justify-center text-[#86868b] hover:text-[#ff3b30] transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {curated.length < 6 && (
                <button
                  type="button"
                  onClick={() => setCurated(prev => [...prev, { url: '', label: '', blurb: '' }])}
                  className="inline-flex items-center gap-1 self-start text-xs font-medium text-[#7C3AED] hover:underline"
                >
                  <Plus size={12} /> Add a curated link
                </button>
              )}
            </div>
          </div>

          {draftError && (
            <div className="mb-3 card p-3 border-[#ff3b30]/20 bg-[#ff3b30]/5">
              <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {draftError}</p>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">MVP drafts the subject + intro + per-post blurbs + sign-off in your voice.</p>
            <button
              onClick={() => void handleDraft()}
              disabled={drafting || (pickedIds.length === 0 && curated.length === 0 && !personalMessage.trim())}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-50"
            >
              {drafting ? <><Loader2 size={13} className="animate-spin" /> Drafting…</> : <><Sparkles size={13} /> Draft email</>}
            </button>
          </div>
        </>
      )}

      {/* ── Step 2: edit + preview + send ── */}
      {draft && (
        <DraftEditor
          draft={draft}
          updateDraft={updateDraft}
          previewRef={previewRef}
          activeSubs={activeSubs}
          sending={sending}
          sendError={sendError}
          onBack={() => setDraft(null)}
          onSend={() => handleSend()}
        />
      )}

      {/* Type-SEND-to-confirm modal.
       *
       *  Replaces window.confirm() which had two real problems:
       *  (a) Safari content-blockers + privacy extensions can silently
       *      suppress confirm() dialogs — accidental return = "OK" on
       *      some setups, blasting every subscriber.
       *  (b) Native confirm is single-line; subscriber count + cost
       *      context didn't fit cleanly.
       *
       *  The type-to-confirm pattern protects against muscle-memory
       *  Enter-mashing — user must actually look at the modal and type
       *  the word SEND before the button enables.
       *
       *  Escape closes. Click outside closes. */}
      {confirmOpen && draft && (
        <SendConfirmModal onClose={() => setConfirmOpen(false)}>
            <h2 id="send-confirm-title" className="text-[20px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
              {scheduleEnabled && scheduledAt
                ? 'Schedule this newsletter?'
                : abEnabled && subjectB.trim()
                ? 'Start A/B test?'
                : `Send to ${activeSubs ?? '?'} subscribers?`}
            </h2>
            <p className="text-[14px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mb-4">
              <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">&ldquo;{draft.subject}&rdquo;</span>
              {scheduleEnabled && scheduledAt
                ? <> will be queued for <strong>{new Date(scheduledAt).toLocaleString()}</strong>. The cron fires it at that time against whoever is active then.</>
                : abEnabled && subjectB.trim()
                ? <> goes out as subject A. <strong>&ldquo;{subjectB.trim()}&rdquo;</strong> goes out as subject B. The winning subject reaches the holdback after the test window.</>
                : <> will go out to every active subscriber within a minute or two. This cannot be undone.</>}
            </p>

            {/* ── A/B subject lines ────────────────────────────────────── */}
            <div className="mb-3 border border-gray-200 dark:border-white/10 rounded-lg p-3">
              <label className="flex items-center gap-2 text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] cursor-pointer">
                <input
                  type="checkbox"
                  checked={abEnabled}
                  onChange={(e) => setAbEnabled(e.target.checked)}
                  className="accent-[#7C3AED]"
                />
                A/B test the subject line
              </label>
              {abEnabled && (
                <div className="mt-2 space-y-2">
                  <input
                    type="text"
                    value={subjectB}
                    onChange={(e) => setSubjectB(e.target.value)}
                    placeholder="Subject B (e.g. a punchier alternative)"
                    maxLength={200}
                    className="w-full px-3 py-1.5 rounded-md border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                  />
                  <div className="flex items-center gap-3 text-[12px] text-[#6e6e73] dark:text-[#ebebf0]">
                    <label className="flex items-center gap-1.5">
                      Sample
                      <input type="number" min={5} max={50} value={samplePct} onChange={(e) => setSamplePct(Number(e.target.value) || 20)} className="w-14 px-2 py-1 rounded border text-[12px] dark:bg-white/5" />%
                    </label>
                    <label className="flex items-center gap-1.5">
                      Wait
                      <input type="number" min={1} max={48} value={testHours} onChange={(e) => setTestHours(Number(e.target.value) || 2)} className="w-14 px-2 py-1 rounded border text-[12px] dark:bg-white/5" />h
                    </label>
                    <span className="ml-auto opacity-70">Winner → rest after wait.</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── Scheduling ───────────────────────────────────────────── */}
            <div className="mb-3 border border-gray-200 dark:border-white/10 rounded-lg p-3">
              <label className="flex items-center gap-2 text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] cursor-pointer">
                <input
                  type="checkbox"
                  checked={scheduleEnabled}
                  onChange={(e) => setScheduleEnabled(e.target.checked)}
                  className="accent-[#7C3AED]"
                />
                Schedule for later
              </label>
              {scheduleEnabled && (
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="mt-2 w-full px-3 py-1.5 rounded-md border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                />
              )}
            </div>

            {/* ── Segmentation ──────────────────────────────────────────── */}
            <div className="mb-3 border border-gray-200 dark:border-white/10 rounded-lg p-3">
              <label className="flex items-center gap-2 text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] cursor-pointer">
                <input
                  type="checkbox"
                  checked={segmentEnabled}
                  onChange={(e) => setSegmentEnabled(e.target.checked)}
                  className="accent-[#7C3AED]"
                />
                Send to a segment only
              </label>
              {segmentEnabled && (
                <div className="mt-2 space-y-2 text-[12px] text-[#6e6e73] dark:text-[#ebebf0]">
                  <label className="flex items-center gap-2">
                    Source
                    <select value={segSource} onChange={(e) => setSegSource(e.target.value as typeof segSource)} className="flex-1 px-2 py-1 rounded border bg-white dark:bg-white/5">
                      <option value="all">All sources</option>
                      <option value="blog_form">Blog form</option>
                      <option value="csv_import">CSV import</option>
                      <option value="manual">Manual add</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    Signed up after
                    <input
                      type="date"
                      value={segSignedUpAfter}
                      onChange={(e) => setSegSignedUpAfter(e.target.value)}
                      className="flex-1 px-2 py-1 rounded border bg-white dark:bg-white/5"
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    Tags (any of)
                    <input
                      type="text"
                      value={segTagsRaw}
                      onChange={(e) => setSegTagsRaw(e.target.value)}
                      placeholder="paying, lead, archived"
                      className="flex-1 px-2 py-1 rounded border bg-white dark:bg-white/5"
                    />
                  </label>
                  {availableTags.length > 0 && (
                    <p className="opacity-70 leading-tight">
                      Known tags: {availableTags.slice(0, 12).join(', ')}
                    </p>
                  )}
                </div>
              )}
            </div>

            <label className="block text-[12px] text-[#6e6e73] dark:text-[#ebebf0] mb-1.5">
              Type <strong className="text-[#7C3AED]">SEND</strong> to confirm
            </label>
            <input
              type="text"
              value={confirmTyped}
              onChange={(e) => setConfirmTyped(e.target.value)}
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 text-[14px] font-mono uppercase tracking-wider text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:border-[#7C3AED]"
              spellCheck={false}
              autoCorrect="off"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && confirmTyped.trim().toUpperCase() === 'SEND') {
                  void confirmSend()
                }
              }}
            />
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 rounded-lg text-[13px] text-[#6e6e73] dark:text-[#ebebf0] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmSend()}
                disabled={confirmTyped.trim().toUpperCase() !== 'SEND' || (abEnabled && !subjectB.trim()) || (scheduleEnabled && !scheduledAt)}
                className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white inline-flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
                  boxShadow: '0 4px 16px rgba(124,58,237,0.30)',
                }}
              >
                {scheduleEnabled && scheduledAt
                  ? 'Schedule send'
                  : abEnabled && subjectB.trim()
                  ? 'Start A/B test'
                  : `Send to ${activeSubs ?? '?'} subscribers`}
              </button>
            </div>
        </SendConfirmModal>
      )}
    </>
  )
}

/** Send-confirm modal wrapper — gives the type-SEND modal proper focus
 *  trap, scroll lock, Escape close, and restore-focus on close. The inner
 *  JSX (header, options, type-SEND input, action buttons) lives in the
 *  parent so the existing send/A/B/schedule/segment state can be referenced
 *  directly without prop-drilling 15 setters. */
function SendConfirmModal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const onA11yKey = useModalA11y(true, panelRef, onClose)
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
      onKeyDown={onA11yKey}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="bg-white dark:bg-[#1a1a1c] rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-gray-200 dark:border-white/10 my-4 outline-none"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-confirm-title"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  )
}

// ── Step-2 editor: separate component so the preview iframe re-mounts on
//    each draft change without re-rendering the heavy picker tree. ──
function DraftEditor({
  draft, updateDraft, previewRef, activeSubs, sending, sendError, onBack, onSend,
}: {
  draft: Draft
  updateDraft: <K extends keyof Draft>(key: K, value: Draft[K]) => void
  previewRef: React.RefObject<HTMLIFrameElement | null>
  activeSubs: number | null
  sending: boolean
  sendError: string | null
  onBack: () => void
  onSend: () => void
}) {
  // Re-render the iframe srcDoc whenever any structured field changes — we
  // build the HTML client-side from the brand + posts + curated arrays so
  // the creator's edits are reflected instantly without a server round-trip.
  // The initial HTML from /draft is used as the template; we just swap the
  // text fields by stripping the original blocks and rebuilding. For v1
  // we keep it simpler: render a lightweight preview that mirrors the
  // server's renderNewsletterHtml output shape (close enough for review).
  const previewHtml = useMemo(() => buildPreviewHtml(draft), [draft])

  return (
    <>
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-xs text-[#86868b] hover:text-[#7C3AED]">
        <ChevronLeft size={12} /> Re-pick posts
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Editor */}
        <div className="space-y-4">
          <div className="card p-4">
            <label className="block text-[11px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-1">Subject</label>
            <input
              type="text"
              value={draft.subject}
              onChange={(e) => updateDraft('subject', e.target.value)}
              maxLength={200}
              className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
            />
          </div>
          <div className="card p-4">
            <label className="block text-[11px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-1">Intro</label>
            <textarea
              value={draft.intro}
              onChange={(e) => updateDraft('intro', e.target.value)}
              rows={3}
              className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
            />
          </div>
          {draft.posts.map((p, idx) => (
            <div key={idx} className="card p-4">
              <p className="text-[11px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-2">Post {idx + 1}: {p.title}</p>
              <label className="block text-[11px] text-[#86868b] mb-1">Blurb (one line)</label>
              <input
                type="text"
                value={p.blurb || ''}
                onChange={(e) => updateDraft('posts', draft.posts.map((x, i) => i === idx ? { ...x, blurb: e.target.value } : x))}
                maxLength={280}
                placeholder="One sentence about why this post matters"
                className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
            </div>
          ))}
          {draft.personalMessage && (
            <div className="card p-4">
              <label className="block text-[11px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-1 flex items-center gap-1"><MessageCircle size={11} /> Your personal message</label>
              <textarea
                value={draft.personalMessage}
                onChange={(e) => updateDraft('personalMessage', e.target.value)}
                rows={3}
                className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
            </div>
          )}
          <div className="card p-4">
            <label className="block text-[11px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-1">Outro / sign-off</label>
            <textarea
              value={draft.outro}
              onChange={(e) => updateDraft('outro', e.target.value)}
              rows={2}
              className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
            />
          </div>

          {sendError && (
            <div className="card p-3 border-[#ff3b30]/20 bg-[#ff3b30]/5">
              <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {sendError}</p>
            </div>
          )}

          <button
            onClick={onSend}
            disabled={sending}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-3 rounded-lg text-sm font-semibold text-white bg-[#34c759] hover:bg-[#2cb852] disabled:opacity-60"
          >
            {sending ? <><Loader2 size={13} className="animate-spin" /> Sending to {activeSubs}…</> : <><Send size={13} /> Send to {activeSubs ?? '?'} subscribers</>}
          </button>
        </div>

        {/* Preview */}
        <div className="card p-2 sticky top-4 self-start">
          <p className="text-[11px] font-semibold text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide px-2 py-1">Preview</p>
          <iframe
            ref={previewRef}
            title="Newsletter preview"
            sandbox=""
            srcDoc={previewHtml}
            className="w-full rounded-md border border-gray-200 dark:border-white/10 bg-white"
            style={{ height: '780px' }}
          />
        </div>
      </div>
    </>
  )
}

// Client-side preview HTML builder — kept thin (mirrors the server's
// renderNewsletterHtml shape closely enough for review). Doesn't include
// the per-recipient unsub URL — placeholder text instead.
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function buildPreviewHtml(d: Draft): string {
  const postHtml = d.posts.map(p => `<div style="margin:0 0 28px;">${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" style="width:100%;border-radius:10px;display:block;" />` : ''}
<h2 style="margin:14px 0 8px;font-size:20px;color:#1d1d1f;font-weight:700;">${esc(p.title)}</h2>
${p.blurb ? `<p style="margin:0 0 10px;font-size:14px;color:#3a3a3c;">${esc(p.blurb)}</p>` : ''}
<p style="margin:0 0 12px;font-size:14px;color:#6e6e73;">${esc(p.excerpt)}</p>
<p style="margin:0;"><a href="${esc(p.url)}" style="display:inline-block;padding:9px 16px;background:#7C3AED;color:#fff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">Read the review</a></p></div>`).join('\n')
  const linksHtml = d.curatedLinks.length === 0 ? '' :
    `<div style="background:#f5f5f7;border-radius:12px;padding:20px 24px;margin:0 0 28px;">
       <p style="margin:0 0 10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#7C3AED;">Worth your time this week</p>
       <ul style="margin:0;padding:0 0 0 18px;">
         ${d.curatedLinks.map(l => `<li style="margin:0 0 14px;font-size:14px;color:#3a3a3c;"><a href="${esc(l.url)}" style="color:#7C3AED;text-decoration:none;font-weight:600;">${esc(l.label || l.url)}</a><span style="color:#6e6e73;"> — ${esc(l.blurb)}</span></li>`).join('')}
       </ul>
     </div>`
  const personal = d.personalMessage?.trim()
    ? `<div style="background:#fff8e1;border-left:3px solid #ff9500;border-radius:8px;padding:16px 20px;margin:0 0 28px;"><p style="margin:0;font-size:15px;color:#3a3a3c;font-style:italic;">${esc(d.personalMessage)}</p></div>`
    : ''
  return `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;padding:36px 32px;">
${d.brand.logoUrl ? `<img src="${esc(d.brand.logoUrl)}" alt="${esc(d.brand.name)}" style="height:40px;margin-bottom:14px;" />` : ''}
<h1 style="margin:0 0 6px;font-size:26px;color:#1d1d1f;font-weight:700;">${esc(d.subject)}</h1>
${d.brand.byline ? `<p style="margin:6px 0 0;font-size:13px;color:#86868b;">${esc(d.brand.byline)}</p>` : ''}
<p style="margin:18px 0 24px;font-size:15px;color:#3a3a3c;">${esc(d.intro)}</p>
${personal}
${postHtml}
${linksHtml}
<p style="margin:24px 0 0;font-size:15px;color:#3a3a3c;">${esc(d.outro)}</p>
<div style="border-top:1px solid #e5e5ea;padding-top:20px;margin-top:24px;text-align:center;">
<p style="margin:0 0 8px;font-size:13px;color:#3a3a3c;">${esc(d.brand.name)}</p>
${d.brand.mailingAddress ? `<p style="margin:0 0 8px;font-size:12px;color:#86868b;">${esc(d.brand.mailingAddress)}</p>` : ''}
<p style="margin:0;font-size:12px;color:#86868b;"><span style="text-decoration:underline;">Unsubscribe</span> (preview — real link inserted per subscriber at send)</p>
</div>
</div>
</body></html>`
}
