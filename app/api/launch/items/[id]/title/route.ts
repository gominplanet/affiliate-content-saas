// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/launch/items/[id]/title — write this video's English title from
// its product.
//
// WHY A BATCH NEEDS THIS AND A SINGLE VIDEO DOES NOT. Video Launchpad writes
// the title for you while you watch. A batch asked you to type ten of them,
// which is the opposite of walking away from the computer, and the first run
// through it produced a video whose title was the ASIN: B0H3P7H9T2, on its way
// to YouTube and into every translation.
//
// THE SAME WRITER the studio uses, so a batch title and a Launchpad title come
// from one place rather than two that drift.
//
// ENGLISH ONLY. This is the line the English stores and YouTube carry, and the
// one every other country's title is translated FROM, which is why it is worth
// getting right before ten dubs are made from it.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { generateProductTitleOptions } from '@/lib/title-options'
import { normalizeTier } from '@/lib/tier'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: item } = await sb.from('launch_items')
    .select('id,asin,title,state').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })

  const asin = String(item.asin || '').trim()
  if (!asin) {
    return NextResponse.json({
      error: 'Set the product first. The title is written from what it is.',
    }, { status: 400 })
  }
  // ALREADY ON YOUTUBE MEANS YOUTUBE OWNS IT. Writing here would leave the two
  // disagreeing with nothing on screen saying which one is live.
  if (item.state === 'scheduled' || item.state === 'published') {
    return NextResponse.json({
      error: 'This one is already on YouTube, so its title is set there now.',
    }, { status: 409 })
  }

  const { data: integ } = await sb.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)

  // The existing title is a hint, not a floor: an ASIN typed into the box is
  // exactly the case this exists for, so it is not fed back in as if it meant
  // something.
  const hint = String(item.title || '').trim()
  const useful = hint && hint.toUpperCase() !== asin.toUpperCase() ? hint : ''

  let options: string[] = []
  try {
    options = await generateProductTitleOptions({
      videoTitle: useful || `Amazon product ${asin}`,
      asin,
      count: 5,
      ctx: { userId: user.id, tier },
    })
  } catch {
    return NextResponse.json({
      error: 'Could not write a title just now. Try again, or type one yourself.',
    }, { status: 502 })
  }

  const titles = options.map(t => t.trim()).filter(Boolean)
  if (titles.length === 0) {
    return NextResponse.json({
      error: 'Nothing usable came back. Try again, or type one yourself.',
    }, { status: 502 })
  }

  // NOT SAVED. The creator picks, because this is the line that gets
  // translated into every language and put on YouTube, and a title written
  // into the row without being read is the plan reported as the result.
  return NextResponse.json({ ok: true, titles })
}
