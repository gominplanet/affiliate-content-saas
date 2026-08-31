// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// GenerateButton — the per-row "Generate post" CTA. Four visible states:
//
//   idle       — purple "Generate post" with the include-photos checkbox
//   generating — spinner + step caption ("Reading transcript…"). The
//                "no transcript — generate anyway?" confirm dialog is
//                raised mid-flight from inside generate() itself.
//   done       — green "View post" + image diagnostic + Rewrite (Pro)
//                + Add/Re-roll images. Receives `existingPost` to skip
//                straight to this state for already-live posts.
//   error      — red message + Retry link.
//
// Owns all of: generate(), the rewrite-flow modal handoff, the
// in-article images auto-trigger + manual re-roll path, and the
// "bring-your-own photos" upload (storage of user images to Supabase
// → URLs handed to the generate route as userImageUrls).
//
// Extracted from app/(dashboard)/content/page.tsx 2026-06-07. Was the
// biggest leaf inside the VideoCard subtree.
'use client'

import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { AlertCircle, CheckCircle, ExternalLink, Loader2, RefreshCw, Upload, Wand2, X } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/ui/useConfirm'
import { dispatchCapReached } from '@/components/CapReachedBanner'
import { type Tier } from '@/lib/tier'
import { RewriteFeedbackModal } from '@/components/content/RewriteFeedbackModal'
import { errText } from '@/lib/err-text'
import { generateBlogRequest } from '@/lib/blog-generate-client'

// ── Generation status ───────────────────────────────────────────────────
// 'pending' = the job ran past our wait window but is STILL generating in the
// background (it isn't a failure — it lands in the Library on its own). Shown as
// calm info, never a red error with a duplicate-causing Retry.
type GenStatus = 'idle' | 'generating' | 'done' | 'error' | 'pending'

// Cosmetic step indicator while /api/blog/generate is in flight. The image
// step is intentionally NOT here — image generation runs fire-and-forget
// AFTER this fetch returns (see the IIFE in generate() below), so the
// spinner used to lie by sitting on "Adding product photos…" for minutes
// while the route was still doing transcript/body/WP work.
//
// The last three entries (>27s) are the truth: large posts legitimately
// take 1-3 minutes of body generation + WP publish before the response
// ships. The "Still working…" entries reassure the user without claiming
// progress we can't observe from the client.
const GEN_STEPS = [
  'Reading transcript…',
  'Writing the blog post…',
  'Publishing to WordPress…',
  'Still working — large posts can take a couple minutes…',
  'Almost there — finalising the post…',
  'Running in the background — a busy queue can add a few minutes. Safe to keep browsing…',
]
// Hard client-side abort if generation hasn't resolved in this many ms.
// With the async queue (Phase 4) the request is enqueue + poll: worker
// pickup adds up to ~60s and the job itself runs 2-4 min server-side. This
// fuse must sit just PAST the poll helper's own ceiling (MAX_POLL_MS, 13 min)
// so the poll's friendlier "still running in the background — check your
// Library" result wins the race instead of a bare abort. On the sync fallback
// path a dead server still surfaces earlier as a network error.
const GENERATE_ABORT_MS = 840_000 // 14 min (> MAX_POLL_MS 13 min)

export function GenerateButton({
  videoId, existingPost, userTier, blogImagePref, onDone,
  includeImages: includeImagesProp, onIncludeImagesChange, siteId,
}: {
  videoId: string
  /** Multi-site (Pro): the blog this generation targets. Passed into the
   *  generate request so a fresh post lands on the chosen site. Omitted/null
   *  falls back to the user's default site server-side. */
  siteId?: string | null
  /** YouTube native id — historically used for extension-side frame
   *  capture; kept on the call-site signature for backwards compat
   *  but no longer read here (storyboards path handles it server-side). */
  youtubeVideoId?: string
  existingPost?: { url: string; title: string; postId?: string; wpPostId?: number; indexed?: boolean | null; coverage?: string | null; bodyImagesCount?: number | null; imagesStatus?: string | null } | null
  /** Drives whether the Rewrite button shows at all (Pro/Admin only). */
  userTier: Tier
  /** The user's saved Brand Profile → "Images per article" preference
   *  (`brand_profiles.blog_image_count`): null = Default/auto, 0 = text-only,
   *  1..N = explicit count. When they picked an explicit ≥1 they've already
   *  opted into images (and the cost), so we pre-tick "Include photos" below
   *  instead of silently ignoring their choice. Null/0 keep the checkbox off
   *  (opt-in default preserved for everyone who hasn't asked). */
  blogImagePref?: number | null
  onDone: (url: string, title: string, postId: string) => void
  /** Controlled "Include photos" state, lifted to the parent card so the
   *  card's "Generate + publish all" and "Schedule" buttons honor the SAME
   *  checkbox the user sees here. When omitted, the button falls back to its
   *  own internal state (unchanged for any other call site). */
  includeImages?: boolean
  onIncludeImagesChange?: (v: boolean) => void
}) {
  const [status, setStatus] = useState<GenStatus>(existingPost ? 'done' : 'idle')
  const [stepIdx, setStepIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Set when the pre-flight blocked because WordPress is refusing writes — the
  // error offers "Run Connection Doctor" instead of a Retry that would just
  // hit the same wall.
  const [needsDoctor, setNeedsDoctor] = useState(false)
  const [result, setResult] = useState(existingPost || null)
  // In-line "Add images" action on already-published rows. Was previously
  // only available on the older-posts simple list; rich VideoCard rows
  // had no path to retry image gen, so a post with 🖼 ! (failed images)
  // was stuck unless the user manually clicked Rewrite (Pro, one-shot).
  // 2026-06-07 fix.
  const [addingImages, setAddingImages] = useState(false)
  async function addImagesNow() {
    if (!result || !existingPost?.wpPostId) {
      toast.error('Missing post id — refresh the page and try again')
      return
    }
    setAddingImages(true)
    try {
      const res = await fetch('/api/blog/refresh-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wordpressPostId: existingPost.wpPostId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || `Couldn't add images (${res.status}).`)
        return
      }
      const count = typeof j.count === 'number' ? j.count : 0
      const similarPairs = typeof j.similarPairsCount === 'number' ? j.similarPairsCount : 0
      setResult((prev) => prev ? { ...prev, bodyImagesCount: count, imagesStatus: count > 0 ? 'ready' : 'failed' } : prev)
      if (count > 0 && similarPairs > 0) {
        toast.warning(`Added ${count} image${count === 1 ? '' : 's'}, but ${similarPairs} pair${similarPairs === 1 ? '' : 's'} look similar — consider Re-rolling`, { duration: 7000 })
      } else if (count > 0) {
        toast.success(`Added ${count} image${count === 1 ? '' : 's'}`)
      } else {
        toast.error('Refreshed — but 0 images landed (check WP media upload).')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Image step failed')
    } finally {
      setAddingImages(false)
    }
  }
  // Rewrite modal — opens when a Pro user hits the Rewrite button on a
  // published post. Captures the "what's missing" feedback before
  // firing the regeneration so the second draft is actually different.
  const [rewriteOpen, setRewriteOpen] = useState(false)
  const [rewriteFeedback, setRewriteFeedback] = useState('')
  // Per-generation choice: drop in-article photos into the post body, or
  // ship a text-only post. When the box is ticked we attempt to add 2–3
  // in-article photos (storyboard-frame retouches or Amazon-product re-stages)
  // — the extra AI cost is why it's opt-in.
  //
  // Seed from the user's saved Brand Profile → "Images per article" pref
  // (`blogImagePref`): if they explicitly picked ≥1 they've already opted in,
  // so pre-tick the box (fixes the "I set images to 1 per post but posts ship
  // with none" report — the pref only set the COUNT, never flipped this gate,
  // so nothing was generated). Null (Default/auto) and 0 (text-only) keep it
  // off, preserving the opt-in default for anyone who hasn't asked. The user
  // can still tick/untick per post.
  // Controlled-or-internal: when the parent card passes includeImagesProp +
  // onIncludeImagesChange, that lifted state wins (so Generate+publish-all and
  // Schedule share this exact toggle). Otherwise fall back to local state,
  // seeded from the Brand Profile "Images per article" pref as before.
  const [internalIncludeImages, setInternalIncludeImages] = useState(
    typeof blogImagePref === 'number' && blogImagePref >= 1,
  )
  const includeImages = includeImagesProp ?? internalIncludeImages
  const setIncludeImages = (v: boolean) => (onIncludeImagesChange ?? setInternalIncludeImages)(v)
  // Opt-in: swap the featured image for an Art Director-designed blog hero
  // (uses a thumbnail credit). Off by default. 2026-08.
  const [artThumb, setArtThumb] = useState(false)
  // Optional: bring-your-own in-article images. Three fixed slots (image 1, 2,
  // 3), each optional, one photo per slot. When any are filled, THOSE are placed
  // through the post INSTEAD of AI-generated photos. Fixed-length array so each
  // slot stays put; empties are stripped before sending.
  const [userImages, setUserImages] = useState<(string | null)[]>([null, null, null])
  const [imgBusyIdx, setImgBusyIdx] = useState<number | null>(null)
  const [imgErr, setImgErr] = useState<string | null>(null)
  const imgInputRef0 = useRef<HTMLInputElement>(null)
  const imgInputRef1 = useRef<HTMLInputElement>(null)
  const imgInputRef2 = useRef<HTMLInputElement>(null)
  const imgInputRefs = [imgInputRef0, imgInputRef1, imgInputRef2]
  const supabase = createBrowserClient()
  const { confirm, ConfirmHost } = useConfirm()

  useEffect(() => {
    if (status !== 'generating') return
    // 25s per step ≈ matches the realistic generate timeline (read 25s,
    // write 25–60s, publish 5–20s, then the two "still working" captions
    // cover the long tail). Bumped from 9s — 9s burned through the whole
    // list in 36s and then sat on the last caption indefinitely.
    const interval = setInterval(() => setStepIdx((i) => (i < GEN_STEPS.length - 1 ? i + 1 : i)), 25000)
    return () => clearInterval(interval)
  }, [status])

  // Upload one photo into a specific slot (0, 1, 2). Replaces whatever is there.
  async function uploadSlot(idx: number, files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    setImgErr(null)
    if (!f.type.startsWith('image/')) { setImgErr('Images only'); return }
    if (f.size > 10 * 1024 * 1024) { setImgErr('Each image must be under 10 MB'); return }
    setImgBusyIdx(idx)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const ext = f.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${user.id}/blog/${videoId}/${crypto.randomUUID()}.${ext}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.storage as any).from('product-images').upload(path, f, {
        cacheControl: '31536000', upsert: false, contentType: f.type || 'image/jpeg',
      })
      if (upErr) throw new Error(upErr.message || 'Upload failed')
      const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(path)
      if (urlData?.publicUrl) {
        const url = urlData.publicUrl
        setUserImages(prev => { const n = [...prev]; n[idx] = url; return n })
      }
    } catch (e) {
      setImgErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setImgBusyIdx(null)
      const ref = imgInputRefs[idx]?.current
      if (ref) ref.value = ''
    }
  }

  function clearSlot(idx: number) {
    setUserImages(prev => { const n = [...prev]; n[idx] = null; return n })
  }

  async function generate(opts?: { rewriteFeedback?: string }) {
    setStatus('generating')
    setStepIdx(0)
    setError(null)
    setNeedsDoctor(false)
    try {
      // Frame capture used to live here — the extension would open a YouTube
      // tab in the background to scrub HD frames. That tab-opening is what
      // the user kept seeing, and it's no longer needed: /api/blog/generate
      // now pulls evenly-spaced frames from YouTube's own storyboard tiles
      // server-side (lib/youtube-storyboards) — same "real frames" benefit,
      // zero browser tabs, no extension required.
      const callGenerate = async (allowEmptyTranscript = false) => {
        // Hard client-side abort so a stuck server doesn't leave the user
        // staring at a spinner forever. The server's maxDuration is 300s;
        // we abort just before that with a useful error message.
        const ctrl = new AbortController()
        const abortTimer = setTimeout(() => ctrl.abort(), GENERATE_ABORT_MS)
        try {
          // Phase 4 increment C: route through the async queue when enabled
          // (enqueue + poll), with a transparent sync fallback when it isn't —
          // see lib/blog-generate-client. Response-compatible, so the abort +
          // error handling below is unchanged.
          const r = await generateBlogRequest({
            videoId,
            includeImages,
            ...(artThumb ? { artDirectorThumbnail: true } : {}),
            ...(siteId ? { siteId } : {}),
            ...(includeImages && userImages.some(Boolean) ? { userImageUrls: userImages.filter((u): u is string => !!u) } : {}),
            ...(opts?.rewriteFeedback ? { rewriteFeedback: opts.rewriteFeedback } : {}),
            ...(allowEmptyTranscript ? { allowEmptyTranscript: true } : {}),
          }, ctrl.signal)
          let d: Record<string, unknown> = {}
          try { d = await r.json() } catch { throw new Error(`Server error (${r.status}) — check Vercel logs`) }
          return { res: r, data: d }
        } catch (e) {
          // DOMException name 'AbortError' = our abort fired. Rewrite the
          // message so the user sees something they can act on, not a
          // bare "The user aborted a request."
          if (e instanceof DOMException && e.name === 'AbortError') {
            throw new Error('Generation took unusually long (>10 min) and the page stopped waiting — the post is likely still finishing in the background. Refresh the page in a minute or two and check your Library before retrying; if it keeps happening, check Vercel logs or your WordPress site.')
          }
          // "Failed to fetch" — browser-level TypeError thrown when the
          // connection drops BEFORE any HTTP response (Vercel killed the
          // function at maxDuration, ISP hiccup, server crash). The
          // post may have published on the server even though we never
          // saw the response, so the action is the same as the abort:
          // refresh and check before retrying.
          if (e instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(e.message)) {
            throw new Error('Lost connection to the server before getting a response. The post may have published anyway — refresh the page to check. If it didn\'t land, retry; if it keeps failing, the WordPress site or Vercel function may be down.')
          }
          throw e
        } finally {
          clearTimeout(abortTimer)
        }
      }
      let { res, data } = await callGenerate(false)
      // If the gate fires, give the user a one-click "generate anyway" with
      // the quality caveat clear — they keep control without us silently
      // proceeding.
      if (!res.ok && data.reason === 'no_transcript') {
        const proceed = await confirm({
          title: 'No transcript available — generate anyway?',
          description:
            'Without a transcript the post will be shorter and less specific (no lived experiences to ground on). ' +
            'Recommended: enable captions in YouTube Studio → Subtitles, then retry — auto-captions usually appear within 24h.',
          confirmLabel: 'Generate anyway',
          cancelLabel: 'Wait for captions',
        })
        if (proceed) {
          ;({ res, data } = await callGenerate(true))
        }
      }
      // Review-worthiness gate (no product + thin transcript). The sync path
      // returns reason: 'not_reviewable'; the async path surfaces only the
      // failed job's error TEXT, so match the stable phrase as a fallback.
      const notReviewable = data.reason === 'not_reviewable'
        || /short clip with no product attached/i.test(String(data.error || ''))
      if (!res.ok && notReviewable) {
        const proceed = await confirm({
          title: 'Short clip with no product — generate anyway?',
          description:
            'MVP couldn\'t find a product on this video (no Amazon link or ASIN in the title/description) and the transcript is too thin to ground a review. ' +
            'Best fix: add the product link to the first lines of the video\'s YouTube description, then retry — you\'ll get a full review with your affiliate link. ' +
            '"Generate anyway" publishes a general post with no affiliate link.',
          confirmLabel: 'Generate anyway',
          cancelLabel: 'I\'ll add the product link',
        })
        if (!proceed) {
          setStatus('idle')
          return
        }
        ;({ res, data } = await callGenerate(true))
      }
      if (!res.ok) {
        if (data.limitReached) {
          dispatchCapReached(
            (data.error as string) || 'You\'ve hit your posts cap for this period.',
            {
              cap: (data.cap as string) || 'posts',
              currentTier: data.currentTier as string | undefined,
              upgrade: data.upgrade as { tier: string; label: string; limit: number | null } | null | undefined,
            },
          )
          setStatus('idle')
          return
        }
        // Pre-flight blocked the publish: WordPress is refusing writes. Offer the
        // Connection Doctor instead of a Retry (which would replay the same
        // wall). No generation was consumed.
        if (data.reason === 'wp_connection') {
          setNeedsDoctor(true)
          setError(errText(data.error) || 'Your WordPress connection is blocked — run the Connection Doctor to fix it, then try again.')
          setStatus('error')
          return
        }
        throw new Error(errText(data.error) || 'Generation failed')
      }
      setResult({ url: data.wordpressUrl as string, title: data.title as string })

      // The AI in-article image step lives inside the generate route's
      // after() block. Vercel routinely cuts that block off before the slow
      // fal calls (~30-90s of work after the response ships) — so on most
      // initial generations the post lands text-only even when "Include
      // photos" was ticked. Refresh-images is the exact same image-gen
      // path running as a fresh synchronous request, which works
      // reliably. Auto-trigger it here so the user gets images on the
      // FIRST attempt instead of having to manually hit "Refresh images"
      // after every post. Skipped when the user uploaded their own
      // images (those flow through a different, fast branch that does
      // complete inside after()).
      // Image gen runs as a fire-and-forget background task. Image
      // generation legitimately takes 1-3 minutes (multiple fal calls,
      // Vision picks, WP uploads). Blocking the UI on it was the
      // "spinner hangs forever" bug the user reported — they saw the
      // post go live, no image, "Adding product photos…" stuck.
      //
      // New flow: flip the GenerateButton to 'done' immediately. The
      // image work runs in the background and lands a toast when it
      // either succeeds or fails. The user can keep doing other
      // things — no blocking. 2026-06-08.
      if (includeImages && !userImages.some(Boolean) && data.wordpressPostId) {
        const wpPostId = data.wordpressPostId
        toast.loading('Generating in-article images… (1-3 minutes — you can keep working)', {
          id: `img-gen-${wpPostId}`,
          duration: Infinity,  // dismissed by the success/fail toast below
        })
        // Intentionally NOT awaited — fire-and-forget. Errors land in
        // the .catch below; the function returns immediately.
        ;(async () => {
          try {
            const imgRes = await fetch('/api/blog/refresh-images', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ wordpressPostId: wpPostId }),
            })
            const imgData: Record<string, unknown> = await imgRes.json().catch(() => ({}))
            if (imgRes.ok && typeof imgData.count === 'number') {
              const count = imgData.count
              // Reflect the count on the badge so the user sees "🖼 N"
              // without a Content-page reload.
              setResult((prev) => prev ? { ...prev, bodyImagesCount: count } : prev)
              if (count > 0) {
                toast.success(`Added ${count} in-article image${count === 1 ? '' : 's'}`, {
                  id: `img-gen-${wpPostId}`,
                  duration: 5000,
                })
              } else {
                toast.warning(
                  'Image gen returned 0 images. Check Brand Profile → "Images per article", or click Images on the post row to retry.',
                  { id: `img-gen-${wpPostId}`, duration: 10000 },
                )
              }
            } else if (!imgRes.ok) {
              const msg = (imgData.error as string | undefined) || `Couldn't add in-article images (${imgRes.status}).`
              toast.error(`${msg} Click Images on the post row to retry.`, {
                id: `img-gen-${wpPostId}`,
                duration: 10000,
              })
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Image step failed.'
            toast.error(`${msg} Click Images on the post row to retry.`, {
              id: `img-gen-${wpPostId}`,
              duration: 10000,
            })
          }
        })()
      }

      // Flip to 'done' immediately — the post is up, the user can
      // move on. Image gen (if requested) keeps running in the
      // background per the IIFE above.
      setStatus('done')
      // The Art Director thumbnail renders in the background and lands a minute
      // or two after the post is up — tell the user so it doesn't look skipped.
      if (artThumb) toast.success('Your new thumbnail is rendering and will appear on the post in a minute or two.', { duration: 7000 })
      onDone(data.wordpressUrl as string, data.title as string, data.postId as string)
    } catch (err: unknown) {
      let message = err instanceof Error ? err.message : 'Unknown error'
      // Raw JSON parse error = server returned an HTML error page instead of JSON
      // (Vercel crash, redirect to login, etc.). Convert to something actionable.
      if (/Unexpected token.*<|is not valid JSON/i.test(message)) {
        message = 'Server returned an unexpected response — it may have crashed. Check Vercel logs, or try again in a moment.'
      }
      setError(message)
      // "Still finishing in the background" / "may have published anyway" are NOT
      // failures — the job keeps running server-side and lands in the Library. Show
      // them as calm INFO (no red, no Retry that would spin up a duplicate).
      const stillRunning = /still (being generated|finishing) in the background|taking longer than usual|may have published|likely still finishing/i.test(message)
      setStatus(stillRunning ? 'pending' : 'error')
    }
  }

  const isPro = userTier === 'pro' || userTier === 'admin'

  if (status === 'done' && result) {
    return (
      <div className="flex items-center gap-2">
        <a href={result.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-medium text-[#34c759] hover:underline">
          <CheckCircle size={13} /> View post <ExternalLink size={11} />
        </a>
        {/* Google indexing status (from the nightly cron + on-demand re-checks).
            ✓ = in Google's index. ⚠️ = not in the index yet (new posts can take
            days; old ones that flip back to this state may have been dropped).
            Null/undefined = no signal yet → hide the badge. */}
        {result.indexed === true && (
          <span className="inline-flex items-center text-[#34c759]" title="Indexed by Google — it shows in search results.">
            <CheckCircle size={12} />
          </span>
        )}
        {result.indexed === false && (
          <span className="inline-flex items-center text-[#ff9500]" title={result.coverage || 'Not in Google’s index yet — new posts can take days to weeks. Open the SEO page to request indexing.'}>
            <AlertCircle size={12} />
          </span>
        )}
        {/* In-article image diagnostic — read straight off blog_posts.body_images_count.
            null  → either the user didn't tick "Include photos", or the after()
                    block that does image-gen hasn't completed yet (legacy posts
                    pre-this-column also stay null). Hide the badge entirely so
                    we don't yell at people whose tick was deliberately off.
            0     → after() ran but failed to insert anything — the actual case
                    we shipped this column to surface (Hostinger WAF, fal
                    hiccup, prompt empty). Orange ⚠ "Images failed".
            >0    → green count, e.g. "🖼 3". */}
        {typeof result.bodyImagesCount === 'number' && result.bodyImagesCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[#34c759]" title={`${result.bodyImagesCount} in-article image${result.bodyImagesCount === 1 ? '' : 's'} added to this post.`}>
            <span aria-hidden>🖼</span><span className="text-[10px] font-semibold">{result.bodyImagesCount}</span>
          </span>
        )}
        {/* Image-pass state — now driven by images_status (migration 246) so we
            can tell "failed" (asked for images, got none → retry me) apart from a
            deliberate text-only post, which the old count-only check couldn't.
            Falls back to the count for legacy rows written before the column. */}
        {result.imagesStatus === 'pending' && (
          <span className="inline-flex items-center gap-1 text-[#86868b] dark:text-[#8e8e93]" title="In-article images are still generating — this can take 1-3 minutes.">
            <Loader2 size={11} className="animate-spin" /><span className="text-[10px] font-semibold">Images…</span>
          </span>
        )}
        {(result.imagesStatus === 'failed' || (!result.imagesStatus && result.bodyImagesCount === 0)) && (
          <span className="inline-flex items-center gap-0.5 text-[#ff9500] font-semibold" title="You asked for in-article images but none made it in. Click ‘Retry images’. If it keeps failing, check WordPress media upload (a Hostinger/WAF block on POST /wp-json/wp/v2/media is the usual cause).">
            <span aria-hidden>🖼</span><span className="text-[10px]">Images failed</span>
          </span>
        )}
        {/* "Add images" — visible on EVERY published row (not just rows
            with 🖼 ! warning) so the user can also re-roll images on
            posts that already have some. wpPostId on existingPost is
            populated for every row that came from the Library load. */}
        {existingPost?.wpPostId && (
          <button
            onClick={addImagesNow}
            disabled={addingImages}
            className="flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#34c759] transition-colors disabled:opacity-60"
            title={result.bodyImagesCount && result.bodyImagesCount > 0
              ? 'Regenerate in-article images (replaces any existing ones)'
              : 'Generate in-article images for this post'}
          >
            {addingImages
              ? <><Loader2 size={11} className="animate-spin" /> Adding…</>
              : <><Wand2 size={11} /> {result.imagesStatus === 'failed' || (!result.imagesStatus && result.bodyImagesCount === 0) ? 'Retry images' : result.bodyImagesCount && result.bodyImagesCount > 0 ? 'Re-roll images' : 'Add images'}</>
            }
          </button>
        )}
        {/* Rewrite is Pro-only and one-shot per post. Non-Pro users
            see no button — they manually edit the post in WordPress. */}
        {isPro && (
          <button
            onClick={() => { setRewriteFeedback(''); setRewriteOpen(true) }}
            className="flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#7C3AED] transition-colors"
            title="Rewrite this post once with fresh AI content based on your feedback"
          >
            <RefreshCw size={11} /> Rewrite
          </button>
        )}
        {rewriteOpen && (
          <RewriteFeedbackModal
            value={rewriteFeedback}
            onChange={setRewriteFeedback}
            onCancel={() => setRewriteOpen(false)}
            onSubmit={() => {
              const fb = rewriteFeedback.trim()
              setRewriteOpen(false)
              if (fb.length === 0) return
              generate({ rewriteFeedback: fb })
            }}
          />
        )}
      </div>
    )
  }
  if (status === 'generating') {
    return (
      <div className="flex items-center gap-2 text-xs text-[#6e6e73] dark:text-[#ebebf0]">
        <Loader2 size={13} className="animate-spin text-[#7C3AED]" />
        <span>{GEN_STEPS[stepIdx]}</span>
        {/* ConfirmHost is required so the "no transcript — generate anyway?"
            dialog (raised from inside generate() right after status flips to
            'generating') has a host in this branch's tree. */}
        <ConfirmHost />
      </div>
    )
  }
  if (status === 'pending') {
    // Still generating in the background — NOT a failure. Calm amber, and a
    // "Refresh" (not "Retry") so the user picks up the finished post from the
    // Library instead of kicking off a duplicate generation.
    return (
      <div className="flex flex-col gap-1 rounded-lg px-2.5 py-2"
        style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)' }}>
        <p className="text-xs" style={{ color: '#b26a00' }}>{error}</p>
        <button onClick={() => window.location.reload()} className="text-xs text-[#7C3AED] hover:underline text-left">Refresh to check →</button>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-[#ff3b30] line-clamp-3">{error}</p>
        {needsDoctor ? (
          <a href="/setup/wp-doctor" className="text-xs text-[#7C3AED] hover:underline text-left font-semibold">Run Connection Doctor →</a>
        ) : (
          <button onClick={() => generate()} className="text-xs text-[#7C3AED] hover:underline text-left">Retry →</button>
        )}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5 flex-wrap">
        <button onClick={() => generate()} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#7C3AED] text-white text-xs font-semibold rounded-lg hover:bg-[#7C3AED]/90 transition-colors">
          <Wand2 size={12} /> Generate post
        </button>
        <label
          className="flex items-center gap-1.5 text-[11px] text-[#6e6e73] dark:text-[#ebebf0] cursor-pointer select-none"
          title={
            typeof blogImagePref === 'number' && blogImagePref >= 1
              ? `Pre-ticked from your Brand Profile → "Images per article" (${blogImagePref}). Add photos to the post body, or uncheck for a text-only post.`
              : 'Add photos to the post body. Uncheck for a text-only post. Tip: set a default in Brand Profile → "Images per article".'
          }
        >
          <input
            type="checkbox"
            checked={includeImages}
            onChange={(e) => setIncludeImages(e.target.checked)}
            className="accent-[#7C3AED] w-3.5 h-3.5"
          />
          Include photos in the article
        </label>
        <label
          className="flex items-center gap-1.5 text-[11px] text-[#6e6e73] dark:text-[#ebebf0] cursor-pointer select-none"
          title="Replace the post's featured image with an Art Director-designed thumbnail built from the real product. Great for older videos with a plain YouTube thumb. Uses one thumbnail credit."
        >
          <input
            type="checkbox"
            checked={artThumb}
            onChange={(e) => setArtThumb(e.target.checked)}
            className="accent-[#7C3AED] w-3.5 h-3.5"
          />
          Update my post thumbnail with Art Director <span className="text-[#86868b]">(1 thumbnail)</span>
        </label>
      </div>

      {includeImages && (
        <div className="flex flex-col gap-1.5">
          {/* Three optional slots — one photo each. Empty slots fall back to an
              AI-generated photo; filled ones are used as-is, in order. */}
          <div className="flex items-center gap-2 flex-wrap">
            {[0, 1, 2].map((idx) => {
              const u = userImages[idx]
              const busy = imgBusyIdx === idx
              return (
                <div key={idx} className="flex flex-col items-center gap-1">
                  <input
                    ref={imgInputRefs[idx]}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => uploadSlot(idx, e.target.files)}
                  />
                  {u ? (
                    <div className="relative w-14 h-14 rounded-md overflow-hidden border border-gray-200 dark:border-white/10">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={`Article image ${idx + 1}`} className="w-full h-full object-cover" />
                      <button
                        onClick={() => clearSlot(idx)}
                        aria-label={`Remove image ${idx + 1}`}
                        className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 hover:bg-[#ff3b30] text-white flex items-center justify-center"
                      >
                        <X size={9} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => imgInputRefs[idx]?.current?.click()}
                      disabled={busy}
                      className="w-14 h-14 rounded-md border border-dashed border-gray-300 dark:border-white/15 flex items-center justify-center text-[#86868b] dark:text-[#8e8e93] hover:border-[#7C3AED] hover:text-[#7C3AED] disabled:opacity-50 transition-colors"
                      title={`Upload your own image ${idx + 1} (optional)`}
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    </button>
                  )}
                  <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">Image {idx + 1}</span>
                </div>
              )
            })}
          </div>
          {/* Explain the default so the option is discoverable. */}
          <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">
            {userImages.some(Boolean)
              ? 'Only the photos you add here go in the article (no AI photos mixed in). Fill more slots for more images.'
              : 'Optional. By default we generate AI photos of the actual product in different real-world settings — or drop in up to 3 of your own above.'}
          </span>
          {imgErr && <span className="text-[10px] text-[#ff3b30]">{imgErr}</span>}
        </div>
      )}
    </div>
  )
}
