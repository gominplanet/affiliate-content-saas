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

// ── Generation status ───────────────────────────────────────────────────
type GenStatus = 'idle' | 'generating' | 'done' | 'error'

const GEN_STEPS = ['Reading transcript…', 'Generating blog post…', 'Publishing to WordPress…', 'Adding product photos…']

export function GenerateButton({
  videoId, existingPost, userTier, onDone,
}: {
  videoId: string
  /** YouTube native id — historically used for extension-side frame
   *  capture; kept on the call-site signature for backwards compat
   *  but no longer read here (storyboards path handles it server-side). */
  youtubeVideoId?: string
  existingPost?: { url: string; title: string; postId?: string; wpPostId?: number; indexed?: boolean | null; coverage?: string | null; bodyImagesCount?: number | null } | null
  /** Drives whether the Rewrite button shows at all (Pro/Admin only). */
  userTier: Tier
  onDone: (url: string, title: string, postId: string) => void
}) {
  const [status, setStatus] = useState<GenStatus>(existingPost ? 'done' : 'idle')
  const [stepIdx, setStepIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
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
      setResult((prev) => prev ? { ...prev, bodyImagesCount: count } : prev)
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
  // Per-generation choice: drop real video frames into the post body, or
  // ship a text-only post. Defaults ON (richer posts), user can opt out
  // before hitting Generate. Rewrites keep the same preference.
  // Off by default — when the box is ticked we attempt to add 2–3 in-article
  // photos (storyboard-frame retouches or Amazon-product re-stages). Ticked
  // = user explicitly opts in to the longer generation + the extra AI cost.
  const [includeImages, setIncludeImages] = useState(false)
  // Optional: bring-your-own in-article images (up to 3). When present, these
  // are placed throughout the post INSTEAD of AI-generated photos.
  const [userImages, setUserImages] = useState<string[]>([])
  const [imgBusy, setImgBusy] = useState(false)
  const [imgErr, setImgErr] = useState<string | null>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)
  const supabase = createBrowserClient()
  const { confirm, ConfirmHost } = useConfirm()

  useEffect(() => {
    if (status !== 'generating') return
    const interval = setInterval(() => setStepIdx((i) => (i < GEN_STEPS.length - 1 ? i + 1 : i)), 9000)
    return () => clearInterval(interval)
  }, [status])

  async function addUserImages(files: FileList | null) {
    if (!files || files.length === 0) return
    setImgErr(null)
    const room = 3 - userImages.length
    if (room <= 0) { setImgErr('Up to 3 images'); return }
    setImgBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const next: string[] = []
      for (const f of Array.from(files).slice(0, room)) {
        if (!f.type.startsWith('image/')) continue
        if (f.size > 10 * 1024 * 1024) { setImgErr('Each image must be under 10 MB'); continue }
        const ext = f.name.split('.').pop()?.toLowerCase() || 'jpg'
        const path = `${user.id}/blog/${videoId}/${crypto.randomUUID()}.${ext}`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: upErr } = await (supabase.storage as any).from('product-images').upload(path, f, {
          cacheControl: '31536000', upsert: false, contentType: f.type || 'image/jpeg',
        })
        if (upErr) throw new Error(upErr.message || 'Upload failed')
        const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(path)
        if (urlData?.publicUrl) next.push(urlData.publicUrl)
      }
      if (next.length) setUserImages(prev => [...prev, ...next].slice(0, 3))
    } catch (e) {
      setImgErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setImgBusy(false)
      if (imgInputRef.current) imgInputRef.current.value = ''
    }
  }

  function removeUserImage(url: string) {
    setUserImages(prev => prev.filter(u => u !== url))
  }

  async function generate(opts?: { rewriteFeedback?: string }) {
    setStatus('generating')
    setStepIdx(0)
    setError(null)
    try {
      // Frame capture used to live here — the extension would open a YouTube
      // tab in the background to scrub HD frames. That tab-opening is what
      // the user kept seeing, and it's no longer needed: /api/blog/generate
      // now pulls evenly-spaced frames from YouTube's own storyboard tiles
      // server-side (lib/youtube-storyboards) — same "real frames" benefit,
      // zero browser tabs, no extension required.
      const callGenerate = async (allowEmptyTranscript = false) => {
        const r = await fetch('/api/blog/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId,
            includeImages,
            ...(includeImages && userImages.length > 0 ? { userImageUrls: userImages } : {}),
            ...(opts?.rewriteFeedback ? { rewriteFeedback: opts.rewriteFeedback } : {}),
            ...(allowEmptyTranscript ? { allowEmptyTranscript: true } : {}),
          }),
        })
        let d: Record<string, unknown> = {}
        try { d = await r.json() } catch { throw new Error(`Server error (${r.status}) — check Vercel logs`) }
        return { res: r, data: d }
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
      if (includeImages && userImages.length === 0 && data.wordpressPostId) {
        setStepIdx(GEN_STEPS.length - 1) // "Adding product photos…"
        try {
          const imgRes = await fetch('/api/blog/refresh-images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wordpressPostId: data.wordpressPostId }),
          })
          const imgData: Record<string, unknown> = await imgRes.json().catch(() => ({}))
          if (imgRes.ok && typeof imgData.count === 'number') {
            const count = imgData.count
            // Reflect the count on the badge straight away so the user
            // sees "🖼 N" without a Content-page reload.
            setResult((prev) => prev ? { ...prev, bodyImagesCount: count } : prev)
          } else if (!imgRes.ok) {
            // Surface the auto-trigger failure as a toast instead of
            // silently swallowing it — 2026-06-05 user report of "ticked
            // Include images but got none" was an auto-trigger failure
            // we never told them about. The post itself is fine; the
            // user can still hit Images manually to retry.
            const msg = (imgData.error as string | undefined) || `Couldn't add in-article images (${imgRes.status}).`
            toast.error(`${msg} Click Images on the post row to retry.`, { duration: 6000 })
          }
        } catch (e) {
          // Non-fatal — the post is already published — but tell the user
          // so they know to click Images manually instead of thinking the
          // toggle was ignored. Network errors / aborts land here.
          const msg = e instanceof Error ? e.message : 'Image step failed.'
          toast.error(`${msg} Click Images on the post row to retry.`, { duration: 6000 })
        }
      }

      setStatus('done')
      onDone(data.wordpressUrl as string, data.title as string, data.postId as string)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStatus('error')
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
        {result.bodyImagesCount === 0 && (
          <span className="inline-flex items-center gap-0.5 text-[#ff9500]" title="‘Include photos’ was on but no in-article images made it in. Try ‘Refresh images’ on the post, or check your WordPress media upload (Hostinger WAF on POST /wp-json/wp/v2/media is the usual cause).">
            <span aria-hidden>🖼</span><span className="text-[10px] font-semibold">!</span>
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
              : <><Wand2 size={11} /> {result.bodyImagesCount && result.bodyImagesCount > 0 ? 'Re-roll images' : 'Add images'}</>
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
  if (status === 'error') {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-[#ff3b30] line-clamp-3">{error}</p>
        <button onClick={() => generate()} className="text-xs text-[#7C3AED] hover:underline text-left">Retry →</button>
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
          title="Add photos to the post body. Uncheck for a text-only post."
        >
          <input
            type="checkbox"
            checked={includeImages}
            onChange={(e) => setIncludeImages(e.target.checked)}
            className="accent-[#7C3AED] w-3.5 h-3.5"
          />
          Include photos in the article
        </label>
        {includeImages && (
          <>
            <input
              ref={imgInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => addUserImages(e.target.files)}
            />
            <button
              onClick={() => imgInputRef.current?.click()}
              disabled={imgBusy || userImages.length >= 3}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-200 dark:border-white/10 text-[11px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#7C3AED] disabled:opacity-50 transition-colors"
              title="Upload up to 3 of your own photos to use throughout the article instead of the AI ones"
            >
              {imgBusy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              {userImages.length > 0 ? `Your photos (${userImages.length}/3)` : 'Upload your own'}
            </button>
          </>
        )}
      </div>

      {includeImages && (
        <div className="flex items-center gap-2 flex-wrap">
          {userImages.map((u) => (
            <div key={u} className="relative w-12 h-12 rounded-md overflow-hidden border border-gray-200 dark:border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="Article image" className="w-full h-full object-cover" />
              <button
                onClick={() => removeUserImage(u)}
                aria-label="Remove image"
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 hover:bg-[#ff3b30] text-white flex items-center justify-center"
              >
                <X size={9} />
              </button>
            </div>
          ))}
          {/* Explain the default so the option is discoverable. */}
          <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">
            {userImages.length > 0
              ? 'Your photos will be placed through the article.'
              : 'By default we generate AI photos of the actual product in different real-world settings — or upload your own.'}
          </span>
          {imgErr && <span className="text-[10px] text-[#ff3b30]">{imgErr}</span>}
        </div>
      )}
    </div>
  )
}
