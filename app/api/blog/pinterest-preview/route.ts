/**
 * POST /api/blog/pinterest-preview
 * Generates pin assets (title, description, hashtags, image) for the
 * editable preview modal (used by Library & Social Push AND the
 * CC & EPC Campaign Pinterest pill). Heavy lifting: lib/pin-assets.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { buildPinAssets } from '@/lib/pin-assets'
import { resolveBlogPostId } from '@/lib/resolve-post-id'
import { syntheticWpPost } from '@/lib/wp-post-fallback'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { resolvePinProductLink } from '@/lib/pin-product-link'

// The Art Director pin does a Claude brief + a slow gpt-image-2 render + product-
// image fetches, which routinely runs past 60s. At 60 Vercel killed the function
// (504) before it finished — no catch, no log, just a generic "failed" toast for
// the user. 300 matches the other gpt-image-2 routes (generate-thumbnail,
// refresh-images) so a normal render has room to finish.
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { postId: rawPostId, postUrl, postTitle, postImage } = await request.json()
  if (!rawPostId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
  // Video-less "Published Posts" rows (guides/comparisons/link posts) send the
  // WordPress post id, not the blog_posts UUID — map it so the lookup resolves.
  const postId = (await resolveBlogPostId(supabase, user.id, rawPostId, postUrl)) || rawPostId

  // .maybeSingle (not .single) so a missing row resolves to null instead of an
  // error — a WordPress-only post (no blog_posts row) falls through to the
  // synthetic-post fallback below instead of a hard "Post not found".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: post }, { data: integration }] = await Promise.all([
    supabase.from('blog_posts').select('*').eq('id', postId).maybeSingle(),
    supabase.from('integrations').select('*').eq('user_id', user.id).single(),
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let p = post as any
  // Decrypt secret columns transparently (2026-06-02 rollout).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ig = decryptIntegrationRow(integration as any)

  // No MVP record → publish straight from the WordPress post the client knows
  // about (title + permalink + image). Needs a URL to link the pin to.
  if (!p) {
    if (!postUrl) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    p = syntheticWpPost({ wpPostId: rawPostId, url: postUrl, title: postTitle, image: postImage })
  }
  if (!ig?.pinterest_access_token) return NextResponse.json({ error: 'Pinterest not connected' }, { status: 400 })
  // Pinterest is a Studio+ feature — gate the PREVIEW too so a sub-Studio user
  // can't spend an image generation on a pin they can't publish.
  if (!tierAllowsSocial((ig?.tier as Tier) ?? 'trial', 'pinterest')) {
    return NextResponse.json(
      { error: 'Pinterest is a Studio plan feature. Upgrade to Studio or Pro to pin to Pinterest.' },
      { status: 403 },
    )
  }
  // No board required to PREVIEW — the publish step resolves a board
  // (per-category, auto-created). Fresh/sandbox accounts have none yet.

  // Preview is a single, user-initiated pin → render the designed MVP Art
  // Director pin when the post has a real product photo. Falls back to the cheap
  // hero-composite when there's no product photo (no extra generation cost).
  //
  // buildPinAssets degrades image-gen failures internally (returns a
  // fallbackImageUrl), but if it throws outright the whole preview used to hard-
  // fail with an unhelpful generic toast and NO server log. Wrap it: log the real
  // reason, and still open the preview using the post's existing image so the
  // user can pin, instead of a dead button.
  let a: Awaited<ReturnType<typeof buildPinAssets>>
  try {
    a = await buildPinAssets(p, { userId: user.id, tier: ig?.tier ?? null }, { artDirector: true })
  } catch (err) {
    console.error('[pinterest-preview] buildPinAssets threw:', err instanceof Error ? (err.stack || err.message) : err)
    a = {
      title: (p.title as string) || 'Take a look',
      description: (p.title as string) || '',
      hashtags: [],
      disclaimer: '',
      complianceTags: '',
      link: (p.permalink as string) || (p.url as string) || postUrl || '',
      imageBase64: null,
      mediaType: null,
      fallbackImageUrl: (p.featured_image_url as string) || (p.thumbnail_url as string) || postImage || null,
    }
  }

  // The post's vertical render (if any) — lets the preview offer a VIDEO pin
  // instead of the still image. Resolved from the linked Short.
  let videoUrl: string | null = null
  try {
    const vid = (p as { video_id?: string | null }).video_id
    if (vid) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: v } = await (supabase as any)
        .from('youtube_videos').select('instagram_video_url').eq('id', vid).maybeSingle()
      videoUrl = (v?.instagram_video_url as string | null) ?? null
    }
  } catch { /* no render — image pin only */ }

  // Predict the board this pin will actually land on so the preview header is
  // accurate. Publish (lib/pin-publish) pins to a board matching the post's
  // WordPress CATEGORY (auto-created), then falls back to the named board →
  // "Reviews". Mirror that order here, best-effort — never block the preview.
  // getPostCategoryNames already HTML-decodes the names, so this matches the
  // clean board name publish creates.
  let predictedBoard = ''
  try {
    if (p.wordpress_post_id) {
      const wp = await getWordPressCredentials(supabase, user.id, p.wordpress_site_id ?? null)
      const wpUrl = wp?.wordpress_url ?? ig.wordpress_url
      if (wpUrl) {
        const wpSvc = createWordPressService(
          wpUrl,
          wp?.wordpress_username ?? ig.wordpress_username,
          wp?.wordpress_app_password ?? ig.wordpress_app_password,
          (wp?.wordpress_api_token ?? ig.wordpress_api_token) || undefined,
        )
        const cats = await wpSvc.getPostCategoryNames(p.wordpress_post_id)
        predictedBoard = cats.find((c: string) => c && !/^(blog|uncategorized|general|news|misc|other|posts?)$/i.test(c)) || ''
      }
    }
  } catch { /* fall back to the saved board below */ }

  // The direct product link for the Blog/Product toggle (Geniuslink when the
  // user has it, else the tagged direct Amazon URL). null → modal keeps Blog only.
  const productUrl = await resolvePinProductLink(supabase, user.id, p, ig).catch(() => null)

  return NextResponse.json({
    ...a,
    videoUrl,
    productUrl,
    // Category board (what publish will use) → the user's named fallback board
    // → saved board → "Reviews". Mirrors the publish-time resolution order.
    boardName: predictedBoard
      || (ig.pinterest_fallback_board || '').trim()
      || ig.pinterest_board_name
      || 'Reviews',
  })
}
