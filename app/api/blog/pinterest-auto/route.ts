/**
 * POST /api/blog/pinterest-auto   { postId }
 *
 * One-click "fan-out pill" Pinterest publish (no preview modal) for the
 * CC & EPC Campaign page. Generates the pin (shared lib/pin-assets),
 * composes the full description (body → hashtags → disclaimer →
 * #ad #affiliate), and publishes (shared lib/pin-publish: blog-only
 * link + one-board-per-category).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { buildPinAssets, composePinDescription } from '@/lib/pin-assets'
import { publishPinForPost, PinPublishError } from '@/lib/pin-publish'

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

  const tier = (ig?.tier as Tier) ?? 'free'
  if (!tierAllowsSocial(tier, 'pinterest')) {
    return NextResponse.json(
      { error: 'Pinterest is a Growth plan feature. Upgrade to Growth or Pro to pin.' },
      { status: 403 },
    )
  }
  if (!ig?.pinterest_access_token) return NextResponse.json({ error: 'Pinterest not connected' }, { status: 400 })
  if (!ig?.pinterest_board_id) return NextResponse.json({ error: 'No Pinterest board selected' }, { status: 400 })

  try {
    const a = await buildPinAssets(p, { userId: user.id, tier })
    const { pinId } = await publishPinForPost({
      p, ig,
      title: a.title,
      description: composePinDescription(a),
      imageBase64: a.imageBase64,
      mediaType: a.mediaType,
      fallbackImageUrl: a.fallbackImageUrl,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('blog_posts').update({ pinterest_pin_id: pinId }).eq('id', postId)
    return NextResponse.json({ ok: true, pinId })
  } catch (e) {
    if (e instanceof PinPublishError) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Pinterest publish failed' }, { status: 500 })
  }
}
