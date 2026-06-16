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

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { postId: rawPostId } = await request.json()
  if (!rawPostId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
  // Video-less "Published Posts" rows (guides/comparisons/link posts) send the
  // WordPress post id, not the blog_posts UUID — map it so the lookup resolves.
  const postId = (await resolveBlogPostId(supabase, user.id, rawPostId)) || rawPostId

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
  // No board required to PREVIEW — the publish step resolves a board
  // (per-category, auto-created). Fresh/sandbox accounts have none yet.

  const a = await buildPinAssets(p, { userId: user.id, tier: ig?.tier ?? null })
  return NextResponse.json({
    ...a,
    boardName: ig.pinterest_board_name || ig.pinterest_board_id || 'auto-created from the post category',
  })
}
