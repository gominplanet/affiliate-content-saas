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
import Header from '@/components/layout/Header'
import {
  Loader2, AlertCircle, CheckCircle, Sparkles, Send, ChevronLeft,
  Plus, X, Image as ImageIcon, MessageCircle,
} from 'lucide-react'

interface PickablePost {
  id: string
  title: string
  excerpt: string
  url: string
  thumbnail: string | null
  publishedAt: string | null
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
  const [personalMessage, setPersonalMessage] = useState('')
  const [curated, setCurated] = useState<Array<{ url: string; label: string; blurb: string }>>([])
  const [activeSubs, setActiveSubs] = useState<number | null>(null)

  const [drafting, setDrafting] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)

  const [sending, setSending] = useState(false)
  const [sentResult, setSentResult] = useState<{ recipients: number; sent: number; failed: number } | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  // ── Load pickable posts + active sub count ─────────────────────────────────
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
        if (sRes.ok) setActiveSubs(sData?.counts?.active ?? 0)
      } finally {
        setPostsLoading(false)
      }
    })()
  }, [])

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
  async function handleSend() {
    if (!draft) return
    if (!window.confirm(`Send "${draft.subject}" to ${activeSubs ?? '?'} active subscribers?\n\nThis cannot be undone — every active subscriber will receive the email within a minute or two.`)) return
    setSending(true)
    setSendError(null)
    try {
      const r = await fetch('/api/newsletter/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: draft.subject,
          intro: draft.intro,
          outro: draft.outro,
          personalMessage: draft.personalMessage,
          posts: draft.posts,
          curatedLinks: draft.curatedLinks,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Send failed')
      setSentResult({ recipients: d.recipients, sent: d.sent, failed: d.failed })
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
    return (
      <>
        <Header title="Newsletter sent" />
        <div className="max-w-xl mx-auto card p-8 text-center">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-[#34c759]/10 flex items-center justify-center">
            <CheckCircle size={26} className="text-[#34c759]" />
          </div>
          <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">It&apos;s on the way.</h2>
          <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mb-5">
            Sent to <strong>{sentResult.sent}</strong> of <strong>{sentResult.recipients}</strong> subscribers
            {sentResult.failed > 0 && <span className="text-[#ff9500]"> ({sentResult.failed} errored — check the dashboard for details)</span>}.
          </p>
          <div className="flex items-center gap-2 justify-center">
            <Link href="/newsletter" className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4]">Back to newsletter</Link>
            <button onClick={() => { setDraft(null); setSentResult(null); setPickedIds([]); setPersonalMessage(''); setCurated([]) }} className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 dark:border-white/10">Compose another</button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Header
        title="Compose newsletter"
        subtitle={activeSubs !== null ? `Sending to ${activeSubs} active subscribers.` : 'Pick posts, write a quick note, send.'}
      />

      <div className="mb-4">
        <Link href="/newsletter" className="inline-flex items-center gap-1 text-xs text-[#86868b] hover:text-[#0071e3]">
          <ChevronLeft size={12} /> Back to newsletter
        </Link>
      </div>

      {/* ── Step 1: pick + write ── */}
      {!draft && (
        <>
          {/* Posts picker */}
          <div className="card p-5 mb-5">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">1. Pick posts for this issue</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-3">Each picked post gets its own card with a thumbnail + a one-sentence "why" Claude writes for you.</p>
            {postsLoading ? (
              <div className="flex items-center gap-2 text-xs text-[#86868b]"><Loader2 size={12} className="animate-spin" /> Loading…</div>
            ) : posts.length === 0 ? (
              <p className="text-xs text-[#86868b]">No published posts yet. Publish a review first, then come back.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {posts.map(p => {
                  const checked = pickedIds.includes(p.id)
                  return (
                    <label key={p.id} className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${checked ? 'border-[#0071e3] bg-[#0071e3]/5' : 'border-gray-200 dark:border-white/10 hover:border-[#0071e3]/40'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setPickedIds(prev => e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id))}
                        className="accent-[#0071e3] w-4 h-4 mt-1 flex-shrink-0"
                      />
                      {p.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.thumbnail} alt="" className="w-16 h-9 rounded object-cover flex-shrink-0 border border-gray-200 dark:border-white/10" />
                      ) : (
                        <div className="w-16 h-9 rounded bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center flex-shrink-0"><ImageIcon size={13} className="text-[#86868b]" /></div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] line-clamp-1">{p.title}</p>
                        <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] line-clamp-1">{p.excerpt}</p>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
            {pickedIds.length > 0 && (
              <p className="text-xs text-[#0071e3] mt-2">{pickedIds.length} picked · drag from up/down later if you want a specific order (coming soon — order matches your click order for now)</p>
            )}
          </div>

          {/* Personal message */}
          <div className="card p-5 mb-5">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">2. Anything to tell your readers? <span className="text-[#86868b] font-normal">(optional)</span></p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-3">A short note that appears verbatim in the email — Claude will reference it naturally in the intro.</p>
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
                  className="inline-flex items-center gap-1 self-start text-xs font-medium text-[#0071e3] hover:underline"
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
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Claude drafts the subject + intro + per-post blurbs + sign-off in your voice.</p>
            <button
              onClick={() => void handleDraft()}
              disabled={drafting || (pickedIds.length === 0 && curated.length === 0 && !personalMessage.trim())}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-50"
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
          onSend={() => void handleSend()}
        />
      )}
    </>
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
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-xs text-[#86868b] hover:text-[#0071e3]">
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
<p style="margin:0;"><a href="${esc(p.url)}" style="display:inline-block;padding:9px 16px;background:#0071e3;color:#fff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">Read the review</a></p></div>`).join('\n')
  const linksHtml = d.curatedLinks.length === 0 ? '' :
    `<div style="background:#f5f5f7;border-radius:12px;padding:20px 24px;margin:0 0 28px;">
       <p style="margin:0 0 10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#0071e3;">Worth your time this week</p>
       <ul style="margin:0;padding:0 0 0 18px;">
         ${d.curatedLinks.map(l => `<li style="margin:0 0 14px;font-size:14px;color:#3a3a3c;"><a href="${esc(l.url)}" style="color:#0071e3;text-decoration:none;font-weight:600;">${esc(l.label || l.url)}</a><span style="color:#6e6e73;"> — ${esc(l.blurb)}</span></li>`).join('')}
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
