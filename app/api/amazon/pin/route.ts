// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/amazon/pin — publish (or schedule) a Pinterest Pin from an MVP Art
// Director thumbnail + a product link. Points the Pin straight at the creator's
// geni.us affiliate link (not a WordPress post) — the Amazon Influencer flow.
//
// Body: { imageUrl, productUrl?, asin?, productTitle?, boardId?, title?, description?, scheduledAt? }
//   imageUrl   — required, the thumbnail to pin (fal-hosted URL from the generator)
//   productUrl / asin — the product to link to (affiliate)
//   title / description — optional; blank → the AI writes them
//   scheduledAt — optional ISO time; when set, the pin is queued instead of posted now
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { reportPaywallReached } from '@/lib/paywall-signal'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { publishAmazonPin, type PinIntegration } from '@/lib/amazon-pin-publish'
import { resolvePostDestination } from '@/lib/post-destination'

export const maxDuration = 60

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    imageUrl?: string; productUrl?: string; asin?: string; productTitle?: string
    boardId?: string; title?: string; description?: string; scheduledAt?: string
    useShowcase?: boolean; showcaseUrl?: string
  }
  if (!body.imageUrl) return NextResponse.json({ error: 'A thumbnail image is required. Generate one first.' }, { status: 400 })

  const { data: rawInt } = await supabase
    .from('integrations')
    // select('*'), not a column list: PostgREST rejects the WHOLE statement when
    // one named column is missing, so naming tiktok_showcase_url here would
    // break every post on any database that has not run migration 332.
    .select('*')
    .eq('user_id', user.id).single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const intRow = decryptIntegrationRow(rawInt as any) as (PinIntegration & { tier?: string }) | null
  const tier = (intRow?.tier as Tier) ?? 'trial'

  if (!tierAllowsSocial(tier, 'pinterest')) {
    // The designed upgrade moment: they are holding a finished design and
    // this is the wall. Reported as its own event because between
    // CompleteRegistration and a purchase there was nothing at all, so
    // "registrations healthy, nobody upgrades" could not be told apart from
    // "nobody ever got this far". See lib/paywall-signal.ts.
    reportPaywallReached({ userId: user.id, email: user.email, surface: 'publish-pinterest', tier })
    return NextResponse.json({
      error: 'Pinterest posting is on the Amazon, Studio and Pro plans.',
      code: 'upgrade_required', upgrade: { tier: 'amazon' },
    }, { status: 403 })
  }
  if (!intRow?.pinterest_access_token) {
    return NextResponse.json({ error: 'Connect your Pinterest account first (Set up → Connect Socials).', needsConnect: true }, { status: 409 })
  }

  // WHERE THE CLICKS GO. A per-post paste wins over the saved default, and it
  // is resolved HERE so a scheduled pin stores the destination it was queued
  // with rather than re-reading a default that may have changed since.
  const showcaseUrl = (body.showcaseUrl || '').trim()
    || ((intRow as { tiktok_showcase_url?: string | null } | null)?.tiktok_showcase_url || '')
  const destination = resolvePostDestination({
    asin: (body.asin || '').trim().toUpperCase() || null,
    amazonTag: (intRow as { amazon_associates_tag?: string | null } | null)?.amazon_associates_tag,
    useShowcase: body.useShowcase === true, showcaseUrl,
  })

  // ── Schedule for later ────────────────────────────────────────────────────
  const when = (body.scheduledAt || '').trim()
  if (when) {
    const at = new Date(when)
    if (isNaN(at.getTime()) || at.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: 'Pick a schedule time in the future.' }, { status: 400 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('amazon_scheduled_posts')
      .insert({
        user_id: user.id, platform: 'pinterest', image_url: body.imageUrl,
        asin: (body.asin || '').trim().toUpperCase() || null, product_url: (body.productUrl || '').trim() || null,
        product_title: (body.productTitle || '').trim() || null, board_id: (body.boardId || '').trim() || null,
        title: (body.title || '').trim() || null, description: (body.description || '').trim() || null,
        scheduled_at: at.toISOString(),
        destination_url: destination.kind === 'showcase' ? destination.url : null,
        destination_kind: destination.kind,
      })
      .select('id,scheduled_at').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({
      ok: true, scheduled: true, id: data.id, scheduledAt: data.scheduled_at,
      destinationKind: destination.kind, destinationNote: destination.note,
    })
  }

  // ── Publish now ───────────────────────────────────────────────────────────
  try {
    const res = await publishAmazonPin({
      userId: user.id, tier, intRow,
      imageUrl: body.imageUrl, asin: body.asin, productUrl: body.productUrl, productTitle: body.productTitle,
      boardId: body.boardId, title: body.title, description: body.description,
      useShowcase: destination.kind === 'showcase', showcaseUrl: destination.url,
    })
    return NextResponse.json({
      ok: true, ...res,
      // A pin that asked for the showcase and fell back to Amazon must not
      // report the request back as the result.
      geniuslinkNote: [destination.note, res.geniuslinkNote].filter(Boolean).join(' ') || null,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Pinterest pin failed' }, { status: 500 })
  }
}
