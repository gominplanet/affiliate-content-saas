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
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'
import { tierAllowsSocial, type Tier } from '@/lib/tier'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { postId: rawPostId, postUrl } = await request.json()
  if (!rawPostId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
  // Video-less "Published Posts" rows (guides/comparisons/link posts) send the
  // WordPress post id, not the blog_posts UUID — map it so the lookup resolves.
  const postId = (await resolveBlogPostId(supabase, user.id, rawPostId, postUrl)) || rawPostId

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: post }, { data: integration }] = await Promise.all([
    supabase.from('blog_posts').select('*').eq('id', postId).single(),
    supabase.from('integrations').select('*').eq('user_id', user.id).single(),
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = post as any
  // Decrypt secret columns transparently (2026-06-02 rollout).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ig = decryptIntegrationRow(integration as any)

  if (!p) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
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

  const a = await buildPinAssets(p, { userId: user.id, tier: ig?.tier ?? null })

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

  return NextResponse.json({
    ...a,
    // Category board (what publish will use) → the user's named fallback board
    // → saved board → "Reviews". Mirrors the publish-time resolution order.
    boardName: predictedBoard
      || (ig.pinterest_fallback_board || '').trim()
      || ig.pinterest_board_name
      || 'Reviews',
  })
}
