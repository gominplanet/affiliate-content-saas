import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { PinterestService } from '@/services/pinterest'

export async function POST(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { postId, description, imageBase64, mediaType, fallbackImageUrl } = await request.json()
  if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
  if (!description) return NextResponse.json({ error: 'description required' }, { status: 400 })

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

  const pinterest = new PinterestService(ig.pinterest_access_token)

  let pin: { id: string }
  if (imageBase64 && mediaType) {
    pin = await pinterest.createPinWithBase64({
      boardId: ig.pinterest_board_id,
      title: p.title,
      description,
      imageBase64,
      mediaType,
      link: p.wordpress_url,
    })
  } else if (fallbackImageUrl) {
    pin = await pinterest.createPin({
      boardId: ig.pinterest_board_id,
      title: p.title,
      description,
      imageUrl: fallbackImageUrl,
      link: p.wordpress_url,
    })
  } else {
    return NextResponse.json({ error: 'No image available for pin' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('blog_posts').update({ pinterest_pin_id: pin.id }).eq('id', postId)

  return NextResponse.json({ ok: true, pinId: pin.id })
}
