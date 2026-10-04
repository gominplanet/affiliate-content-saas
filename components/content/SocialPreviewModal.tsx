'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, X, RefreshCw, CheckCircle, AlertCircle, Calendar, Copy, ExternalLink, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useModalA11y } from '@/components/ui/useModalA11y'
import { tzAbbrev } from '@/lib/format-schedule'
import { isFacebookGroupLink, isFacebookGroupPostLink } from '@/lib/facebook-group-link'

/** Platform key the SocialPreviewModal accepts for scheduling. The cron
 *  worker handles the same set. */
type SchedulablePlatform = 'facebook' | 'threads' | 'twitter' | 'linkedin' | 'bluesky' | 'telegram'

/**
 * Generic preview/edit modal used before any text-based social publish.
 *
 * Flow:
 *   1. On mount, calls the endpoint with { dryRun: true } to get the AI-generated text.
 *   2. User can edit the textarea or click Regenerate.
 *   3. Publish hits the SAME endpoint with the (possibly edited) text and no dryRun.
 *
 * Endpoint contract (each /api/blog/{platform}-post route):
 *   Request:  { postId, dryRun?: boolean, text?: string }
 *   Response: { ok: true, dryRun?: true, text: string, finalText: string }
 *              | { error: string }
 *
 * Used for: Threads, Twitter/X, Bluesky, LinkedIn, Facebook, Telegram.
 * Instagram has its own purpose-built modal (image + multi-target flow).
 * Pinterest has its own preview flow (description + image).
 */
export function SocialPreviewModal({
  platform,
  platformKey,
  brandColor,
  endpoint,
  postId,
  onClose,
  onPublished,
  onScheduled,
  extraBody,
  shareUrl,
  shareHashtags,
  shareDisclaimer,
  facebookGroups,
  publishTargetLabel,
  facebookPages,
  groupFirst,
}: {
  /** Display label, e.g. "Threads" — shows in the modal header. */
  platform: string
  /** Lowercase platform key used by /api/blog/schedule-post. If omitted,
   *  the Schedule-for-later toggle is hidden (immediate publish only). */
  platformKey?: SchedulablePlatform
  /** Hex color used for the publish button background. */
  brandColor: string
  /** Relative API path, e.g. /api/blog/threads-post */
  endpoint: string
  /** Blog post id to send in the body. */
  postId: string
  /** Closes the modal (cancel or success). */
  onClose: () => void
  /** Called after a successful publish so the pill can flip to "Posted". */
  onPublished: () => void
  /** Called after a scheduled-for-later succeeds. */
  onScheduled?: (when: Date) => void
  /** Extra fields merged into every request body — e.g. a chosen
   *  { socialAccountId } for multi-account targeting. */
  extraBody?: Record<string, unknown>
  /** Facebook-only manual-share extras. When `shareUrl` is provided, the modal
   *  shows a copy-paste block (post text + hashtags + URL + disclaimer) and a
   *  list of the user's saved Facebook Groups to open and paste into — Meta's
   *  API can't post to Groups, only Pages. */
  shareUrl?: string
  shareHashtags?: string
  shareDisclaimer?: string
  facebookGroups?: Array<{ name: string; url: string }>
  /** Name of the exact destination the Publish button posts to (e.g. the
   *  selected Facebook Page). Shown next to the button so it's unambiguous. */
  publishTargetLabel?: string
  /** Facebook-only: the user's connected Pages. When provided, the modal shows
   *  a Page dropdown so they can pick which Page to publish to right here; the
   *  chosen page's id overrides extraBody.socialAccountId on publish/schedule. */
  facebookPages?: Array<{ id: string; name: string; isDefault?: boolean }>
  /** Facebook, Group first (Labs facebook_setup): one button per saved Group.
   *  SCOUT fills the post with the affiliate link and picture in the Group,
   *  the creator presses Post, and the moment SCOUT sees it go up MVP posts
   *  a short Page post linking to it. No Page post carries the affiliate
   *  link, so Meta's limit on outside links never comes into it. */
  groupFirst?: boolean
}) {
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [finalText, setFinalText] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)

  // ── Schedule-for-later state ─────────────────────────────────────────────
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  // Default schedule: 1 hour from now, rounded to the next 5 min boundary.
  // datetime-local <input> wants a local-time string ("YYYY-MM-DDTHH:mm").
  const [scheduledAt, setScheduledAt] = useState<string>(() => defaultScheduleString())
  const [scheduling, setScheduling] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // ── Facebook Page picker ─────────────────────────────────────────────────
  // Which Page the Publish button targets. Defaults to whatever the parent
  // pre-selected (extraBody.socialAccountId), else the default/first Page.
  const [selectedPageId, setSelectedPageId] = useState<string | undefined>(() =>
    (extraBody?.socialAccountId as string | undefined)
    ?? facebookPages?.find(p => p.isDefault)?.id
    ?? facebookPages?.[0]?.id,
  )
  const hasPagePicker = !!facebookPages && facebookPages.length > 0
  // Override extraBody's socialAccountId with the in-modal pick so publish AND
  // schedule both target the chosen Page.
  const effectiveExtraBody = hasPagePicker && selectedPageId
    ? { ...extraBody, socialAccountId: selectedPageId }
    : extraBody
  const activePageLabel = hasPagePicker
    ? (facebookPages!.find(p => p.id === selectedPageId)?.name ?? publishTargetLabel)
    : publishTargetLabel
  // Niche hashtags generated server-side for THIS product/topic (preferred over
  // the generic brand-niche fallback passed in via shareHashtags).
  const [serverHashtags, setServerHashtags] = useState('')

  // Facebook opt-in: append the post's direct affiliate link (+ disclaimer) as a
  // "buy it now" second CTA. Only offered on Facebook, and only when the post
  // actually has an affiliate link (the server reports it via affiliateAvailable).
  const isFacebook = platformKey === 'facebook'
  const savedGroups = (facebookGroups ?? []).filter((g) => g.url?.trim())
  const groupFirstMode = isFacebook && !!groupFirst && !!shareUrl && savedGroups.length > 0
  // What the Page post says, written before the button is pressed, since it
  // goes out by itself once the Group post is up.
  const [pageTeaser, setPageTeaser] = useState('')
  // Whether the post has an affiliate link at all (drives the Link-settings note).
  // The blog/affiliate/both choice itself now lives in Link settings, applied
  // server-side, so there's no per-post affiliate toggle here anymore.
  const [affiliateAvailable, setAffiliateAvailable] = useState(false)

  // ── Facebook attachment choice: thumbnail or playable video ──────────────
  // A Page post carries exactly ONE attachment, so this is a choice rather than
  // a combination: either the thumbnail as a still hero image, or the YouTube
  // watch URL, which Facebook renders as a card with a play control. The
  // caption, blog link and disclaimer are identical either way.
  //
  // `videoAvailable` comes back from the preview call. The video option is only
  // offered when the post actually has a source video, because an option that
  // silently degrades to the thumbnail is worse than no option.
  const [videoAvailable, setVideoAvailable] = useState(false)
  const [mediaChoice, setMediaChoice] = useState<'thumbnail' | 'video'>('thumbnail')

  // Assembled copy-paste block for manual Group sharing: the (edited) post
  // text + hashtags + URL + FTC disclaimer. Reactive to textarea edits.
  // THE SAME POST AS THE PAGE. When the server composed the full caption
  // (product link + disclosure on top, the write-up, then the blog line, per
  // the creator's Link settings), the Group gets exactly that, with the
  // creator's edits to the write-up swapped in. Only when there is no composed
  // caption does it fall back to the plain text + link + disclaimer block.
  const [generatedText, setGeneratedText] = useState('')
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null)
  const [heroVideoUrl, setHeroVideoUrl] = useState<string | null>(null)
  const hashtagLine = (serverHashtags || shareHashtags || '').trim()
  const composed = finalText && generatedText && finalText.includes(generatedText.trim())
    ? finalText.replace(generatedText.trim(), text.trim())
    : ''
  const groupCopy = composed
    ? [composed, hashtagLine].filter(Boolean).join('\n\n')
    : [text.trim(), hashtagLine, (shareUrl || '').trim(), (shareDisclaimer || '').trim()].filter(Boolean).join('\n\n')

  // ── Fill with SCOUT: one click per Group ─────────────────────────────────
  // SCOUT opens the Group in the creator's own Facebook and fills this post
  // into "Write something"; the creator presses Post. The post is copied to
  // the clipboard first, so every way this can fail still leaves them one
  // paste away. What happened is shown per Group, and "filled" only shows
  // when SCOUT saw the text land in the box.
  const [groupFill, setGroupFill] = useState<Record<number, { state: 'working' } | { state: 'done'; filled: boolean; message: string; steps?: string }>>({})
  async function fillGroupWithScout(i: number, g: { name: string; url: string }) {
    try { await navigator.clipboard.writeText(groupCopy) } catch { /* the message below still says what to do */ }
    setGroupFill((m) => ({ ...m, [i]: { state: 'working' } }))
    const { requestFacebookGroupPrefill } = await import('@/lib/extension-frame')
    // The same hero as the Page post: the thumbnail attached, or the playable
    // YouTube card. Only sent when it exists, so SCOUT never waits for nothing.
    const media = mediaChoice === 'video' && heroVideoUrl
      ? { kind: 'video' as const, url: heroVideoUrl }
      : heroImageUrl ? { kind: 'thumbnail' as const, url: heroImageUrl } : null
    const res = await requestFacebookGroupPrefill(g.url, groupCopy, media)
    const label = g.name?.trim() || 'your Group'
    // Say what happened to the hero too, so "filled, but the image did not
    // attach" never reads the same as "filled, with the image".
    const mediaNote = res.media ? ` ${res.media}` : ''
    setGroupFill((m) => ({
      ...m,
      [i]: res.filled
        ? { state: 'done', filled: true, message: `SCOUT filled the post in ${label}.${mediaNote} Check it in the Facebook tab and press Post${groupFirstMode ? '. MVP shares it on your Page by itself' : ''}.`, steps: res.steps }
        : { state: 'done', filled: false, message: res.error || 'SCOUT could not fill it. The post is copied: paste it in the Group yourself.', steps: res.steps },
    }))
    if (res.filled) void watchGroupPost(i, g, res.watchId, !!res.canWatch)
  }

  // ── Then share the Group post on the Page ────────────────────────────────
  // Once the creator presses Post in the Group, SCOUT reads the new post's
  // address and MVP offers a short Page post linking to it. A link to a
  // Facebook Group post stays on Facebook, so it is not one of the outside
  // links Meta rations. Every way SCOUT can come back without the address is
  // its own message, with a box to paste the link, and the Page post is never
  // offered with a guessed link: the default is the post itself when SCOUT
  // read it, else the Group, and the message says which.
  type GroupShare = {
    phase: 'waiting' | 'ready' | 'posting' | 'shared'
    note: string
    tone: 'wait' | 'ok' | 'warn'
    link: string
    teaser: string
    error?: string
  }
  const [groupShare, setGroupShare] = useState<Record<number, GroupShare>>({})
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  function teaserFor(groupName: string) {
    const first = text.trim().split(/(?<=[.!?])\s+|\n+/)[0]?.trim() || ''
    const hook = first.length > 160 ? first.slice(0, 157).trimEnd() + '…' : first
    return [`New in ${groupName}:`, hook, 'The full post, links and all, is in the Group 👇'].filter(Boolean).join('\n\n')
  }
  // The Page post's words, prefilled once the post text has loaded.
  useEffect(() => {
    if (groupFirstMode && !pageTeaser && text.trim()) setPageTeaser(teaserFor(savedGroups[0]?.name?.trim() || 'my Group'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupFirstMode, text])
  async function watchGroupPost(i: number, g: { name: string; url: string }, watchId: string | undefined, canWatch: boolean) {
    const label = g.name?.trim() || 'your Group'
    const base = { link: g.url, teaser: teaserFor(label) }
    const set = (v: Partial<GroupShare>) => setGroupShare((m) => ({ ...m, [i]: { ...base, ...m[i], ...v } as GroupShare }))
    if (!canWatch || !watchId) {
      set({ phase: 'ready', tone: 'warn', note: 'Your SCOUT is too old to spot the post going up. After you press Post, paste the post\'s link below (click its time stamp in Facebook and copy the address), or share the Group itself.' })
      return
    }
    set({ phase: 'waiting', tone: 'wait', note: 'Waiting for you to press Post in the Facebook tab. SCOUT will spot the new post.' })
    const { getFacebookGroupPostStatus } = await import('@/lib/extension-frame')
    const end = Date.now() + 16 * 60 * 1000
    while (mounted.current && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 3000))
      const st = await getFacebookGroupPostStatus(watchId)
      if (st.state === 'watching') continue
      const manual = ' Paste the post\'s link below (click its time stamp in Facebook and copy the address), or share the Group itself.'
      if (st.state === 'posted' && st.url && isFacebookGroupLink(st.url)) {
        if (groupFirstMode) {
          // ONE CLICK: the creator pressed Post, so the Page post follows by
          // itself, linking to that exact Group post.
          set({ phase: 'posting', tone: 'wait', link: st.url, teaser: pageTeaser.trim() || base.teaser, note: `Posted in ${label}. Sharing it on your Page now…` })
          void shareGroupPostOnPage(i, { link: st.url, teaser: pageTeaser.trim() || base.teaser })
          return
        }
        set({ phase: 'ready', tone: 'ok', link: st.url, note: `Posted in ${label}. Share it on your Page? This links to the Group post itself, so it stays on Facebook.` })
      } else if (st.state === 'posted_no_link' || st.state === 'posted') {
        if (groupFirstMode) {
          // SCOUT saw it go up but not its address: the Page post links to
          // the Group itself, and says so.
          set({ phase: 'posting', tone: 'wait', link: g.url, teaser: pageTeaser.trim() || base.teaser, note: `Posted in ${label}. SCOUT could not read the post's own link, so the Page post links to your Group. Sharing it now…` })
          void shareGroupPostOnPage(i, { link: g.url, teaser: pageTeaser.trim() || base.teaser })
          return
        }
        set({ phase: 'ready', tone: 'warn', note: `SCOUT saw the post go up in ${label} but could not read its link.` + manual })
      } else if (st.state === 'closed') {
        set({ phase: 'ready', tone: 'warn', note: 'The Facebook tab closed before SCOUT saw the post go up.' + manual })
      } else if (st.state === 'not_seen') {
        set({ phase: 'ready', tone: 'warn', note: 'SCOUT did not see the post appear. If the Group holds posts for approval, it shows up once approved. If you posted it, share it below.' + manual })
      } else {
        set({ phase: 'ready', tone: 'warn', note: 'SCOUT stopped watching before it saw the post.' + manual })
      }
      return
    }
  }
  // The Facebook hub's record of what went where (app/api/facebook/hub).
  // Best effort: a record that fails to save never fails the post.
  function recordFacebookPush(r: { groupPostUrl: string | null; pagePostUrl: string | null; groupIdx: number }) {
    void fetch('/api/facebook/hub', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'blog', sourceId: postId, title: text.trim().split('\n')[0]?.slice(0, 160) || null, groupUrl: savedGroups[r.groupIdx]?.url ?? null, groupPostUrl: r.groupPostUrl, pagePostUrl: r.pagePostUrl }),
    }).catch(() => {})
  }
  async function shareGroupPostOnPage(i: number, auto?: { link: string; teaser: string }) {
    // auto: called from the watcher, where this render's groupShare is stale.
    const cur: GroupShare | undefined = auto
      ? { phase: 'ready', tone: 'wait', note: '', link: auto.link, teaser: auto.teaser }
      : groupShare[i]
    if (!cur) return
    if (!isFacebookGroupLink(cur.link)) {
      setGroupShare((m) => ({ ...m, [i]: { ...cur, error: 'The link has to be your Group or a post in it (facebook.com/groups/…).' } }))
      return
    }
    setGroupShare((m) => ({ ...m, [i]: { ...cur, phase: 'posting', error: undefined } }))
    try {
      const res = await fetch('/api/blog/facebook-group-teaser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: cur.teaser, link: cur.link, socialAccountId: effectiveExtraBody?.socialAccountId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `Facebook said no (${res.status})`)
      const where = isFacebookGroupPostLink(data.link) ? 'the Group post' : 'your Group'
      setGroupShare((m) => ({ ...m, [i]: { ...cur, phase: 'shared', tone: 'ok', note: `Done: posted in your Group, and shared on ${data.page || 'your Page'} linking to ${where}.` } }))
      recordFacebookPush({ groupPostUrl: cur.link, pagePostUrl: data.id ? `https://www.facebook.com/${data.id}` : null, groupIdx: i })
      if (groupFirstMode) onPublished()
    } catch (e) {
      // FAILED IS NOT DONE: the Group post is up, the Page post is not, and
      // the box stays open with the reason and a button to try it again.
      setGroupShare((m) => ({ ...m, [i]: { ...cur, phase: 'ready', tone: 'warn', note: 'Your Group post is up, but the Page post did not go out.', error: e instanceof Error ? e.message : 'The Page post failed.' } }))
      if (auto) recordFacebookPush({ groupPostUrl: cur.link, pagePostUrl: null, groupIdx: i })
    }
  }

  async function generate() {
    setLoadError(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, dryRun: true, ...extraBody }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Preview failed')
      setText(data.text || '')
      setGeneratedText(data.text || '')
      setFinalText(data.finalText || data.text || '')
      setHeroImageUrl(typeof data.imageUrl === 'string' ? data.imageUrl : null)
      setHeroVideoUrl(typeof data.videoUrl === 'string' ? data.videoUrl : null)
      if (typeof data.hashtags === 'string' && data.hashtags.trim()) setServerHashtags(data.hashtags.trim())
      if (typeof data.affiliateAvailable === 'boolean') setAffiliateAvailable(data.affiliateAvailable)
      if (typeof data.videoAvailable === 'boolean') {
        setVideoAvailable(data.videoAvailable)
        // A post with no video can't honour the video choice, so don't leave it
        // selected from a previous post in the same session.
        if (!data.videoAvailable) setMediaChoice('thumbnail')
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Preview failed')
    }
  }

  // Initial load
  useEffect(() => {
    let alive = true
    setLoading(true)
    generate().finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, endpoint])

  async function handleRegenerate() {
    setRegenerating(true)
    await generate()
    setRegenerating(false)
  }

  async function publish() {
    if (!text.trim()) return
    setPublishing(true)
    setPublishError(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, text, ...effectiveExtraBody, ...(isFacebook ? { media: mediaChoice } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Publish failed')
      // The post went out, but not necessarily carrying what was asked for.
      // Say so here: the modal closes on success, and a plain green tick is how
      // a creator keeps picking "video" for a month without ever getting one.
      if (typeof data.mediaNote === 'string' && data.mediaNote) toast.warning(data.mediaNote, { duration: 9000 })
      onPublished()
      onClose()
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  /** Schedule-for-later path. Posts to /api/blog/schedule-post with the
   *  user's edited text and the chosen ISO timestamp. */
  async function schedule() {
    if (!platformKey) return
    if (!text.trim()) return
    setScheduling(true)
    setScheduleError(null)
    try {
      // Build the ISO timestamp from the datetime-local string. The browser
      // returns it as local time without TZ — we treat it as the user's
      // local clock and convert to ISO for the server.
      const when = new Date(scheduledAt)
      if (isNaN(when.getTime())) throw new Error('Invalid date / time')
      const res = await fetch('/api/blog/schedule-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId,
          platform: platformKey,
          scheduledAt: when.toISOString(),
          text,
          ...effectiveExtraBody,
          ...(isFacebook ? { media: mediaChoice } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Schedule failed')
      onScheduled?.(when)
      onClose()
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Schedule failed')
    } finally {
      setScheduling(false)
    }
  }

  const panelRef = useRef<HTMLDivElement | null>(null)
  const onA11yKey = useModalA11y(true, panelRef, onClose)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
      onKeyDown={onA11yKey}
      role="presentation"
    >
      <div
        ref={panelRef}
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto outline-none"
        role="dialog"
        aria-modal="true"
        aria-label="Social preview"
        tabIndex={-1}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                style={{ background: brandColor }}
              >
                {platform.charAt(0)}
              </div>
              <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Preview {platform} post</h3>
            </div>
            <button onClick={onClose} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]">
              <X size={16} />
            </button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center gap-2 py-10 text-xs text-[#6e6e73]">
              <Loader2 size={18} className="animate-spin text-[#7C3AED]" />
              <span>Generating preview…</span>
            </div>
          ) : loadError ? (
            <div className="flex flex-col gap-3 py-6 text-center">
              <p className="text-xs text-[#ff3b30] flex items-center gap-1.5 justify-center">
                <AlertCircle size={12} /> {loadError}
              </p>
              <button onClick={handleRegenerate} className="text-xs text-[#7C3AED] hover:underline">Retry</button>
            </div>
          ) : (
            <>
              <div className="mb-3">
                <label className="text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1 flex items-center justify-between">
                  <span>Post text <span className="text-[#86868b]">({text.length} chars)</span></span>
                  <button
                    onClick={handleRegenerate}
                    disabled={regenerating}
                    className="text-[10px] text-[#7C3AED] hover:underline inline-flex items-center gap-1 disabled:opacity-60"
                  >
                    {regenerating ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Regenerate
                  </button>
                </label>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  rows={9}
                  className="w-full text-xs text-[#1d1d1f] dark:text-[#f5f5f7] p-3 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 focus:border-[#7C3AED] focus:outline-none leading-relaxed font-mono resize-none"
                  placeholder="Post body — edit freely"
                />
              </div>

              {finalText && finalText !== text && (
                <details className="mb-3 text-[11px] text-[#6e6e73] dark:text-[#ebebf0]">
                  <summary className="cursor-pointer hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]">
                    Preview what gets posted (with URL + disclaimer appended)
                  </summary>
                  <pre className="mt-2 p-3 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 whitespace-pre-wrap font-mono leading-relaxed">{finalText}</pre>
                </details>
              )}

              {/* Where the link points (blog / affiliate / both) is set once in
                  Link settings, at the top of the page — not per post. */}
              {isFacebook && affiliateAvailable && (
                <p className="mb-3 text-[11px] text-[#86868b] dark:text-[#8e8e93]">
                  The link destination (blog, affiliate, or both) is set in <strong className="font-semibold">Link settings</strong> at the top of the page.
                </p>
              )}

              {/* Facebook attachment choice. One attachment per post: the still
                  thumbnail, or the YouTube video as a playable card. The words,
                  the blog link and the disclaimer are the same either way; what
                  changes is the picture and where a tap on it lands. */}
              {isFacebook && (
                <div className="mb-4 rounded-xl border border-gray-200 dark:border-white/10 p-3">
                  <p className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">What Facebook shows</p>
                  <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mb-2">{groupFirstMode ? 'Used for your Group post.' : 'Used for your Page post, and for Groups when you use Fill with SCOUT.'}</p>
                  <label className="flex items-start gap-2 text-xs cursor-pointer mb-2">
                    <input
                      type="radio"
                      name="fb-media"
                      checked={mediaChoice === 'thumbnail'}
                      onChange={() => setMediaChoice('thumbnail')}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">The thumbnail as a hero image</span>
                      <span className="block text-[10px] text-[#86868b] dark:text-[#8e8e93] leading-relaxed">
                        A still photo post. Tapping it opens the photo on Facebook.
                      </span>
                    </span>
                  </label>
                  <label className={`flex items-start gap-2 text-xs ${videoAvailable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                    <input
                      type="radio"
                      name="fb-media"
                      disabled={!videoAvailable}
                      checked={mediaChoice === 'video'}
                      onChange={() => setMediaChoice('video')}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">The YouTube video, playable</span>
                      <span className="block text-[10px] text-[#86868b] dark:text-[#8e8e93] leading-relaxed">
                        {videoAvailable
                          ? 'Facebook builds a video card from your YouTube link: it plays in the feed on desktop and opens YouTube on mobile. Your blog link stays in the text above, but a tap on the card goes to YouTube.'
                          : 'This post has no YouTube video behind it, so there is nothing to play.'}
                      </span>
                    </span>
                  </label>
                </div>
              )}

              {/* NO GROUP YET: the nudge, before anything else. */}
              {isFacebook && groupFirst && savedGroups.length === 0 && (
                <div className="mb-4 rounded-xl border p-3 border-[#1877f2]/30 bg-[#1877f2]/[0.06]">
                  <p className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Set up your deals Group first</p>
                  <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mt-0.5">
                    Your Amazon links go in your own Facebook Group, and MVP shares each Group post on your Page for you.
                    It takes a few minutes, and the <a href="/meta" className="text-[#7C3AED] hover:underline font-semibold">Meta Hub</a> walks you through it.
                    Until then, this posts to your Page with the link.
                  </p>
                </div>
              )}

              {/* GROUP FIRST, ONE CLICK: what the Page will say, then a button
                  per Group. SCOUT fills the Group post, the creator presses
                  Post, and the Page post follows by itself. */}
              {groupFirstMode && (
                <div className="mb-3 rounded-xl border border-gray-200 dark:border-white/10 p-3">
                  <p className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">How this posts</p>
                  <ol className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed list-decimal pl-4 mt-1">
                    <li>SCOUT opens your Group and fills in the post above, with your affiliate link and picture. You press Post.</li>
                    <li>The moment it is up, MVP posts this on {activePageLabel || 'your Page'}, linking to it:</li>
                  </ol>
                  <textarea
                    value={pageTeaser}
                    onChange={(e) => setPageTeaser(e.target.value)}
                    rows={4}
                    aria-label="What your Page post says"
                    className="mt-2 w-full text-[11px] p-2 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]"
                  />
                </div>
              )}

              {/* Facebook manual-share: copy block + saved Groups. Only shown
                  when the caller passes shareUrl (the Facebook flow). */}
              {shareUrl && (
                <div className="mb-4 rounded-xl border border-gray-200 dark:border-white/10 p-3 bg-[#f5f5f7] dark:bg-white/5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{groupFirstMode ? 'Your Group post' : 'Post to a Facebook Group'}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(groupCopy).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7C3AED] hover:underline"
                    >
                      {copied ? <><CheckCircle size={11} /> Copied!</> : <><Copy size={11} /> Copy</>}
                    </button>
                  </div>
                  <pre className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-pre-wrap font-mono leading-relaxed max-h-32 overflow-y-auto p-2 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10">{groupCopy}</pre>
                  <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-1.5 leading-relaxed">
                    {groupFirstMode
                      ? 'Facebook lets no app press Post in a Group, so that one click is yours. Keep this window open until the Page post is done.'
                      : <>Facebook lets no app post to a Group by itself. <strong>Fill with SCOUT</strong> opens your Group and puts this post in the box, and you press Post. Or copy it and paste it yourself.</>}
                  </p>
                  {facebookGroups && facebookGroups.length > 0 ? (
                    <div className="mt-2 flex flex-col gap-1">
                      {facebookGroups.filter(g => g.url?.trim()).map((g, i) => {
                        const st = groupFill[i]
                        return (
                          <div key={i} className="flex flex-col gap-0.5">
                            <div className="flex items-center justify-between gap-2">
                              <a
                                href={g.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-[11px] text-[#1877f2] hover:underline min-w-0 truncate"
                              >
                                <Users size={11} /> {g.name?.trim() || g.url} <ExternalLink size={9} />
                              </a>
                              <button
                                type="button"
                                onClick={() => { void fillGroupWithScout(i, g) }}
                                disabled={st?.state === 'working' || !groupCopy || (groupFirstMode && !pageTeaser.trim())}
                                className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-[#1877f2] hover:bg-[#166fe0] disabled:opacity-60 rounded-md px-2 py-1"
                              >
                                {st?.state === 'working' ? <><Loader2 size={11} className="animate-spin" /> Filling…</> : groupFirstMode ? `Post to ${g.name?.trim() || 'Group'} + Page` : 'Fill with SCOUT'}
                              </button>
                            </div>
                            {st?.state === 'done' && (
                              <p
                                title={st.steps || undefined}
                                className={`text-[10px] leading-relaxed flex items-start gap-1 ${st.filled ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}
                              >
                                {st.filled ? <CheckCircle size={11} className="mt-px shrink-0" /> : <AlertCircle size={11} className="mt-px shrink-0" />}
                                <span>{st.message}</span>
                              </p>
                            )}
                            {groupShare[i] && (() => {
                              const sh = groupShare[i]
                              const tone = sh.tone === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : sh.tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-[#86868b] dark:text-[#8e8e93]'
                              return (
                                <div className="mt-1 ml-3 pl-2 border-l-2 border-[#1877f2]/30 flex flex-col gap-1">
                                  <p className={`text-[10px] leading-relaxed flex items-start gap-1 ${tone}`}>
                                    {sh.phase === 'waiting' ? <Loader2 size={11} className="mt-px shrink-0 animate-spin" /> : sh.tone === 'ok' ? <CheckCircle size={11} className="mt-px shrink-0" /> : <AlertCircle size={11} className="mt-px shrink-0" />}
                                    <span>{sh.note}</span>
                                  </p>
                                  {(sh.phase === 'ready' || sh.phase === 'posting') && (
                                    <>
                                      <textarea
                                        value={sh.teaser}
                                        onChange={(e) => { const v = e.target.value; setGroupShare((m) => ({ ...m, [i]: { ...m[i], teaser: v } })) }}
                                        rows={4}
                                        className="w-full text-[11px] p-2 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]"
                                      />
                                      <input
                                        value={sh.link}
                                        onChange={(e) => { const v = e.target.value; setGroupShare((m) => ({ ...m, [i]: { ...m[i], link: v } })) }}
                                        className="w-full text-[11px] px-2 py-1 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] font-mono"
                                        aria-label="Link the Page post points to"
                                      />
                                      <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">
                                        Links to {isFacebookGroupPostLink(sh.link) ? 'the Group post itself' : isFacebookGroupLink(sh.link) ? 'your Group, not one post' : 'something that is not your Group, so it cannot be posted'}.
                                      </p>
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() => { void shareGroupPostOnPage(i) }}
                                          disabled={sh.phase === 'posting' || !sh.teaser.trim() || !isFacebookGroupLink(sh.link)}
                                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-[#1877f2] hover:bg-[#166fe0] disabled:opacity-60 rounded-md px-2 py-1"
                                        >
                                          {sh.phase === 'posting' ? <><Loader2 size={11} className="animate-spin" /> Posting…</> : `Post to ${activePageLabel || 'my Page'}`}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setGroupShare((m) => { const n = { ...m }; delete n[i]; return n })}
                                          className="text-[10px] text-[#86868b] hover:underline"
                                        >
                                          No thanks
                                        </button>
                                      </div>
                                      {sh.error && <p className="text-[10px] text-red-600 dark:text-red-400">{sh.error}</p>}
                                    </>
                                  )}
                                </div>
                              )
                            })()}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-2">
                      No groups saved yet. Add them in <a href="/brand" className="text-[#7C3AED] hover:underline">Brand Profile</a> to list them here.
                    </p>
                  )}
                </div>
              )}

              {/* Schedule-for-later toggle + date picker (only when caller
                  passed a platformKey — i.e. one of the 6 supported
                  schedulable platforms). */}
              {platformKey && !groupFirstMode && (
                <div className="mb-4">
                  <label className="flex items-center gap-2 text-xs cursor-pointer mb-2">
                    <input
                      type="checkbox"
                      checked={scheduleEnabled}
                      onChange={e => setScheduleEnabled(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-1.5">
                      <Calendar size={11} className="text-[#86868b]" />
                      Schedule for later
                    </span>
                  </label>
                  {scheduleEnabled && (
                    <div className="pl-6">
                      <input
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={e => setScheduledAt(e.target.value)}
                        min={defaultScheduleString()}
                        className="w-full text-xs px-3 py-2 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 focus:border-[#7C3AED] focus:outline-none"
                      />
                      <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-1.5 leading-relaxed">
                        Times are in your local timezone ({tzAbbrev()}). The post fires automatically, you don&apos;t need to keep the app open.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Facebook Page picker — pick which connected Page to publish to,
                  right here. Falls back to a static label for a single Page or
                  for platforms that don't pass a page list. Kept visible when
                  scheduling too: the scheduled payload also carries
                  socialAccountId, so hiding it silently sent scheduled posts to
                  the default Page on multi-Page accounts. */}
              {hasPagePicker ? (
                <div className="mb-2 flex items-center gap-2 rounded-lg bg-[#1877f2]/8 border border-[#1877f2]/20 px-3 py-2">
                  <CheckCircle size={12} className="text-[#1877f2] flex-shrink-0" />
                  <span className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7] flex-shrink-0">Publish to Page:</span>
                  <select
                    value={selectedPageId ?? ''}
                    onChange={(e) => setSelectedPageId(e.target.value)}
                    className="flex-1 min-w-0 text-[11px] font-semibold rounded-md border border-[#1877f2]/30 bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] px-2 py-1"
                  >
                    {facebookPages!.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.isDefault ? ' (default)' : ''}</option>
                    ))}
                  </select>
                </div>
              ) : publishTargetLabel && !scheduleEnabled ? (
                <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-[#1877f2]/8 border border-[#1877f2]/20 px-3 py-2">
                  <CheckCircle size={12} className="text-[#1877f2] flex-shrink-0" />
                  <span className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                    Publish posts to your Page: <span className="font-semibold">{publishTargetLabel}</span>
                  </span>
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={onClose}
                  disabled={publishing || scheduling}
                  className="text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] px-3 py-2 disabled:opacity-60"
                >
                  {groupFirstMode ? 'Close' : 'Cancel'}
                </button>
                {groupFirstMode ? null : scheduleEnabled && platformKey ? (
                  <button
                    onClick={schedule}
                    disabled={scheduling || !text.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                    style={{ background: brandColor }}
                  >
                    {scheduling
                      ? <><Loader2 size={12} className="animate-spin" /> Scheduling…</>
                      : <><Calendar size={12} /> Schedule for {platform}</>
                    }
                  </button>
                ) : (
                  <button
                    onClick={publish}
                    disabled={publishing || !text.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                    style={{ background: brandColor }}
                  >
                    {publishing
                      ? <><Loader2 size={12} className="animate-spin" /> Publishing…</>
                      : <><CheckCircle size={12} /> Publish to {activePageLabel || platform}</>
                    }
                  </button>
                )}
              </div>
              {publishError && <p className="text-[11px] text-[#ff3b30] mt-3 break-all">{publishError}</p>}
              {scheduleError && <p className="text-[11px] text-[#ff3b30] mt-3 break-all">{scheduleError}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Returns a "YYYY-MM-DDTHH:mm" string for <input type="datetime-local">
 *  pointing at now + 1 hour, rounded to the next 5-minute mark. */
function defaultScheduleString(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  const m = d.getMinutes()
  d.setMinutes(Math.ceil(m / 5) * 5, 0, 0)
  // Local components (datetime-local has no timezone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
