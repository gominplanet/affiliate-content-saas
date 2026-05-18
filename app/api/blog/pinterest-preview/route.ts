/**
 * POST /api/blog/pinterest-preview
 * Generates pin assets (title, description, hashtags, image) for the
 * editable preview modal (used by Library & Social Push AND the
 * CC & EPC Campaign Pinterest pill). Heavy lifting: lib/pin-assets.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { buildPinAssets } from '@/lib/pin-assets'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { postId } = await request.json()
  if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: post }, { data: integration }] = await Promise.all([
    (supabase as any).from('blog_posts').select('*').eq('id', postId).single(),
    (supabase as any).from('integrations').select('*').eq('user_id', user.id).single(),
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = post as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ig = integration as any

  if (!p) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  if (!ig?.pinterest_access_token) return NextResponse.json({ error: 'Pinterest not connected' }, { status: 400 })
  if (!ig?.pinterest_board_id) return NextResponse.json({ error: 'No Pinterest board selected' }, { status: 400 })

  const a = await buildPinAssets(p, { userId: user.id, tier: ig?.tier ?? null })
  return NextResponse.json({
    ...a,
    boardName: ig.pinterest_board_name || ig.pinterest_board_id,
  })
}
