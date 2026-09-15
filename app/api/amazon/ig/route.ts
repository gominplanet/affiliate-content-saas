// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/amazon/ig — publish (or schedule) an Instagram feed post from an MVP
// Art Director design + a product. IG can't carry a clickable caption link, so
// the caption says "link in bio" and the product is dropped into the creator's
// Link-in-Bio shop grid (best-effort).
//
// Body: { imageUrl, productUrl?, asin?, productTitle?, caption?, scheduledAt? }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { reportPaywallReached } from '@/lib/paywall-signal'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { publishToInstagram, type SocialIntegration } from '@/lib/amazon-social-publish'
import { resolvePostDestination } from '@/lib/post-destination'

export const maxDuration = 120

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    imageUrl?: string; productUrl?: string; asin?: string; productTitle?: string; caption?: string; scheduledAt?: string; useShowcase?: boolean; showcaseUrl?: string; postType?: 'feed' | 'story'
  }
  if (!body.imageUrl) return NextResponse.json({ error: 'A design is required. Generate one first.' }, { status: 400 })

  const { data: rawInt } = await supabase
    .from('integrations')
    // select('*'), not a column list: PostgREST rejects the WHOLE statement when
    // one named column is missing, so naming tiktok_showcase_url here would
    // break every post on any database that has not run migration 332.
    .select('*')
    .eq('user_id', user.id).single()
  const intRow = decryptIntegrationRow(rawInt) as (SocialIntegration & { tier?: string }) | null
  const tier = (intRow?.tier as Tier) ?? 'trial'

  if (!tierAllowsSocial(tier, 'instagram')) {
    // The designed upgrade moment: they are holding a finished design and
    // this is the wall. Reported as its own event because between
    // CompleteRegistration and a purchase there was nothing at all, so
    // "registrations healthy, nobody upgrades" could not be told apart from
    // "nobody ever got this far". See lib/paywall-signal.ts.
    reportPaywallReached({ userId: user.id, email: user.email, surface: 'publish-instagram', tier })
    return NextResponse.json({
      error: 'Instagram posting is on the Amazon, Studio and Pro plans.',
      code: 'upgrade_required', upgrade: { tier: 'amazon' },
    }, { status: 403 })
  }
  if (!intRow?.instagram_user_id || !intRow?.instagram_access_token) {
    return NextResponse.json({ error: 'Connect your Instagram account first.', needsConnect: true }, { status: 409 })
  }


  // WHERE THE CLICKS GO. A per-post paste wins over the saved default, and the
  // resolution happens HERE so a scheduled post stores the destination it was
  // queued with rather than re-reading a default that may have changed.
  const showcaseUrl = (body.showcaseUrl || '').trim()
    || ((intRow as { tiktok_showcase_url?: string | null } | null)?.tiktok_showcase_url || '')
  const destination = resolvePostDestination({
    asin: (body.asin || '').trim().toUpperCase() || null,
    amazonTag: (intRow as { amazon_associates_tag?: string | null } | null)?.amazon_associates_tag,
    // An explicit toggle wins either way; an absent one inherits the account
    // default (migration 333), so a TikTok-first creator does not have to tick
    // a box on every post forever. The first one they forgot would be the one
    // that silently published an Amazon link.
    useShowcase: typeof body.useShowcase === 'boolean'
      ? body.useShowcase
      : (intRow as { link_destination_default?: string | null } | null)?.link_destination_default === 'showcase',
    showcaseUrl,
  })

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
        user_id: user.id, platform: 'instagram', image_url: body.imageUrl,
        asin: (body.asin || '').trim().toUpperCase() || null, product_url: (body.productUrl || '').trim() || null,
        product_title: (body.productTitle || '').trim() || null, description: (body.caption || '').trim() || null,
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

  try {
    const res = await publishToInstagram({
      db: supabase, userId: user.id, tier, intRow,
      imageUrl: body.imageUrl, asin: body.asin, productUrl: body.productUrl, productTitle: body.productTitle, caption: body.caption,
      postType: body.postType === 'story' ? 'story' : 'feed',
    })
    return NextResponse.json({ ok: true, postUrl: res.url, id: res.id, caption: res.caption, linkUrl: res.linkUrl,
      // Two different things: the cloaker fell back, and the destination is not
      // the one that was asked for. Neither may hide the other.
      geniuslinkNote: [destination.note, res.note].filter(Boolean).join(' ') || null,
      destinationKind: res.destinationKind ?? destination.kind,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Instagram post failed' }, { status: 500 })
  }
}
