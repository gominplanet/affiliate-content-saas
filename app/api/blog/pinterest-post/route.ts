import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { PinterestService } from '@/services/pinterest'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { scrubBanned } from '@/lib/scrub'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Pinterest auto-publish is Growth+ (Growth, Pro, Admin).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tierRow } = await (supabase as any)
    .from('integrations')
    .select('tier')
    .eq('user_id', user.id)
    .single()
  const tier = (tierRow?.tier as Tier) ?? 'free'
  if (!tierAllowsSocial(tier, 'pinterest')) {
    return NextResponse.json(
      { error: 'Pinterest auto-publish is a Growth plan feature. Upgrade to Growth or Pro to pin to Pinterest.' },
      { status: 403 },
    )
  }

  const { postId, title, description, imageBase64, mediaType, fallbackImageUrl } = await request.json()
  if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
  if (!description) return NextResponse.json({ error: 'description required' }, { status: 400 })

  // Final server-side guard — banned words never leave the building,
  // even if a stale client posted unscrubbed text.
  const safeDescription = scrubBanned(description) || description

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: post }, { data: integration }] = await Promise.all([
    (supabase as any).from('blog_posts').select('id,title,wordpress_url').eq('id', postId).single(),
    (supabase as any).from('integrations').select('pinterest_access_token,pinterest_board_id').eq('user_id', user.id).single(),
  ])

  const p = post as any
  const ig = integration as any

  if (!p) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  if (!ig?.pinterest_access_token) return NextResponse.json({ error: 'Pinterest not connected' }, { status: 400 })
  if (!ig?.pinterest_board_id) return NextResponse.json({ error: 'No Pinterest board selected' }, { status: 400 })

  // The pin must link DIRECTLY to the blog post it refers to — never an
  // Amazon/affiliate/redirect URL (Amazon Associates + Pinterest ToS).
  const blogLink = (p.wordpress_url as string | null) || ''
  if (!/^https?:\/\//i.test(blogLink)) {
    return NextResponse.json({ error: 'This post has no blog URL to link the pin to.' }, { status: 400 })
  }

  const pinterest = new PinterestService(ig.pinterest_access_token)
  // Prefer the (curiosity-driven, possibly edited) title from the modal;
  // scrub + cap to Pinterest's 100-char limit. Fall back to post title.
  const safeTitle = (scrubBanned(title) || scrubBanned(p.title) || p.title).slice(0, 100)

  let pin: { id: string }
  try {
    if (imageBase64 && mediaType) {
      pin = await pinterest.createPinWithBase64({
        boardId: ig.pinterest_board_id,
        title: safeTitle,
        description: safeDescription,
        imageBase64,
        mediaType,
        link: blogLink,
      })
    } else if (fallbackImageUrl) {
      pin = await pinterest.createPin({
        boardId: ig.pinterest_board_id,
        title: safeTitle,
        description: safeDescription,
        imageUrl: fallbackImageUrl,
        link: blogLink,
      })
    } else {
      return NextResponse.json({ error: 'No image available for pin' }, { status: 400 })
    }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'TimeoutError'
    const msg = aborted ? 'Pinterest took too long to accept the pin. Please try again.' : (e instanceof Error ? e.message : 'Pinterest pin failed')
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('blog_posts').update({ pinterest_pin_id: pin.id }).eq('id', postId)

  return NextResponse.json({ ok: true, pinId: pin.id })
}
