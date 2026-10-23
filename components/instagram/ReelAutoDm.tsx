'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AUTO-DM FOR A REEL, IN EVERY WINDOW THAT POSTS ONE (Seb, 2026-10-23: "if
// you're in Clip Factory, you should be able to create the shorts and then
// have automatically the auto DM function within that. So showing the users
// the actual link, the actual affiliate link that will be sent out if someone
// says the word that the user chooses").
//
// The Post to Instagram window had this inline, and the TikTok window's "Also
// post to Instagram" had none, so a Reel cross-posted from Clip Factory went
// out with no Auto-DM. Both use this block now. It shows:
//   - the word to comment (one word, as it is saved and matched),
//   - the link, picked from the clip's Link in Bio page, blog post and
//     affiliate link (lib/dm-link-options), or pasted,
//   - THE DM ITSELF, word for word, built by the same code the webhook sends
//     with (/api/instagram/dm-preview), with a link to open what it sends,
//   - whether this Instagram account can answer comments at all, and if not,
//     why (/api/instagram/dm-debug). A Reel promising a DM that never comes
//     looks the same as one that works until somebody comments.

import { useEffect, useRef, useState } from 'react'
import { Loader2, ExternalLink, MessageCircle, AlertCircle, CheckCircle } from 'lucide-react'
import { dmLinkWords } from '@/lib/ig-dm-message'

type DmKind = 'shop' | 'blog' | 'amazon'
type DmChoice = { kind: DmKind; url: string; label: string; note: string }
const DM_KIND_KEY = 'mvp.ig.dmLinkKind'
const DM_ORDER: DmKind[] = ['shop', 'blog', 'amazon']

/** What the publish routes take as `autoDm`. */
export type ReelAutoDmPayload = { link: string; keyword: string; kind?: DmKind; videoId?: string; productName?: string }

export interface ReelAutoDmState {
  /** The box is ticked. */
  on: boolean
  /** The word, as saved: one word, LINK when empty. */
  keyword: string
  /** What to send to the publish route, or null when there is nothing to send
   *  (off, or no link yet). */
  payload: ReelAutoDmPayload | null
}

const isLink = (u: string) => /^https?:\/\//i.test(u.trim())

export default function ReelAutoDm({
  videoId,
  postId,
  product,
  defaultDmLink,
  productName,
  onChange,
}: {
  /** The source video (youtube_videos.id), for its blog post and product. */
  videoId?: string
  /** A blog post (blog_posts.id), for its own address and product. */
  postId?: string
  /** The clip's product link (Clip Factory's Enhance step). */
  product?: string
  /** Prefills the link when MVP finds no choices. */
  defaultDmLink?: string
  productName?: string
  onChange: (s: ReelAutoDmState) => void
}) {
  const [on, setOn] = useState(false)
  const [keyword, setKeyword] = useState('LINK')
  const [link, setLink] = useState((defaultDmLink || '').trim())
  const [choices, setChoices] = useState<DmChoice[] | null>(null)
  const [kind, setKind] = useState<DmKind | 'custom'>('custom')

  // The clip's links, each only when it exists.
  useEffect(() => {
    const q = new URLSearchParams()
    if (videoId) q.set('videoId', videoId)
    if (postId) q.set('postId', postId)
    if (product && product.trim()) q.set('product', product.trim())
    else if (defaultDmLink && defaultDmLink.trim()) q.set('product', defaultDmLink.trim())
    let gone = false
    fetch(`/api/instagram/dm-link-options?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { options?: DmChoice[] } | null) => {
        if (gone) return
        const opts = Array.isArray(d?.options) ? d!.options : []
        setChoices(opts)
        let last: string | null = null
        try { last = localStorage.getItem(DM_KIND_KEY) } catch { /* private window */ }
        const pick = opts.find((o) => o.kind === last) ?? DM_ORDER.map((k) => opts.find((o) => o.kind === k)).find(Boolean)
        if (pick) { setKind(pick.kind); setLink(pick.url) }
      })
      .catch(() => { if (!gone) setChoices([]) })
    return () => { gone = true }
  }, [videoId, postId, product, defaultDmLink])

  // On by default once a link is ready.
  const defaulted = useRef(false)
  useEffect(() => {
    if (defaulted.current || choices === null) return
    defaulted.current = true
    if (choices.length || isLink(link)) setOn(true)
  }, [choices, link])

  const word = keyword.trim() || 'LINK'
  useEffect(() => {
    onChange({
      on,
      keyword: word,
      payload: on && isLink(link)
        ? { link: link.trim(), keyword: word, kind: kind === 'custom' ? undefined : kind, videoId, productName: (productName || '').trim() || undefined }
        : null,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, word, link, kind, videoId, productName])

  // THE DM, word for word, a moment after the link stops changing.
  const [preview, setPreview] = useState<{ message: string; store: string | null; publicReply: string | null; ownMessage: boolean } | null>(null)
  const [previewErr, setPreviewErr] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  useEffect(() => {
    if (!on || !isLink(link)) { setPreview(null); setPreviewErr(null); return }
    let gone = false
    setPreviewing(true)
    const t = setTimeout(() => {
      fetch(`/api/instagram/dm-preview?link=${encodeURIComponent(link.trim())}`, { cache: 'no-store' })
        .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
        .then(({ ok, d }) => {
          if (gone) return
          if (ok && typeof d.message === 'string') { setPreview(d); setPreviewErr(null) }
          else { setPreview(null); setPreviewErr(d.error || 'MVP could not build the message.') }
        })
        .catch(() => { if (!gone) { setPreview(null); setPreviewErr('MVP could not build the message.') } })
        .finally(() => { if (!gone) setPreviewing(false) })
    }, 500)
    return () => { gone = true; clearTimeout(t) }
  }, [on, link])

  // Can this account answer comments at all?
  const [ready, setReady] = useState<{ ok: boolean; why: string | null } | 'unknown' | null>(null)
  useEffect(() => {
    if (!on || ready !== null) return
    let gone = false
    fetch('/api/instagram/dm-debug', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { reel?: { ok: boolean; why: string | null } } | null) => { if (!gone) setReady(d?.reel ?? 'unknown') })
      .catch(() => { if (!gone) setReady('unknown') })
    return () => { gone = true }
  }, [on, ready])

  const choose = (c: DmChoice) => {
    setKind(c.kind)
    setLink(c.url)
    try { localStorage.setItem(DM_KIND_KEY, c.kind) } catch { /* private window */ }
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-white/10 p-3">
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="accent-[#7C3AED]" />
        <span className="text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Auto-DM the link when someone comments</span>
      </label>
      {on && (
        <div className="mt-2.5 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#86868b] shrink-0">When they comment</span>
            <input
              value={keyword}
              // One word, as it is saved and matched (lib/ig-dm-message).
              onChange={(e) => setKeyword(e.target.value.replace(/\s+/g, '').slice(0, 30))}
              placeholder="LINK"
              aria-label="Word to comment"
              className="flex-1 text-sm px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] uppercase"
            />
          </div>
          <p className="text-[10px] text-[#86868b] -mt-1">One word, any capitals. &quot;link&quot;, &quot;Link!&quot; and &quot;LINK please&quot; all count.</p>

          {choices === null && (
            <p className="text-[11px] text-[#86868b] inline-flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Finding this product&apos;s links…</p>
          )}
          {choices && choices.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Link to send">
              {choices.map((c) => (
                <button key={c.kind} type="button" role="radio" aria-checked={kind === c.kind} onClick={() => choose(c)} title={c.note}
                  className={`text-[12px] font-semibold px-2.5 py-1 rounded-full border ${kind === c.kind
                    ? 'border-[#7C3AED] bg-[#7C3AED]/10 text-[#7C3AED]'
                    : 'border-gray-200 dark:border-white/10 text-[#3a3a3c] dark:text-[#d2d2d7]'}`}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
          {choices && choices.length > 0 && kind !== 'custom' && (
            <p className="text-[10px] text-[#86868b] -mt-0.5">{choices.find((c) => c.kind === kind)?.note}</p>
          )}
          {choices && choices.length === 0 && (
            <p className="text-[11px] text-[#86868b]">MVP found no blog post, Link in Bio page or product for this clip. Paste the link to send.</p>
          )}
          <input
            value={link}
            onChange={(e) => { setLink(e.target.value); setKind('custom') }}
            placeholder="Link to DM them (https://…)"
            aria-label="Link to send"
            className="w-full text-sm px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
          />
          {!isLink(link) && (
            <p className="text-[11px] text-[#ff3b30]">Paste the link to send, or this Reel posts without Auto-DM.</p>
          )}

          {/* The DM itself, as the person who comments gets it. */}
          {isLink(link) && (
            <div className="rounded-md bg-black/[0.03] dark:bg-white/[0.06] p-2.5 flex flex-col gap-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#3a3a3c] dark:text-[#d2d2d7] inline-flex items-center gap-1">
                <MessageCircle size={11} /> Anyone who comments {word.toUpperCase()} gets this DM
              </p>
              {previewing && !preview && (
                <p className="text-[11px] text-[#86868b] inline-flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Building the message…</p>
              )}
              {previewErr && <p className="text-[11px] text-[#ff3b30]">{previewErr}</p>}
              {preview && (
                <>
                  <p className="text-[12px] whitespace-pre-wrap break-words text-[#1d1d1f] dark:text-[#f5f5f7]">{preview.message}</p>
                  <a href={link.trim()} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7C3AED] hover:underline self-start">
                    {dmLinkWords(kind, link, preview.store)} <ExternalLink size={10} />
                  </a>
                  {preview.publicReply && (
                    <p className="text-[10px] text-[#86868b]">MVP also replies under their comment: &quot;{preview.publicReply}&quot;</p>
                  )}
                  <p className="text-[10px] text-[#86868b]">
                    {preview.ownMessage ? 'Your message from the ' : 'MVP’s standard message. Write your own on the '}
                    <a href="/instagram-dm" target="_blank" rel="noopener noreferrer" className="underline">Instagram Auto-DM page</a>.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Can this account answer comments? Said either way. */}
          {ready === null && (
            <p className="text-[11px] text-[#86868b] inline-flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Checking your Instagram connection…</p>
          )}
          {ready && ready !== 'unknown' && ready.ok && (
            <p className="text-[11px] text-[#34c759] inline-flex items-center gap-1.5"><CheckCircle size={11} /> Your Instagram is set up to answer comments.</p>
          )}
          {ready && ready !== 'unknown' && !ready.ok && (
            <div className="rounded-md border border-[#ff9500]/30 bg-[#ff9500]/10 p-2 flex flex-col gap-1">
              <p className="text-[11px] text-[#c93400] flex items-start gap-1.5"><AlertCircle size={12} className="mt-px shrink-0" /> Comments on this Reel will not get the DM yet. {ready.why}</p>
              <a href="/instagram-dm" target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-[#7C3AED] hover:underline self-start">Fix it on the Instagram Auto-DM page</a>
            </div>
          )}
          {ready === 'unknown' && (
            <p className="text-[11px] text-[#86868b]">MVP could not check your Instagram connection right now. The Instagram Auto-DM page shows its status.</p>
          )}
        </div>
      )}
    </div>
  )
}
