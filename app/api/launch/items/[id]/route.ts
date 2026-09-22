// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// PATCH  /api/launch/items/[id] — the one video's own product and copy.
// DELETE /api/launch/items/[id] — take it out of the batch.
//
// EVERY VIDEO IS ITS OWN VIDEO. The CTA and the countries are shared; the
// product, the title and the description are not, and treating a batch as ten
// variants of one thing is the mistake this endpoint exists to prevent.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeAsinInput, asinFromAmazonUrl } from '@/lib/asin'
import { resolveAsinFromLinks } from '@/lib/product-link'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    /** An ASIN, or an Amazon link, or a shortener that ends at one. */
    product?: string
    title?: string
    description?: string
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.title === 'string') {
    patch.title = body.title.trim().slice(0, 200) || null
    // THEIRS NOW, AND NEVER OVERWRITTEN. The worker writes a title from the
    // product for any video still carrying its file name; without this line it
    // could not tell that one apart from a title somebody meant.
    patch.title_source = 'creator'
  }
  if (typeof body.description === 'string') patch.description = body.description.trim().slice(0, 5000) || null

  // ── THE PRODUCT, FROM WHATEVER THEY PASTED ────────────────────────────────
  //
  // A bare ASIN, a full Amazon URL, or a shortened link. The last one is why
  // this follows redirects rather than matching a list of hosts: a creator on
  // their own branded Geniuslink domain was reported as having no product at
  // all, because their domain was not on the list somebody had typed out.
  let productNote: string | null = null
  if (typeof body.product === 'string') {
    const raw = body.product.trim()
    if (!raw) {
      patch.asin = null
    } else {
      let asin = normalizeAsinInput(raw) || asinFromAmazonUrl(raw)
      if (!asin && /^https?:\/\//i.test(raw)) {
        try {
          const hit = await resolveAsinFromLinks(raw, null, 3)
          asin = hit?.asin ?? null
        } catch {
          // COULD NOT LOOK is not the same as no product. Said, so the creator
          // can paste the ASIN itself rather than wonder why their link vanished.
          return NextResponse.json({
            error: 'Could not follow that link just now. Paste the ASIN itself, or try again.',
          }, { status: 502 })
        }
      }
      if (!asin) {
        return NextResponse.json({
          error: 'That is not an Amazon product. Paste the 10-character ASIN or the product link.',
        }, { status: 400 })
      }
      patch.asin = asin
      if (asin !== raw.toUpperCase()) productNote = asin
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: item } = await sb.from('launch_items')
    .select('id,state').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })
  if (item.state === 'scheduled' || item.state === 'published') {
    return NextResponse.json({
      error: 'This one is already on YouTube, so its title and product are set there now.',
    }, { status: 409 })
  }

  // A video that was blocked for a missing product is no longer blocked once it
  // has one. Left alone, it would sit in the way of a launch it could join.
  if (patch.asin && item.state === 'blocked') {
    patch.state = 'draft'
    patch.reason = null
  }

  const { error } = await sb.from('launch_items').update(patch).eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, asin: patch.asin ?? null, resolvedFromLink: productNote })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: item } = await sb.from('launch_items')
    .select('id,batch_id,position,state').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })
  if (item.state === 'scheduled' || item.state === 'published') {
    return NextResponse.json({
      error: 'This one is already on YouTube. Removing it here would not take it down.',
    }, { status: 409 })
  }

  const { error } = await sb.from('launch_items').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // CLOSE THE GAP. Position drives the publishing order, and a hole in it would
  // leave the cadence with an empty slot in the middle of the run.
  const { data: rest } = await sb.from('launch_items')
    .select('id,position').eq('batch_id', item.batch_id).order('position', { ascending: true })
  let i = 0
  for (const r of (rest ?? [])) {
    if (r.position !== i) await sb.from('launch_items').update({ position: i }).eq('id', r.id)
    i++
  }
  return NextResponse.json({ ok: true })
}
