/**
 * POST /api/blog/refresh-images
 *
 * Re-run ONLY the in-article image step on an already-published post — for when
 * the original generation shipped text-only (image stage failed / was cut off).
 * Strips any existing body images, regenerates from real video frames (retouched)
 * or the product photo, re-inserts at section headings, and updates WordPress.
 *
 * Body: { wordpressPostId: number, capturedFrames?: string[] (jpeg data URLs) }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { composeWithNanoBanana, rehostToFal } from '@/lib/thumbnail-generators'
import { fetchStoryboardFrames } from '@/lib/youtube-storyboards'
import { verifyProductMatch } from '@/lib/product-image'
import { resolveProductReference } from '@/lib/resolve-product-reference'
import { normalizeTier, allowedBlogImages } from '@/lib/tier'
import { NO_BRAND_IMAGE_CLAUSE } from '@/lib/image-guard'
import { gutenbergImageBlock, insertImagesAtHeadings, autoPlacementIndices } from '@/lib/blog-body-images'
import { SHOT_PERSPECTIVES, sectionHeadings, generateBodyImagePrompts } from '@/lib/blog-image-prompts'
import { fal } from '@fal-ai/client'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

export const maxDuration = 300

const SHOTS = ['close-up detail shot', 'in-use lifestyle shot', 'in a clean home setting', 'three-quarter angle', 'flat-lay overhead', 'on a bright surface']

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { wordpressPostId, capturedFrames } = (await request.json()) as { wordpressPostId?: number; capturedFrames?: string[] }
  if (!wordpressPostId) return NextResponse.json({ error: 'wordpressPostId required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: post } = await supabase
    .from('blog_posts')
    .select('id,video_id,title,slug,content,image_prompts,wordpress_site_id')
    .eq('user_id', user.id)
    .eq('wordpress_post_id', wordpressPostId)
    .maybeSingle()
  if (!post?.content) return NextResponse.json({ error: 'Post not found, or it has no stored content to update.' }, { status: 404 })

  // We STILL need the integrations row for tier + amazon_associates_tag —
  // those are per-user, not per-site. WP credentials come from the
  // wordpress_sites row associated with this post (multi-site routing:
  // refreshing a post on the Wine blog must hit Wine, not the default).
  // .maybeSingle() — trial users may not have an integrations row;
  // tier defaults to 'trial' via normalizeTier(undefined). Audit fix
  // 2026-06-02 (was throwing 500 on trial-tier image refresh attempts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wp } = await supabase
    .from('integrations')
    .select('tier,amazon_associates_tag')
    .eq('user_id', user.id)
    .maybeSingle()
  const tier = normalizeTier(wp?.tier)
  const site = await getWordPressCredentials(
    supabase,
    user.id,
    (post as { wordpress_site_id?: string | null }).wordpress_site_id,
  )
  if (!site) {
    return NextResponse.json({ error: 'WordPress not connected.' }, { status: 400 })
  }
  const wpService = createWordPressService(site.wordpress_url ?? '', site.wordpress_username ?? '', site.wordpress_app_password ?? '')

  // ── Resolve the product image (uploaded photo → Amazon → linked store page) ─
  let productTitle = (post.title as string) || ''
  let productImageUrl: string | null = null
  // blog_posts.video_id is the youtube_videos DB id (UUID) for single reviews,
  // but the youtube native id for comparison posts — match either.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let vid: any = null
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await supabase
      .from('youtube_videos').select('youtube_video_id,title,description,product_image_url')
      .eq('user_id', user.id).eq('id', post.video_id ?? '').maybeSingle()
    vid = data
  }
  if (!vid) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await supabase
      .from('youtube_videos').select('youtube_video_id,title,description,product_image_url')
      .eq('user_id', user.id).eq('youtube_video_id', post.video_id ?? '').maybeSingle()
    vid = data
  }
  const description = (vid?.description as string) || ''

  // EPC / Creator-Connections posts have no source video — the helper accepts
  // a `campaignAsin` fallback for them. Look it up so the helper can use it
  // if every other path fails.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: camp } = await supabase
    .from('campaigns').select('asin').eq('user_id', user.id).eq('blog_post_id', post.id).maybeSingle()

  // SINGLE SOURCE OF TRUTH for product-reference resolution. Every step
  // (Amazon scrape, page gallery, vision picker, junk-URL filter, retry)
  // lives in lib/resolve-product-reference — improving it improves blog
  // generation, refresh-images, thumbnails, and scripts in lockstep.
  const traceTag = `[refresh-images:${post.id.slice(0, 8)}]`
  const ref = await resolveProductReference({
    uploadedUrl: (vid?.product_image_url as string | null) ?? null,
    title: (vid?.title as string | null) ?? null,
    description,
    campaignAsin: (camp?.asin as string | null) ?? null,
    wordpressUrl: site.wordpress_url ?? null,
    traceTag,
    userId: user.id,
    tier,
  })
  productImageUrl = ref.productImageUrl
  if (ref.productTitle) productTitle = ref.productTitle

  fal.config({ credentials: process.env.FAL_KEY ?? '' })

  // Real HD frames source: first whatever the body sent (legacy / admin
  // retries), then server-side storyboard fetch from YouTube — no extension,
  // no background tab — so the in-article images get retouched FROM real
  // video scenes. Falls back to Kontext on the product photo if both fail.
  let inFrames = (Array.isArray(capturedFrames) ? capturedFrames : [])
    .filter(x => typeof x === 'string' && x.startsWith('data:image/'))
    .slice(0, 4)
  if (inFrames.length === 0 && (vid?.youtube_video_id as string | undefined)) {
    try {
      const sb = await fetchStoryboardFrames(vid!.youtube_video_id as string, { maxFrames: 4 })
      if (sb.length > 0) inFrames = sb.map(f => f.dataUrl)
    } catch { /* fall through to product re-stage */ }
  }
  const frameRefs: string[] = []
  for (const f of inFrames) {
    const u = await rehostToFal(f); if (u) frameRefs.push(u)
  }
  let falProductRef: string | null = null
  if (productImageUrl) {
    try {
      const r = await fetch(productImageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) })
      if (!r.ok) {
        console.warn(`${traceTag} step:fetch-product-image NON-OK`, { productImageUrl, httpStatus: r.status })
      } else {
        falProductRef = await fal.storage.upload(await r.blob())
        console.log(`${traceTag} step:fal-upload ok`, { falProductRef: falProductRef?.slice(0, 100) })
      }
    } catch (e) {
      console.warn(`${traceTag} step:fetch-or-fal-upload FAILED`, { productImageUrl, error: e instanceof Error ? e.message : String(e) })
    }
  }
  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: 'Image generation is not configured.' }, { status: 500 })
  }

  // Strip the existing body images so we don't duplicate, then regenerate.
  const stripped = (post.content as string).replace(/<!-- wp:image[\s\S]*?<!-- \/wp:image -->\s*/g, '')
  const words = stripped.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
  const count = Math.max(1, allowedBlogImages(tier, words))
  const altBase = productTitle || (post.title as string) || 'product'

  // Distinct per-image scene prompts (shared with blog generation) so the
  // body photos aren't near-duplicates — each gets its own setting/use-case.
  const ip = (post.image_prompts as { hero?: string; lifestyle?: string; setting?: string } | null) || null
  const scenePrompts = await generateBodyImagePrompts({
    count,
    productTitle: altBase,
    headings: sectionHeadings(stripped),
    base: { hero: ip?.hero || '', lifestyle: ip?.lifestyle || '', setting: ip?.setting || '' },
    ctx: { userId: user.id, tier },
  })

  const results = await Promise.all(Array.from({ length: count }, async (_unused, i) => {
    const shot = SHOTS[i % SHOTS.length]
    const perspective = SHOT_PERSPECTIVES[i % SHOT_PERSPECTIVES.length]
    const slot = scenePrompts[i]
    const scene = (slot?.prompt || '').trim()
    // AI-written alt for this exact image. Falls back to the legacy
    // "<product> — <shot>" descriptor if the slot didn't ship an alt.
    const altForThisImage = (slot?.alt && slot.alt.trim()) || `${altBase} — ${shot}`
    try {
      let url: string | undefined
      // Primary: re-render the REAL product photo (from the affiliate/Amazon
      // link) into a fitting setting — accurate product, not a guessed frame.
      if (falProductRef) {
        // Identity-preserving re-render via Nano Banana (Gemini Imagen).
        // Mirrors the same swap done in blog/generate: Kontext drifted on
        // ~half of in-article images (showing "an office chair" rather than
        // THIS office chair). Nano Banana holds the exact reference identity
        // — same model that powers the thumbnail composer that works well.
        const prompt = `Identity-preserving re-render of the product in the reference image. Keep its EXACT shape, colour, materials, proportions, surface texture, and every on-product branding/logo/label/text element IDENTICAL to the reference — do not redesign, restyle, simplify, swap, or invent any product. Treat the reference as ground truth for what the product looks like.

CHANGE ONLY the background and the scene around it. Strip the reference's plain studio background and any retail packaging. Place the same product, unchanged, as a polished magazine-quality editorial photo shown as a ${perspective}${scene ? `: ${scene}` : ', set naturally in a real-world setting that fits how it is actually used'}. If a realistic setting doesn't fit, instead stage the unchanged product on a clean surface against a VIBRANT colour-pop / gradient background with soft studio lighting, reflections, and depth that make it shine.

Realistic shadows and lighting. This must read as a COMPLETELY different photo from the article's other images — different background and environment, different surface, different lighting and time of day, different camera distance and angle. Do NOT reuse the reference photo's pose or background.

${NO_BRAND_IMAGE_CLAUSE} Landscape 4:3, photorealistic editorial product photography, no added text/captions/watermarks.`
        const out = await composeWithNanoBanana({
          prompt,
          referenceImageUrls: [falProductRef],
          aspectRatio: '4:3',
          numImages: 1,
        })
        url = out[0]

        // Vision-verify the result against the reference. If the model
        // drifted (returned a different product), retry once with a
        // stricter prompt. If the retry still misses, fall back to the
        // bare reference photo — better the actual product than a wrong
        // one in a magazine setting. Same safety net as blog/generate.
        if (url) {
          const v = await verifyProductMatch(falProductRef, url, productTitle, { userId: user.id, tier })
          console.log('[refresh-images] verify', { i, match: v.match, reason: v.reason })
          if (!v.match) {
            const stricter = `IDENTITY-LOCKED render. The reference image is the GROUND TRUTH for what "${productTitle}" looks like. The previous attempt rendered a DIFFERENT product, which is wrong. Copy the product from the reference EXACTLY — same shape, same colour, same cut-out / texture / pattern, same number of components, same on-product branding/text. Do NOT substitute a similar-looking product. Change only the background${scene ? ` to: ${scene}` : ''}. ${NO_BRAND_IMAGE_CLAUSE} Landscape 4:3, photorealistic editorial product photography, no added text.`
            try {
              const retry = await composeWithNanoBanana({
                prompt: stricter,
                referenceImageUrls: [falProductRef],
                aspectRatio: '4:3',
                numImages: 1,
              })
              const retryUrl = retry[0]
              if (retryUrl) {
                const v2 = await verifyProductMatch(falProductRef, retryUrl, productTitle, { userId: user.id, tier })
                console.log('[refresh-images] verify-retry', { i, match: v2.match, reason: v2.reason })
                if (v2.match) {
                  url = retryUrl
                } else {
                  console.warn('[refresh-images] both attempts failed verification — using bare reference', { i, reasons: [v.reason, v2.reason] })
                  url = falProductRef
                }
              }
            } catch { /* keep the unverified original */ }
          }
        }
      } else {
        // Same diagnostic as blog/generate: when this branch runs without a
        // product reference, every downstream image is text-only and prone
        // to "wrong product" output. Log so we can correlate Vercel logs
        // to the specific posts where this happens.
        console.warn('[refresh-images] NO product reference resolved — falling through to frame / text-only', { postId: post.id, productTitle })
      }
      // Fallback: retouch a real video frame only if no product photo resolved.
      if (!url && frameRefs.length > 0) {
        const prompt = `Turn this REAL video frame into a polished, magazine-quality editorial photo for a product-review article. Keep the SAME real people, product and scene EXACTLY — do not change identities, swap the product, or invent anything. Enhance: sharpen + add clarity, boost colour vibrancy and contrast, bright clean lighting, tidy/blur the background into a premium look. Frame as a ${perspective}. Make it clearly distinct from the article's other photos. Remove any burned-in text, captions, watermarks or player UI. ${NO_BRAND_IMAGE_CLAUSE} Photorealistic, landscape 4:3, no added text.`
        const out = await composeWithNanoBanana({ prompt, referenceImageUrls: [frameRefs[i % frameRefs.length]], aspectRatio: '4:3', numImages: 1 })
        url = out[0]
      }
      if (!url) {
        // Last resort: text-to-image (no product photo, no frame) — vibrant.
        const prompt = `Editorial product photo of ${productTitle}, ${perspective}${scene ? `, ${scene}` : ', placed in a fitting real-world setting or against a vibrant, eye-catching colour-pop background with soft studio lighting that makes it shine'}. Sharp focus, photorealistic, 8K. ${NO_BRAND_IMAGE_CLAUSE} No text, no logos, no people.`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = await fal.subscribe('fal-ai/flux-pro/v1.1' as any, {
          input: { prompt, image_size: 'landscape_4_3', num_inference_steps: 28, guidance_scale: 3.5, num_images: 1, output_format: 'jpeg', safety_tolerance: '2', seed: Math.floor(Math.random() * 1e9) + i },
          pollInterval: 3000,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        url = ((r.data as any)?.images as Array<{ url: string }> | undefined)?.[0]?.url
      }
      if (!url) return null
      // Try WP media upload first; if it throws (Hostinger / WAF blocking the
      // multipart POST to /wp-json/wp/v2/media is the common case), embed the
      // fal URL directly so the image still renders.
      let finalUrl = url
      try {
        const media = await wpService.uploadImageFromUrl(url, `${post.slug || 'post'}-body${i + 1}.jpg`)
        if (media?.source_url) finalUrl = media.source_url
      } catch (e) {
        console.warn(`[refresh-images] item ${i} WP media upload failed, embedding fal URL directly:`, e instanceof Error ? e.message : String(e))
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recordUsageSafe(user.id, tier, falProductRef ? 'fal-flux-pro-kontext' : (frameRefs.length > 0 ? 'nano-banana' : 'fal-flux-pro-v1.1'))
      return { url: finalUrl, alt: altForThisImage }
    } catch { return null }
  }))

  const uploaded = results.filter((r): r is { url: string; alt: string } => !!r)
  if (uploaded.length === 0) return NextResponse.json({ error: 'Image generation failed — try again in a moment.' }, { status: 502 })

  const slots = autoPlacementIndices(stripped, uploaded.length)
  const finalContent = insertImagesAtHeadings(stripped, uploaded.map((img, i) => ({
    beforeHeadingIndex: slots[i] ?? (i + 1),
    block: gutenbergImageBlock(img.url, img.alt),
  })))

  try { await wpService.updatePost(wordpressPostId, { content: finalContent }) }
  catch (err) { return NextResponse.json({ error: `WordPress update failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 502 }) }
  // Persist the image-enriched body AND stamp body_images_count so the Content
  // page's diagnostic badge ("🖼 N") reflects the refresh result — otherwise a
  // post whose initial generation died at 0 images would keep showing the
  // orange ⚠ even after the user successfully re-rolled them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  try { await supabase.from('blog_posts').update({ content: finalContent, body_images_count: uploaded.length }).eq('id', post.id) } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, count: uploaded.length })
}

// Lazy import to keep the hot path lean; usage logging must never block.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function recordUsageSafe(userId: string, tier: string, model: string) {
  import('@/lib/ai-usage').then(({ recordUsage }) => recordUsage({ userId, tier, feature: 'blog_body_image', model, images: 1 })).catch(() => {})
}
