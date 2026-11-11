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
import { generateAmazonTitleOptions } from '@/lib/amazon-title'
import { createAdminClient } from '@/lib/supabase/admin'
import { productNameFor } from '@/lib/product-name-lookup'
import { realTitles, genericTitleWhy } from '@/lib/youtube-title-guard'
import { writeYouTubeTitles } from '@/lib/youtube-title-writer'
import { postToSelf } from '@/lib/self-url'
import { normalizeTier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // ?for=amazon writes the Amazon title (the creator's storefront style)
  // instead of the thumbnail-style line this route was first written for.
  const forAmazon = new URL(req.url).searchParams.get('for') === 'amazon'
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
  // disagreeing with nothing on screen saying which one is live. (The Amazon
  // title is not YouTube's, so it can still be written.)
  if (!forAmazon && (item.state === 'scheduled' || item.state === 'published')) {
    return NextResponse.json({
      error: 'This one is already on YouTube, so its title is set there now.',
    }, { status: 409 })
  }

  const { data: integ } = await sb.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  // PAID MODEL CALL BELOW: the spend ceiling (and a closed free trial) applies
  // here exactly as on the generators, or this route is the one that keeps going.
  const spendBlocked = await spendGate(user.id, tier)
  if (spendBlocked) return spendBlocked

  // The existing title is a hint, not a floor: an ASIN typed into the box is
  // exactly the case this exists for, so it is not fed back in as if it meant
  // something.
  const hint = String(item.title || '').trim()
  const useful = hint && hint.toUpperCase() !== asin.toUpperCase() ? hint : ''

  if (forAmazon) {
    const options = await generateAmazonTitleOptions({ asin, videoTitle: useful, count: 5, ctx: { userId: user.id, tier } })
    const amazon = options.map(t => t.trim()).filter(Boolean)
    if (amazon.length === 0) {
      return NextResponse.json({ error: 'Nothing usable came back. Try again, or type one yourself.' }, { status: 502 })
    }
    return NextResponse.json({ ok: true, titles: amazon })
  }

  // ── THE YOUTUBE TITLE: NEVER A STAND-IN (2026-11-11) ─────────────────────
  // Jarett's Drop offered THIS TEST, WORTH IT?, THIS PRODUCT REVIEW, THIS WIN?
  // and BIG MISTAKE?. Co-Pilot's writer refused the call (an empty video title
  // is a 400 there), the thumbnail headline writer stood in for it, and with
  // no product name it answered with its stock lines. Now:
  //   1. the product's name, from what MVP holds or may ask (no Amazon page)
  //   2. Co-Pilot's writer, given that name as the product and a video title
  //   3. a short title writer from the name, if Co-Pilot's did not answer
  // and every title is checked (lib/youtube-title-guard) before it is shown.
  // No name and no title: said, never guessed.
  const found = await productNameFor(createAdminClient(), asin)
  const product = found ? { brand: found.brand, canonical: found.canonical } : null
  // The title already there is a hint only when it is one: a file name or a
  // thumbnail line ("WORTH IT?") fed back in is how the writer got stuck on it.
  const realHint = useful && !genericTitleWhy(useful) ? useful : ''
  // With no name anywhere MVP may look, Co-Pilot's writer still gets the
  // ASIN to find the product by; a title that comes back carrying the code
  // instead of a name is refused by the guard.
  const subject = realHint || found?.canonical || found?.title || asin
  let titles: string[] = []
  let coPilotWhy = ''
  if (subject) {
    try {
      const res = await postToSelf({
        path: '/api/youtube/generate-metadata',
        userId: user.id,
        timeoutMs: 80_000,
        // The product's name as the video title when the creator has given
        // none: if Amazon's page answers Co-Pilot it has the bullets too, and
        // if not, its product falls back to this name rather than to nothing.
        // A creator's own words are checked against the product as before.
        body: { videoTitle: subject, asin, skipAsinCheck: !realHint },
      })
      if (res.ok) {
        const j = await res.json().catch(() => ({})) as { generated?: { title?: string; title_alternatives?: string[] } }
        titles = realTitles([j.generated?.title, ...(j.generated?.title_alternatives ?? [])], product).slice(0, 5)
        if (!titles.length) coPilotWhy = 'its titles did not name the product'
      } else {
        const j = await res.json().catch(() => ({})) as { error?: string; asinMismatch?: boolean }
        // A product that does not match the video is said as it is: titles
        // for the wrong product are worse than none.
        if (j.asinMismatch && j.error) return NextResponse.json({ error: j.error }, { status: 422 })
        coPilotWhy = String(j.error || `it answered ${res.status}`).slice(0, 160)
      }
    } catch (e) { coPilotWhy = e instanceof Error && /abort|timeout/i.test(e.message) ? 'it did not answer in time' : 'it did not answer' }
  }
  if (!titles.length && found) {
    titles = await writeYouTubeTitles({ productTitle: found.title, brand: found.brand, canonical: found.canonical, hint: realHint, count: 5, ctx: { userId: user.id, tier } })
  }
  if (!titles.length) {
    return NextResponse.json({
      error: found
        ? `MVP could not write a title that names ${found.canonical}${coPilotWhy ? ` (Co-Pilot's writer: ${coPilotWhy})` : ''}. Press Write again, or type one yourself.`
        : `MVP could not find this product's name from ${asin}, so it did not guess a title. Check the product, or type the title yourself.`,
    }, { status: 502 })
  }

  // NOT SAVED. The creator picks, because this is the line that gets
  // translated into every language and put on YouTube, and a title written
  // into the row without being read is the plan reported as the result.
  return NextResponse.json({ ok: true, titles })
}
